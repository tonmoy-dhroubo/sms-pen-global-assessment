import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// A very small Chrome DevTools Protocol client for the repo's browser scripts (`npm run a11y`, `npm run screenshots`).
// It drives a locally installed Chrome or Edge in headless mode over a WebSocket, so the scripts need no browser
// download and no Playwright/Puppeteer dependency. Node 24 ships a global `WebSocket`.

const CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

export function findChrome(): string {
  const found = CANDIDATES.find((candidate) => candidate && existsSync(candidate));
  if (!found) throw new Error("No Chrome or Edge found. Set CHROME_PATH to the executable.");
  return found;
}

type Json = Record<string, unknown>;

export class Page {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (v: Json) => void; reject: (e: Error) => void }
  >();
  private readonly listeners = new Map<string, Array<(params: Json) => void>>();

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        result?: Json;
        error?: { message: string };
        method?: string;
        params?: Json;
      };
      if (message.id !== undefined) {
        const waiter = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) waiter?.reject(new Error(message.error.message));
        else waiter?.resolve(message.result ?? {});
      } else if (message.method) {
        for (const listener of this.listeners.get(message.method) ?? []) {
          listener(message.params ?? {});
        }
      }
    });
  }

  static async connect(webSocketUrl: string): Promise<Page> {
    const socket = new WebSocket(webSocketUrl);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("Could not reach Chrome.")), {
        once: true,
      });
    });
    const page = new Page(socket);
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    return page;
  }

  send(method: string, params: Json = {}): Promise<Json> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  once(method: string): Promise<Json> {
    return new Promise((resolve) => {
      const list = this.listeners.get(method) ?? [];
      const listener = (params: Json) => {
        this.listeners.set(
          method,
          (this.listeners.get(method) ?? []).filter((l) => l !== listener),
        );
        resolve(params);
      };
      list.push(listener);
      this.listeners.set(method, list);
    });
  }

  /** Evaluates an expression in the page (awaiting promises) and returns its JSON value. */
  async evaluate<T = unknown>(expression: string): Promise<T> {
    const result = (await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })) as { result?: { value?: T }; exceptionDetails?: { exception?: { description?: string } } };
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ?? "Script error in the page.",
      );
    }
    return result.result?.value as T;
  }

  async navigate(url: string, settleMs = 700): Promise<void> {
    const loaded = this.once("Page.loadEventFired");
    await this.send("Page.navigate", { url });
    await loaded;
    await this.settle(settleMs);
  }

  /** Gives client-side rendering and fetches a moment to finish. */
  async settle(ms = 700): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async setViewport(width: number, height: number, mobile = false): Promise<void> {
    await this.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile,
    });
  }

  async setColorScheme(scheme: "light" | "dark"): Promise<void> {
    await this.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: scheme }],
    });
    // next-themes keeps the choice in localStorage; setting it before any script runs avoids a flash of the other theme.
    await this.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `try { localStorage.setItem("theme", ${JSON.stringify(scheme)}); } catch {}`,
    });
  }

  async setCookie(name: string, value: string, origin: string): Promise<void> {
    await this.send("Network.setCookies", { cookies: [{ name, value, url: origin }] });
  }

  /** A real mouse click on the first visible element matching the selector and (optionally) text. */
  async click(selector: string, text?: string): Promise<void> {
    const point = await this.evaluate<{ x: number; y: number } | null>(`(() => {
      const wanted = ${JSON.stringify(text ?? null)};
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(
        (node) => (!wanted || node.textContent?.trim().startsWith(wanted)) && node.getClientRects().length > 0,
      );
      if (!el) return null;
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!point) throw new Error(`Nothing to click for ${selector}${text ? ` "${text}"` : ""}.`);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
      await this.send("Input.dispatchMouseEvent", {
        type,
        x: point.x,
        y: point.y,
        button: "left",
        clickCount: 1,
      });
    }
    await this.settle(400);
  }

  async key(key: string, code = key, modifiers = 0): Promise<void> {
    const keyCodes: Record<string, number> = { Tab: 9, Enter: 13, Escape: 27, " ": 32 };
    const windowsVirtualKeyCode = keyCodes[key] ?? key.toUpperCase().charCodeAt(0);
    const text = key === "Enter" ? "\r" : key.length === 1 ? key : undefined;
    await this.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key,
      code,
      modifiers,
      windowsVirtualKeyCode,
      ...(text ? { text } : {}),
    });
    await this.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key,
      code,
      modifiers,
      windowsVirtualKeyCode,
    });
  }

  /** Attaches files to an `<input type="file">` (a native file chooser cannot be driven from outside the browser). */
  async setFiles(selector: string, files: string[]): Promise<void> {
    const document = (await this.send("DOM.getDocument", { depth: 0 })) as {
      root: { nodeId: number };
    };
    const found = (await this.send("DOM.querySelector", {
      nodeId: document.root.nodeId,
      selector,
    })) as { nodeId: number };
    if (!found.nodeId) throw new Error(`No file input for ${selector}.`);
    await this.send("DOM.setFileInputFiles", { nodeId: found.nodeId, files });
  }

  async type(text: string): Promise<void> {
    await this.send("Input.insertText", { text });
  }

  /** Saves a PNG of the viewport, or of the whole page when `fullPage` is set. */
  async screenshot(file: string, fullPage = false): Promise<void> {
    let clip: Json | undefined;
    if (fullPage) {
      const size = await this.evaluate<{ w: number; h: number }>(
        "({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight })",
      );
      clip = { x: 0, y: 0, width: size.w, height: size.h, scale: 1 };
    }
    const shot = (await this.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: fullPage,
      ...(clip ? { clip } : {}),
    })) as { data: string };
    writeFileSync(file, Buffer.from(shot.data, "base64"));
  }

  close(): void {
    this.socket.close();
  }
}

export interface Browser {
  newPage(): Promise<Page>;
  close(): Promise<void>;
}

/** Starts a headless Chrome on a throwaway profile and returns a handle that opens fresh pages. */
export async function launchBrowser(port = 9333): Promise<Browser> {
  const profile = mkdtempSync(path.join(tmpdir(), "sms-chrome-"));
  const child: ChildProcess = spawn(
    findChrome(),
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--hide-scrollbars",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  const endpoint = `http://127.0.0.1:${port}`;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fetch(`${endpoint}/json/version`);
      break;
    } catch {
      if (attempt > 50) throw new Error("Chrome did not start.");
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  return {
    async newPage() {
      const response = await fetch(`${endpoint}/json/new?about:blank`, { method: "PUT" });
      const target = (await response.json()) as { webSocketDebuggerUrl: string };
      const page = await Page.connect(target.webSocketDebuggerUrl);
      await page.send("Network.enable");
      return page;
    },
    async close() {
      child.kill();
      await new Promise((resolve) => setTimeout(resolve, 500));
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {
        // Chrome may still hold the profile on Windows; it is a temp directory, so leave it.
      }
    },
  };
}
