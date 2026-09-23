import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * COL-652 — one way to show a stored enum. Screens rendered `wrong_medication`, `AT_RISK`
 * and "Ceo" because each did its own `.replace(/_/g, " ")`. In rendering code (routes,
 * components, features) that call is gone; use `enumLabel` from `@/lib/display/enum-label`,
 * with a domain override map where the right word is not the spelling.
 */
const ROOT = path.resolve(__dirname, "../../..");
const RENDERING_DIRS = ["src/app", "src/components", "src/features"];
const AD_HOC = /\.replace\(\/_\/g,\s*["'] ["']\)/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("stored enums reach the screen through enumLabel (COL-652)", () => {
  it("no rendering code turns underscores into spaces by hand", () => {
    const findings = RENDERING_DIRS.flatMap((dir) => walk(path.join(ROOT, dir))).flatMap((file) =>
      fs
        .readFileSync(file, "utf8")
        .split(/\r?\n/)
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => AD_HOC.test(line))
        .map(({ line, index }) => `${path.relative(ROOT, file)}:${index + 1} ${line.trim()}`),
    );
    expect(findings).toEqual([]);
  });
});
