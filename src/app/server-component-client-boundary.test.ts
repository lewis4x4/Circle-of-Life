import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * COL-642 guard: a Server Component under src/app must not
 *   1. call a function exported from a "use client" module (on the server that
 *      import is a client reference, so calling it throws), or
 *   2. render a component from a non-"use client" module that calls React hooks
 *      (hooks do not exist in the RSC render).
 * Either one crashes the page in production as React error #441 with no clue
 * in the UI. The report template detail page did both (`buttonVariants()` and
 * `<Badge>`).
 */

const repoRoot = process.cwd();
const appDir = path.join(repoRoot, "src/app");
const srcDir = path.join(repoRoot, "src");

const USE_CLIENT = /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/;
const HOOK_CALL = /\buse[A-Z]\w*\s*\(/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx|ts)$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function resolveAlias(spec: string): string | null {
  if (!spec.startsWith("@/")) return null;
  const base = path.join(srcDir, spec.slice(2));
  for (const candidate of [`${base}.tsx`, `${base}.ts`, path.join(base, "index.tsx"), path.join(base, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

type NamedImport = { name: string; from: string; file: string };

function namedImports(source: string): NamedImport[] {
  const out: NamedImport[] = [];
  const re = /import\s+(?!type\b)\{([^}]*)\}\s+from\s+["']([^"']+)["']/g;
  for (const match of source.matchAll(re)) {
    const file = resolveAlias(match[2]);
    if (!file) continue;
    for (const raw of match[1].split(",")) {
      const part = raw.trim();
      if (!part || part.startsWith("type ")) continue;
      const local = part.split(/\s+as\s+/).pop()!.trim();
      out.push({ name: local, from: match[2], file });
    }
  }
  return out;
}

// Barrel modules (index.ts) re-export components; follow one level so a hook
// inside the real component file is still seen.
function moduleSources(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const sources = [source];
  if (/index\.tsx?$/.test(file)) {
    for (const m of source.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
      const base = path.join(path.dirname(file), m[1]);
      for (const candidate of [`${base}.tsx`, `${base}.ts`]) {
        if (existsSync(candidate)) sources.push(readFileSync(candidate, "utf8"));
      }
    }
  }
  return sources;
}

function serverComponentViolations(): string[] {
  const violations: string[] = [];
  for (const file of walk(appDir)) {
    const source = readFileSync(file, "utf8");
    if (USE_CLIENT.test(source)) continue;
    if (!/\.tsx$/.test(file)) continue;
    const rel = path.relative(repoRoot, file);
    for (const imp of namedImports(source)) {
      const target = readFileSync(imp.file, "utf8");
      const targetIsClient = USE_CLIENT.test(target);
      const isComponent = /^[A-Z]/.test(imp.name);
      if (targetIsClient && !isComponent && new RegExp(`\\b${imp.name}\\s*\\(`).test(source)) {
        violations.push(`${rel}: calls ${imp.name}() from "use client" module ${imp.from}`);
      }
      if (!targetIsClient && isComponent && new RegExp(`<${imp.name}[\\s/>]`).test(source)) {
        if (moduleSources(imp.file).some((s) => !USE_CLIENT.test(s) && HOOK_CALL.test(s))) {
          violations.push(`${rel}: renders <${imp.name}> from ${imp.from}, which calls hooks without "use client"`);
        }
      }
    }
  }
  return violations;
}

describe("server components respect the client boundary (COL-642)", () => {
  it("no server component calls a client-module function or renders a hook-using non-client component", () => {
    expect(serverComponentViolations()).toEqual([]);
  });

  it("the report template detail page renders through a client component", () => {
    const page = readFileSync(
      path.join(appDir, "(admin)/reports/templates/[slug]/page.tsx"),
      "utf8",
    );
    expect(page).not.toMatch(/buttonVariants|@\/components\/ui\/badge/);
    expect(page).toContain("ReportTemplateDetail");
  });
});
