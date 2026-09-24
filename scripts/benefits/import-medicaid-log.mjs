#!/usr/bin/env node
/**
 * COL-773 step 2: match Jessica's Medicaid Log rows to Haven residents, then import only the rows a person approved.
 *
 *   # read-only: writes a mapping CSV for review (outside the repo)
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/benefits/import-medicaid-log.mjs match \
 *     --log ~/haven-imports/medicaid-log.json --org <organization uuid> --out ~/haven-imports/medicaid-log-mapping.csv
 *
 *   # writes: only rows whose `decision` column is "import" and that name a resident_id
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/benefits/import-medicaid-log.mjs import \
 *     --log ~/haven-imports/medicaid-log.json --mapping ~/haven-imports/medicaid-log-mapping.csv \
 *     --org <organization uuid> --actor-email <importer's Haven email> [--confirm-production]
 *
 * Resident data never enters the repository: --log/--mapping/--out must be outside it. No resident is ever
 * created; unmatched rows are reported. Imports go through the service-only RPC benefits_log_import_row
 * (migration 527), which is idempotent per row. Production requires --confirm-production, and per COL-773 is
 * run only after Jessica signs off on the match report.
 */
import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PRODUCTION_REF = "manfqmasfqppukpobpld";
const args = process.argv.slice(2);
const mode = args[0];
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const flag = (name) => args.includes(name);
const expand = (p) => (p ? path.resolve(p.replace(/^~(?=$|\/)/, os.homedir())) : p);
function outsideRepo(p, label) {
  if (!p) throw new Error(`${label} is required`);
  if (p === REPO || p.startsWith(REPO + path.sep)) throw new Error(`${label} must be outside the repository (resident data)`);
  return p;
}

export function normalize(name) {
  return String(name ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
}
/** exact = same first and last name at the same facility; likely = same last name and first initial; none otherwise. */
export function matchRow(row, residents) {
  const first = normalize(row.first), last = normalize(row.last);
  const here = residents.filter((r) => r.facility_name === row.facility_name);
  const exact = here.filter((r) => normalize(r.last_name) === last && (normalize(r.first_name) === first || normalize(r.preferred_name) === first));
  if (exact.length === 1) return { confidence: "exact", resident: exact[0] };
  if (exact.length > 1) return { confidence: "ambiguous", resident: null, count: exact.length };
  const likely = here.filter((r) => normalize(r.last_name) === last && first && normalize(r.first_name).startsWith(first[0]));
  if (likely.length === 1) return { confidence: "likely", resident: likely[0] };
  return { confidence: here.length ? "none" : "facility_not_in_haven", resident: null };
}
export function importKey(row) {
  return `medicaid-log:${row.facility_tab}${row.completed ? ":completed" : ""}:${normalize(row.log_name)}`;
}
const csvCell = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function parseCsv(text) {
  const rows = []; let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch; }
    else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [header, ...body] = rows;
  return body.filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

function client() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for the target project");
  return { url, db: createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) };
}

async function loadResidents(db, org) {
  const { data, error } = await db.from("residents").select("id, first_name, last_name, preferred_name, facility_id, status, facilities(name)").eq("organization_id", org).is("deleted_at", null).limit(5000);
  if (error) throw new Error(`residents: ${error.message}`);
  return data.map((r) => ({ ...r, facility_name: r.facilities?.name ?? "" }));
}

async function runMatch() {
  const log = JSON.parse(readFileSync(outsideRepo(expand(opt("--log")), "--log"), "utf8"));
  const out = outsideRepo(expand(opt("--out")), "--out");
  const org = opt("--org"); if (!/^[0-9a-f-]{36}$/i.test(org ?? "")) throw new Error("--org <uuid> is required");
  const { db } = client();
  const residents = await loadResidents(db, org);
  const header = ["import_key", "facility", "log_name", "completed", "confidence", "resident_id", "haven_name", "haven_status", "decision"];
  const lines = [header.join(",")];
  const tally = {};
  for (const row of log.rows) {
    const m = matchRow(row, residents);
    tally[m.confidence] = (tally[m.confidence] ?? 0) + 1;
    lines.push([importKey(row), row.facility_tab, row.log_name, row.completed ? "yes" : "", m.confidence, m.resident?.id ?? "",
      m.resident ? `${m.resident.first_name} ${m.resident.last_name}` : "", m.resident?.status ?? "", ""].map(csvCell).join(","));
  }
  writeFileSync(out, lines.join("\n") + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ rows: log.rows.length, by_confidence: tally, mapping: out, next: "Review the CSV: set decision=import (and fix resident_id) for each row to bring in; leave others blank." }, null, 1));
}

async function runImport() {
  const log = JSON.parse(readFileSync(outsideRepo(expand(opt("--log")), "--log"), "utf8"));
  const mapping = parseCsv(readFileSync(outsideRepo(expand(opt("--mapping")), "--mapping"), "utf8"));
  const org = opt("--org"); if (!/^[0-9a-f-]{36}$/i.test(org ?? "")) throw new Error("--org <uuid> is required");
  const actorEmail = opt("--actor-email"); if (!actorEmail) throw new Error("--actor-email is required (the Haven user recorded as importer)");
  const { url, db } = client();
  if (url.includes(PRODUCTION_REF) && !flag("--confirm-production")) throw new Error("Refusing production without --confirm-production (COL-773: only after Jessica signs off on the match report)");
  const { data: actor, error: actorError } = await db.from("user_profiles").select("id").eq("organization_id", org).ilike("email", actorEmail).eq("is_active", true).maybeSingle();
  if (actorError || !actor) throw new Error("Importer email is not an active Haven user of this organization");
  const byKey = new Map(log.rows.map((row) => [importKey(row), row]));
  const results = { imported: 0, records_added: 0, skipped_no_decision: 0, failed: [] };
  for (const m of mapping) {
    if (m.decision.trim().toLowerCase() !== "import" || !/^[0-9a-f-]{36}$/i.test(m.resident_id.trim())) { results.skipped_no_decision++; continue; }
    const row = byKey.get(m.import_key);
    if (!row) { results.failed.push({ import_key: m.import_key, reason: "not in log JSON" }); continue; }
    const payload = {
      import_key: m.import_key, organization_id: org, resident_id: m.resident_id.trim(), actor_id: actor.id, steps: row.steps ?? {},
      ...(row.score ? { score: row.score } : {}), ...(row.reapply_on ? { reapply_on: row.reapply_on } : {}),
      ...(row.caseworker_name ? { caseworker_name: row.caseworker_name } : {}), ...(row.notes ? { notes: row.notes } : {}),
      ...(row.decision ? { decision: row.decision } : {}),
      ...(row.plan ? { plan: row.plan, monthly_cents: row.monthly_cents ?? null, coverage_start: row.coverage_start ?? null } : {}),
    };
    const { data, error } = await db.rpc("benefits_log_import_row", { p_payload: payload });
    if (error) { results.failed.push({ import_key: m.import_key, reason: error.code ?? "error" }); continue; }
    results.imported++; results.records_added += data?.records_added ?? 0;
  }
  console.log(JSON.stringify(results, null, 1));
  if (results.failed.length) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  (mode === "match" ? runMatch() : mode === "import" ? runImport() : Promise.reject(new Error("Usage: import-medicaid-log.mjs match|import ...")))
    .catch((error) => { console.error(error.message); process.exit(2); });
}
