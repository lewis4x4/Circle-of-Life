/**
 * `useHavenAuth()` throws outside `HavenAuthProvider`. Role shells re-export
 * admin pages (Required reading is `(admin)/admin/acknowledgments/my`), so a
 * route group whose layout does not mount the provider crashes the moment one
 * of its pages reaches a component that reads the context. COL-637.
 *
 * This walks the static import graph from every file under each route group
 * and fails if a group without the provider can reach a `useHavenAuth(` call.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const srcDir = path.join(repoRoot, "src");
const appDir = path.join(srcDir, "app");
const contextFile = path.join(srcDir, "contexts/haven-auth-context.tsx");

const IMPORT_RE =
  /(?:import|export)\s+(?:type\s+)?(?:[^"';]*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
const EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];

function resolveImport(specifier: string, fromFile: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = path.join(srcDir, specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(fromFile), specifier);
  else return null;

  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const ext of EXTENSIONS) if (existsSync(base + ext)) return base + ext;
  for (const ext of EXTENSIONS) {
    const index = path.join(base, `index${ext}`);
    if (existsSync(index)) return index;
  }
  return null;
}

function sourceFilesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFilesUnder(full);
    return /\.(tsx?|jsx?)$/.test(entry) && !/\.test\.(tsx?|jsx?)$/.test(entry) ? [full] : [];
  });
}

/** Returns the import chain to the first file that calls useHavenAuth(), or null. */
function chainToHavenAuthCall(entries: string[]): string[] | null {
  const parent = new Map<string, string | null>();
  const queue: string[] = [];
  for (const entry of entries) {
    parent.set(entry, null);
    queue.push(entry);
  }

  while (queue.length > 0) {
    const file = queue.shift()!;
    const source = readFileSync(file, "utf8");
    if (file !== contextFile && /\buseHavenAuth\s*\(/.test(source)) {
      const chain: string[] = [];
      for (let at: string | null = file; at; at = parent.get(at) ?? null) {
        chain.unshift(path.relative(repoRoot, at));
      }
      return chain;
    }
    for (const match of source.matchAll(IMPORT_RE)) {
      const resolved = resolveImport(match[1] ?? match[2], file);
      if (resolved && !parent.has(resolved)) {
        parent.set(resolved, file);
        queue.push(resolved);
      }
    }
  }
  return null;
}

const routeGroups = readdirSync(appDir).filter(
  (entry) =>
    entry.startsWith("(") &&
    entry.endsWith(")") &&
    statSync(path.join(appDir, entry)).isDirectory(),
);

describe("HavenAuthProvider covers every route group that needs it", () => {
  it("finds route groups to check", () => {
    expect(routeGroups).toEqual(expect.arrayContaining(["(med-tech)", "(dietary)", "(caregiver)"]));
  });

  it.each(routeGroups)("%s mounts the provider or never reaches useHavenAuth()", (group) => {
    const groupDir = path.join(appDir, group);
    const layout = readFileSync(path.join(groupDir, "layout.tsx"), "utf8");
    if (layout.includes("<HavenAuthProvider")) return;

    const chain = chainToHavenAuthCall(sourceFilesUnder(groupDir));
    expect(chain, chain ? `${group} reaches useHavenAuth() via ${chain.join(" -> ")}` : "").toBeNull();
  });

  it("the role shells that re-export Required reading mount the provider", () => {
    for (const group of ["(med-tech)", "(dietary)"]) {
      const layout = readFileSync(path.join(appDir, group, "layout.tsx"), "utf8");
      expect(layout, group).toContain("<HavenAuthProvider");
    }
  });
});
