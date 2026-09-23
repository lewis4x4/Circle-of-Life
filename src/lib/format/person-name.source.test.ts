import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * COL-686 — Haven shows a person as "First Last" on every screen. Hand-built
 * "Last, First" strings are how the audit found five different name orders.
 * Exports that mirror a surname-sorted paper sheet use
 * `formatPersonNameLastFirst` from `@/lib/format/datetime`, never a template.
 */
const LAST_FIRST_PATTERNS: RegExp[] = [
  // `${x.last_name}, ${x.first_name}` / `${x.lastName}, ${x.firstName}`
  /\$\{[\w.?]*last_?[nN]ame\}\s*,\s*\$\{[\w.?]*(first_?[nN]ame|preferred_?[nN]ame)/,
  // [x.lastName, x.firstName].filter(Boolean).join(", ")
  /\[[\w.?]*last_?[nN]ame\s*,\s*[\w.?]*first_?[nN]ame\][^;\n]*join\(\s*["'], ["']\s*\)/,
  // x.last_name + ", " + x.first_name
  /last_?[nN]ame\s*\+\s*["'], ["']\s*\+/,
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("person names read First Last", () => {
  it("no source file builds a Last, First name by hand", () => {
    const root = path.resolve(__dirname, "../..");
    const offenders = sourceFiles(root).flatMap((file) => {
      const text = fs.readFileSync(file, "utf8");
      return LAST_FIRST_PATTERNS.some((re) => re.test(text)) ? [path.relative(path.resolve(root, ".."), file)] : [];
    });
    expect(offenders).toEqual([]);
  });
});
