import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { INTAKE_TYPE_QUESTIONS } from "../../../supabase/functions/_shared/intake-type-questions";

const MIGRATIONS = path.join(process.cwd(), "supabase", "migrations");

// Payment evidence never reaches Jev (no AI on check images).
const NEVER_ASKED = new Set(["payment_evidence"]);

/** Codes seeded by a catalog seed function's VALUES rows: each row starts with ('<code>','. */
function seededCodes(sql: string): string[] {
  const codes: string[] = [];
  const row = /^\s*\('([a-z0-9_]+)','/gm;
  for (const m of sql.matchAll(row)) codes.push(m[1]);
  return codes;
}

function catalogSeedSql(): string {
  const sql = readFileSync(path.join(MIGRATIONS, "545_document_intake.sql"), "utf8");
  const start = sql.indexOf("CREATE FUNCTION haven.document_intake_seed_catalog");
  expect(start).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf("END $$;", start);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}

/** Later migrations that insert catalog rows directly. */
function laterCatalogCodes(): string[] {
  const codes: string[] = [];
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    if (file === "545_document_intake.sql") continue;
    const sql = readFileSync(path.join(MIGRATIONS, file), "utf8");
    if (!/INSERT\s+INTO\s+(public\.)?document_intake_catalog/i.test(sql)) continue;
    codes.push(...seededCodes(sql));
  }
  return codes;
}

describe("document intake catalog has a question set for every Jev type", () => {
  const seeded = seededCodes(catalogSeedSql());
  const all = [...new Set([...seeded, ...laterCatalogCodes()])];

  it("parses the migration 545 seed", () => {
    expect(seeded.length).toBeGreaterThanOrEqual(29);
    expect(seeded).toContain("form_1823");
    expect(seeded).toContain("unknown");
  });

  it.each(all.filter((code) => !NEVER_ASKED.has(code)))("%s has an INTAKE_TYPE_QUESTIONS entry", (code) => {
    expect(INTAKE_TYPE_QUESTIONS[code]).toBeDefined();
  });
});
