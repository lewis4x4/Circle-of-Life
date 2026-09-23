import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards against Tailwind variant prefixes with no utility after them
 * (`hover: hover:`, `dark:"`). Codemod 83ad5e84 stripped gradient stops and
 * left these behind, which silently removed the fill from submit buttons and
 * rendered them white-on-white.
 */

const repoRoot = process.cwd();
const srcRoot = path.join(repoRoot, "src");

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const SKIPPED_FILES = new Set([path.join(srcRoot, "types/database.ts")]);
const VARIANTS =
  "hover|focus|focus-visible|focus-within|active|disabled|dark|group-hover|peer-hover|placeholder|first|last|sm|md|lg|xl|2xl";
const STRING_LITERAL = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
const EMPTY_VARIANT = new RegExp(`(?:^|\\s)(?:${VARIANTS}):(?=\\s|$)`);
// Only judge strings that look like class lists, so prose such as "Status active: 3" is ignored.
const CLASS_LIST_HINT = /(?:^|\s)(?:[a-z0-9-]+:)*(?:bg|text|border|rounded|flex|grid|p[xytrbl]?|m[xytrbl]?|shadow|w|h)-/;

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const fullPath = path.join(directory, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      return collectSourceFiles(fullPath);
    }

    if (
      !SOURCE_EXTENSIONS.has(path.extname(fullPath)) ||
      fullPath.includes(".test.") ||
      SKIPPED_FILES.has(fullPath)
    ) {
      return [];
    }

    return [fullPath];
  });
}

function findEmptyVariantPrefixes(source: string): string[] {
  const hits: string[] = [];
  for (const literal of source.match(STRING_LITERAL) ?? []) {
    const body = literal.slice(1, -1);
    if (CLASS_LIST_HINT.test(body) && EMPTY_VARIANT.test(body)) {
      hits.push(body.trim());
    }
  }
  return hits;
}

describe("Tailwind class lists", () => {
  it("flags a variant prefix with nothing after it", () => {
    expect(findEmptyVariantPrefixes(`className="w-full shadow-lg text-white hover: hover: text-lg"`)).toHaveLength(1);
    expect(findEmptyVariantPrefixes(`className="p-2 dark:bg-zinc-950/95 dark:"`)).toHaveLength(1);
    expect(findEmptyVariantPrefixes(`className="bg-primary hover:bg-primary/90 dark:shadow-none"`)).toEqual([]);
    expect(findEmptyVariantPrefixes(`label: "Status active: 3"`)).toEqual([]);
  });

  it("never carries an empty variant prefix anywhere in src", () => {
    const offenders = collectSourceFiles(srcRoot).flatMap((sourcePath) =>
      findEmptyVariantPrefixes(readFileSync(sourcePath, "utf8")).map(
        (hit) => `${path.relative(repoRoot, sourcePath)}: ${hit}`,
      ),
    );

    expect(offenders).toEqual([]);
  });
});
