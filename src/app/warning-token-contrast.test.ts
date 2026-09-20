import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The orange warning tokens are read as text and as chart marks on the surfaces
 * defined in the same theme block. They were light enough in both themes to sit
 * under the WCAG AA 4.5:1 threshold on at least one of those surfaces, so this
 * pins the contrast rather than the hex — retuning the hue is fine, going pale
 * again is not.
 */

const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");

/** WCAG AA for normal-size text. */
const AA_NORMAL_TEXT = 4.5;

type Rgb = readonly [number, number, number];

function hslToRgb(h: number, s: number, l: number): Rgb {
  const sat = s / 100;
  const lum = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(lum, 1 - lum);
  const f = (n: number) => lum - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function hexToRgb(hex: string): Rgb {
  const raw = hex.replace("#", "");
  return [
    parseInt(raw.slice(0, 2), 16),
    parseInt(raw.slice(2, 4), 16),
    parseInt(raw.slice(4, 6), 16),
  ];
}

function relativeLuminance([r, g, b]: Rgb): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Text of a single top-level rule block, e.g. `:root { … }`. */
function themeBlock(selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, `theme block ${selector} not found in globals.css`).toBeGreaterThan(-1);
  const end = css.indexOf("\n}", start);
  expect(end, `theme block ${selector} is unterminated`).toBeGreaterThan(start);
  return css.slice(start, end);
}

function tokenValue(block: string, token: string): string {
  const match = new RegExp(`--${token}:\\s*([^;]+);`).exec(block);
  expect(match, `--${token} not declared in this theme block`).not.toBeNull();
  return match![1].trim();
}

/** Accepts both token shapes used in globals.css: bare `H S% L%` and `#rrggbb`. */
function tokenRgb(block: string, token: string): Rgb {
  const value = tokenValue(block, token);
  if (value.startsWith("#")) return hexToRgb(value);
  const hsl = /^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/.exec(value);
  expect(hsl, `--${token} is "${value}", which is neither a hex nor a bare HSL triple`).not.toBeNull();
  return hslToRgb(Number(hsl![1]), Number(hsl![2]), Number(hsl![3]));
}

/** Hue in degrees, so "still orange" is assertable after a retune. */
function hue([r, g, b]: Rgb): number {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  if (delta === 0) return 0;
  const raw =
    max === rn ? ((gn - bn) / delta) % 6 : max === gn ? (bn - rn) / delta + 2 : (rn - gn) / delta + 4;
  return (raw * 60 + 360) % 360;
}

/**
 * Alpha-composite `fg` over `bg` — the browser's `color-mix`-free equivalent of
 * a Tailwind `/NN` opacity utility painted on an opaque surface.
 */
function composite(fg: Rgb, bg: Rgb, alpha: number): Rgb {
  return [
    Math.round(fg[0] * alpha + bg[0] * (1 - alpha)),
    Math.round(fg[1] * alpha + bg[1] * (1 - alpha)),
    Math.round(fg[2] * alpha + bg[2] * (1 - alpha)),
  ];
}

const THEMES = [":root", ".light", ".dark"] as const;
const WARNING_TOKENS = ["warning", "chart-3", "compliance-warning"] as const;

describe("orange warning tokens meet AA on their own theme surfaces", () => {
  for (const theme of THEMES) {
    for (const token of WARNING_TOKENS) {
      it(`${theme} --${token} clears ${AA_NORMAL_TEXT}:1 on --background and --card`, () => {
        const block = themeBlock(theme);
        const fg = tokenRgb(block, token);

        for (const surface of ["background", "card"] as const) {
          const bg = tokenRgb(block, surface);
          expect(
            contrastRatio(fg, bg),
            `${theme} --${token} on --${surface}`,
          ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
        }
      });

      it(`${theme} --${token} stays in the orange band, not red`, () => {
        // Orange, not the red that --destructive owns (8°) and not yellow-green.
        expect(hue(tokenRgb(themeBlock(theme), token))).toBeGreaterThanOrEqual(20);
        expect(hue(tokenRgb(themeBlock(theme), token))).toBeLessThanOrEqual(45);
      });
    }
  }

  it("keeps --warning, --chart-3 and --compliance-warning the same colour in each theme", () => {
    for (const theme of THEMES) {
      const block = themeBlock(theme);
      const [warning, chart3, compliance] = WARNING_TOKENS.map((t) => tokenRgb(block, t));
      expect(chart3, `${theme} --chart-3 drifted from --warning`).toEqual(warning);
      expect(compliance, `${theme} --compliance-warning drifted from --warning`).toEqual(warning);
    }
  });
});

/**
 * COL-432. `warning on --background` clearing AA is not the same question as
 * "is the warning StatusPill readable" — the pill paints its own surface
 * (`bg-warning/10`) under its own text (`text-warning`), which drags the
 * surface toward the text colour and eats the margin. The light warning tone
 * measured 4.03:1 on that tint while passing 4.58:1 on bare `--background`,
 * so the surface the pill actually uses has to be modelled explicitly.
 *
 * `STATUS_PILL_TINT` mirrors `pillVariants` in
 * `src/components/ui/status-pill.tsx` — bump it here if the `/10` changes there.
 */
const STATUS_PILL_TINT_PERCENT = 10;
const STATUS_PILL_TINT = STATUS_PILL_TINT_PERCENT / 100;

/** Opaque surfaces a StatusPill is placed on in the admin/detail shells. */
const PILL_SURFACES = ["background", "card"] as const;

/**
 * Tone → token, matching `pillVariants`. `muted` is excluded: it renders
 * `bg-transparent text-muted-foreground`, so it has no tint to model.
 */
const PILL_TONES = {
  warning: "warning",
  success: "success",
  danger: "destructive",
  info: "info",
} as const;

type PillTone = keyof typeof PILL_TONES;

const PILL_TONE_NAMES = Object.keys(PILL_TONES) as PillTone[];

/**
 * Only `warning` is held to AA here — it is the tone COL-432 fixed. The other
 * tones are recorded so a regression is visible, and floored at the 3:1
 * non-text/large-text threshold; several of them sit between 3:1 and 4.5:1 on
 * their own tint today and deepening them is a separate, wider change.
 */
const AA_ENFORCED_TONES = new Set<PillTone>(["warning"]);
const LARGE_TEXT_FLOOR = 3;

describe("StatusPill tones on their own tinted surface", () => {
  for (const theme of THEMES) {
    for (const tone of PILL_TONE_NAMES) {
      const token = PILL_TONES[tone];
      const threshold = AA_ENFORCED_TONES.has(tone) ? AA_NORMAL_TEXT : LARGE_TEXT_FLOOR;

      it(`${theme} tone="${tone}" clears ${threshold}:1 on bg-${token}/${STATUS_PILL_TINT_PERCENT}`, () => {
        const block = themeBlock(theme);
        const fg = tokenRgb(block, token);

        for (const surface of PILL_SURFACES) {
          const tinted = composite(fg, tokenRgb(block, surface), STATUS_PILL_TINT);
          const ratio = contrastRatio(fg, tinted);
          expect(
            ratio,
            `${theme} tone="${tone}" text on bg-${token}/${STATUS_PILL_TINT_PERCENT} over --${surface} measured ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(threshold);
        }
      });
    }
  }
});
