/**
 * Every table an operations route reads through the session is either governed
 * by the operations authority at the database or named as an exception with a
 * reason — COL-291.
 *
 * The lists live in supabase/tests/review_hfo_operations_reader_authority.sql,
 * which proves the database half (each GOVERNED table carries a gate policy).
 * This test proves the code half: no operations route or helper reads a table
 * that is in neither list. Adding a `.from("new_table")` to an operations
 * reader therefore fails here until the table is either gate-governed and
 * listed, or excepted with a written reason.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const probePath = path.join(repoRoot, "supabase/tests/review_hfo_operations_reader_authority.sql");
const readerRoots = ["src/app/api/admin/operations", "src/lib/operations"];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

function listBetween(source: string, begin: string, end: string): string[] {
  const start = source.indexOf(begin);
  const stop = source.indexOf(end);
  if (start < 0 || stop < 0 || stop < start) throw new Error(`${begin} … ${end} block missing from the probe`);
  const block = source.slice(start, stop);
  return [...block.matchAll(/\('([a-z_]+)'/g)].map((m) => m[1]);
}

const probe = readFileSync(probePath, "utf8");
const governed = listBetween(probe, "-- GOVERNED-BEGIN", "-- GOVERNED-END");
const exceptions = listBetween(probe, "-- EXCEPTIONS-BEGIN", "-- EXCEPTIONS-END");

const readerFiles = readerRoots.flatMap((root) => walk(path.join(repoRoot, root)));
const tablesRead = new Map<string, string[]>();
for (const file of readerFiles) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/\.from\(\s*"([a-z_]+)"/g)) {
    const table = match[1];
    const readers = tablesRead.get(table) ?? [];
    readers.push(path.relative(repoRoot, file));
    tablesRead.set(table, readers);
  }
}

describe("operations readers and the authority that governs their tables (COL-291)", () => {
  it("parses both lists from the probe", () => {
    expect(governed.length).toBeGreaterThan(0);
    expect(exceptions.length).toBeGreaterThan(0);
    expect(governed.filter((t) => exceptions.includes(t))).toEqual([]);
    expect(new Set(governed).size).toBe(governed.length);
    expect(new Set(exceptions).size).toBe(exceptions.length);
  });

  it("finds the operations readers this repo actually has", () => {
    expect(readerFiles.length).toBeGreaterThan(20);
    expect(tablesRead.size).toBeGreaterThan(10);
  });

  it("reads no table that is in neither list", () => {
    const unlisted = [...tablesRead.entries()]
      .filter(([table]) => !governed.includes(table) && !exceptions.includes(table))
      .map(([table, readers]) => `${table} ← ${readers.join(", ")}`);
    expect(unlisted, "add the table to GOVERNED (with a gate policy) or EXCEPTIONS (with a reason) in the probe").toEqual([]);
  });

  it("lists no table that nothing reads any more", () => {
    const stale = [...governed, ...exceptions].filter((table) => !tablesRead.has(table));
    expect(stale, "remove the table from the probe so the list stays true").toEqual([]);
  });

  it("every operations route resolves the actor through requireOperationsActor, itself or via an operations helper it imports", () => {
    const operationsLib = path.join(repoRoot, "src/lib/operations");
    const resolvesActor = (file: string, seen = new Set<string>()): boolean => {
      if (seen.has(file)) return false;
      seen.add(file);
      const source = readFileSync(file, "utf8");
      if (source.includes("requireOperationsActor")) return true;
      const helpers = [...source.matchAll(/from "@\/lib\/operations\/([a-z0-9-]+)"/g)].map((m) => path.join(operationsLib, `${m[1]}.ts`));
      return helpers.some((helper) => statSync(helper, { throwIfNoEntry: false })?.isFile() && resolvesActor(helper, seen));
    };
    const routes = readerFiles.filter((file) => file.startsWith(path.join(repoRoot, "src/app/api/admin/operations")) && file.endsWith("route.ts"));
    const ungated = routes.filter((file) => !resolvesActor(file)).map((f) => path.relative(repoRoot, f));
    expect(ungated, "an operations route reads without resolving the operations actor").toEqual([]);
  });
});
