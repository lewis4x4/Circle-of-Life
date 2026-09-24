#!/usr/bin/env node
/**
 * Owner rule (COL-677 / COL-694): nothing in this branch may reference an
 * object created by migration 476 (supabase/migrations/476_med_tech_shift_from_time_clock.sql).
 *
 * 1. Parses 476 and lists every object it creates: tables, indexes, policies,
 *    triggers, functions, and the columns it adds to existing tables.
 * 2. Collects the files this branch touches: `git diff --name-only
 *    origin/main...HEAD` plus the working tree (modified, added, untracked).
 * 3. Searches those files for every object name. A table's added columns are
 *    searched qualified (`<table>.<column>`) and, for names specific enough to
 *    mean nothing else (`opened_from`, `rule_id`), bare as well; the table they
 *    were added to is searched too, since touching it at all needs a look.
 *
 * Prints the object list and every hit; exits 1 on any hit.
 *
 *   node scripts/floor/check-no-476-references.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATION = "supabase/migrations/476_med_tech_shift_from_time_clock.sql";
const SELF = "scripts/floor/check-no-476-references.mjs";

const git = (...args) => execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });

function stripComments(sql) {
  // Comments and string literals (COMMENT ON text says "CREATE TRIGGER time").
  return sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/'(?:[^']|'')*'/g, "''");
}

function objectsIn(sql) {
  const body = stripComments(sql);
  const found = [];
  const add = (kind, name, pattern = name) => {
    if (!found.some((o) => o.kind === kind && o.name === name)) found.push({ kind, name, pattern });
  };
  const ident = String.raw`(?:"?[a-z_][a-z0-9_]*"?\.)?"?([a-z_][a-z0-9_]*)"?`;
  for (const m of body.matchAll(new RegExp(String.raw`create\s+table\s+(?:if\s+not\s+exists\s+)?${ident}`, "gi"))) add("table", m[1]);
  for (const m of body.matchAll(new RegExp(String.raw`create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?${ident}`, "gi"))) add("index", m[1]);
  for (const m of body.matchAll(/create\s+policy\s+(?:"([^"]+)"|([a-z_][a-z0-9_]*))\s+on/gi)) add("policy", m[1] ?? m[2]);
  for (const m of body.matchAll(new RegExp(String.raw`create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+${ident}`, "gi"))) add("trigger", m[1]);
  for (const m of body.matchAll(new RegExp(String.raw`create\s+(?:or\s+replace\s+)?function\s+${ident}`, "gi"))) add("function", m[1]);
  // Columns added to tables the migration did not create.
  for (const m of body.matchAll(new RegExp(String.raw`alter\s+table\s+(?:only\s+)?${ident}([\s\S]*?);`, "gi"))) {
    const table = m[1];
    for (const c of m[2].matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?/gi)) {
      add("column", `${table}.${c[1]}`, `${table}\\s*\\.\\s*${c[1]}`);
      if (["opened_from", "opened_from_id", "rule_id"].includes(c[1])) add("column (bare)", c[1]);
      add("altered table", table);
    }
  }
  return found;
}

function branchFiles() {
  const files = new Set();
  const base = git("merge-base", "origin/main", "HEAD").trim();
  for (const line of git("diff", "--name-only", `${base}...HEAD`).split("\n")) if (line) files.add(line);
  for (const line of git("status", "--porcelain", "--untracked-files=all").split("\n")) {
    if (!line) continue;
    const status = line.slice(0, 2);
    const file = line.slice(3).split(" -> ").pop();
    if (status.includes("D")) continue;
    files.add(file);
  }
  files.delete(MIGRATION);
  files.delete(SELF);
  return [...files].filter((file) => existsSync(path.join(REPO_ROOT, file)) && !/\.(png|jpg|jpeg|gif|webp|ico|pdf)$/i.test(file)).sort();
}

function main() {
  const sql = readFileSync(path.join(REPO_ROOT, MIGRATION), "utf8");
  const objects = objectsIn(sql);
  console.log(`Objects created or added by ${MIGRATION}:`);
  for (const o of objects) console.log(`  ${o.kind.padEnd(14)} ${o.name}`);

  const files = branchFiles();
  console.log(`\nFiles in this branch (diff against origin/main plus working tree): ${files.length}`);
  const hits = [];
  for (const file of files) {
    const text = readFileSync(path.join(REPO_ROOT, file), "utf8");
    const lines = text.split("\n");
    for (const o of objects) {
      const re = new RegExp(String.raw`(^|[^a-z0-9_])${o.pattern}($|[^a-z0-9_])`, "i");
      lines.forEach((line, i) => {
        if (re.test(line)) hits.push(`${file}:${i + 1}  [${o.kind} ${o.name}]  ${line.trim().slice(0, 140)}`);
      });
    }
  }
  if (hits.length > 0) {
    console.log(`\nREFERENCES FOUND (${hits.length}):`);
    for (const hit of hits) console.log(`  ${hit}`);
    process.exit(1);
  }
  console.log(`\nPASS: no file in this branch references any of the ${objects.length} objects above.`);
}

main();
