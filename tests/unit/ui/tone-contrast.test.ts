import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// D-017: badge text must have at least 4.5:1 contrast against its background in BOTH themes. The tone colours are
// plain hex custom properties in app/globals.css, so this reads them from the file the browser will load.

const css = readFileSync(path.join(import.meta.dirname, "../../../app/globals.css"), "utf8");

/** The declarations inside the first top-level block that starts with `selector {`. */
function block(selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  if (start < 0) throw new Error(`No ${selector} block in globals.css`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("\n}", open);
  return css.slice(open + 1, close);
}

function tokens(selector: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of block(selector).matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    result[match[1]!] = match[2]!;
  }
  return result;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

const TONES = ["green", "amber", "grey", "blue", "red"] as const;

describe("status badge tone contrast (D-017)", () => {
  describe.each([
    ["light", ":root"],
    ["dark", ".dark"],
  ])("%s theme", (_name, selector) => {
    const theme = tokens(selector);

    it.each(TONES)("%s text on %s background is at least 4.5:1", (tone) => {
      const background = theme[`tone-${tone}-bg`];
      const foreground = theme[`tone-${tone}-fg`];
      expect(background, `--tone-${tone}-bg`).toBeDefined();
      expect(foreground, `--tone-${tone}-fg`).toBeDefined();
      expect(contrast(background!, foreground!)).toBeGreaterThanOrEqual(4.5);
    });
  });

  // The dashboard's ageing bar: graphics need 3:1 against the card they sit on (white; the dark card is about #171717).
  describe.each([
    ["light", ":root", "#ffffff"],
    ["dark", ".dark", "#171717"],
  ])("ageing bar segments in the %s theme", (_name, selector, card) => {
    it.each(["ageing-1", "ageing-2", "ageing-3"])(
      "%s is at least 3:1 against the card",
      (token) => {
        const colour = tokens(selector)[token];
        expect(colour, `--${token}`).toBeDefined();
        expect(contrast(colour!, card)).toBeGreaterThanOrEqual(3);
      },
    );
  });

  it("the brand colour carries white button text at 4.5:1 or better", () => {
    expect(contrast(tokens(":root").brand!, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("measures contrast correctly (black on white is 21:1)", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
  });
});
