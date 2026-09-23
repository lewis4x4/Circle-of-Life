import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import baseline from "./pale-text-baseline.json";
import { countPaleText } from "./pale-text";

/**
 * Ratchet (COL-658): the per-file count of hard-coded pale grey text may only
 * go down. New code uses the design-system tokens; when you convert a file,
 * lower (or delete) its entry in pale-text-baseline.json.
 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

describe("hard-coded pale grey text ratchet (COL-658)", () => {
  const allowed = baseline as Record<string, number>;

  it("matches only non-dark pale grey text utilities", () => {
    expect(countPaleText('className="text-slate-400 dark:text-zinc-500 text-slate-900"')).toBe(1);
    expect(countPaleText('className="hover:text-zinc-500 text-muted-foreground"')).toBe(0);
    expect(countPaleText("cn('text-stone-500', open && 'text-gray-300')")).toBe(2);
  });

  it("does not add pale grey text to any file", () => {
    const grown: string[] = [];
    for (const file of sourceFiles("src")) {
      const count = countPaleText(readFileSync(file, "utf8"));
      const limit = allowed[file] ?? 0;
      if (count > limit) grown.push(`${file}: ${count} (allowed ${limit})`);
    }
    expect(grown, "use text-muted-foreground instead of hard-coded slate/zinc/stone/gray text").toEqual([]);
  });
});
