import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { launchBrowser } from "./browser/cdp";

// Renders the Mermaid ER diagram in db/er-diagram.md to db/er-diagram.png (white background, 2x resolution).
//
//   npm run er:png
//
// Uses the installed Chrome or Edge (see scripts/browser/cdp.ts) and loads the mermaid library from a pinned CDN URL,
// so it needs an internet connection but adds no dependency. Re-run it whenever the diagram changes.

const MERMAID_URL = "https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js";
const SOURCE = path.resolve("db/er-diagram.md");
const TARGET = path.resolve("db/er-diagram.png");
const SCALE = 2;

function extractDiagram(markdown: string): string {
  const match = /```mermaid\r?\n([\s\S]*?)```/.exec(markdown);
  if (!match?.[1]) throw new Error(`No mermaid block found in ${SOURCE}.`);
  return match[1];
}

async function main() {
  const diagram = extractDiagram(readFileSync(SOURCE, "utf8"));
  const dir = mkdtempSync(path.join(tmpdir(), "sms-er-"));
  const html = path.join(dir, "er.html");
  writeFileSync(
    html,
    `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body { margin: 0; background: #ffffff; }
      #wrap { display: inline-block; padding: 24px; background: #ffffff; }
    </style>
    <script src="${MERMAID_URL}"></script>
  </head>
  <body>
    <div id="wrap"><pre class="mermaid" id="diagram">${diagram
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")}</pre></div>
  </body>
</html>`,
  );

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport(1600, 1200);
    await page.navigate(pathToFileURL(html).href, 500);
    const failure = await page.evaluate<string | null>(`(async () => {
      if (!window.mermaid) return "mermaid did not load (is the machine online?)";
      try {
        mermaid.initialize({ startOnLoad: false, theme: "default", securityLevel: "strict", er: { useMaxWidth: false } });
        await mermaid.run({ querySelector: "#diagram" });
        const svg = document.querySelector("#diagram svg");
        if (!svg) return "mermaid produced no SVG";
        // Draw it at its natural size instead of stretching to the page width.
        const box = svg.viewBox.baseVal;
        svg.style.maxWidth = "none";
        svg.setAttribute("width", String(Math.ceil(box.width)));
        svg.setAttribute("height", String(Math.ceil(box.height)));
        return null;
      } catch (error) {
        return String(error);
      }
    })()`);
    if (failure) throw new Error(failure);

    const size = await page.evaluate<{ width: number; height: number }>(`(() => {
      const r = document.getElementById("wrap").getBoundingClientRect();
      return { width: Math.ceil(r.width), height: Math.ceil(r.height) };
    })()`);
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: size.width,
      height: size.height,
      deviceScaleFactor: SCALE,
      mobile: false,
    });
    await page.settle(300);
    const shot = (await page.send("Page.captureScreenshot", {
      format: "png",
      clip: { x: 0, y: 0, width: size.width, height: size.height, scale: 1 },
    })) as { data: string };
    writeFileSync(TARGET, Buffer.from(shot.data, "base64"));
    console.log(`Wrote ${TARGET} (${size.width * SCALE} x ${size.height * SCALE} px)`);
    page.close();
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
