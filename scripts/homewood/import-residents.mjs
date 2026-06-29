#!/usr/bin/env node
/**
 * Homewood Lodge ALF — resident import.
 *
 * Reads the main CSV at `scripts/homewood/data/homewood-residents.csv`, plus
 * the restored Karen Coone one-row addendum, and creates `residents`,
 * `resident_payers`, `resident_contacts`, and an initial
 * `resident_status_history` row for each imported resident.
 *
 * Idempotent on (facility_id, first_name, last_name, date_of_birth).
 *
 * Usage:
 *   npm run homewood:import-residents -- --dry-run
 *   npm run homewood:import-residents
 *
 * The dry-run mode validates the CSV (presence of required columns, room
 * lookup, enum value validity) without writing anything. The real run
 * upserts residents and writes per-row status to
 * `docs/homewood/IMPORT_LOG.md`.
 *
 * Required env (auto-loaded from .env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Optional env:
 *   HOMEWOOD_FACILITY_ID (default: 00000000-0000-0000-0002-000000000003)
 *   HOMEWOOD_CSV_PATH    (default: scripts/homewood/data/homewood-residents.csv)
 *   HOMEWOOD_ADDENDUM_CSV_PATH
 *     (default: scripts/homewood/data/homewood-residents-karen-coone.csv)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const DEFAULT_HOMEWOOD_FACILITY_ID = "00000000-0000-0000-0002-000000000003";
const DEFAULT_CSV_PATH = "scripts/homewood/data/homewood-residents.csv";
const DEFAULT_ADDENDUM_CSV_PATH = "scripts/homewood/data/homewood-residents-karen-coone.csv";
const LOG_PATH = path.join(ROOT, "docs", "homewood", "IMPORT_LOG.md");

const REQUIRED_COLUMNS = [
  "first_name",
  "last_name",
  "preferred_name",
  "date_of_birth",
  "gender",
  "room_number",
  "admit_date",
  "primary_diagnosis",
  "payer_type",
  "emergency_contact_name",
  "emergency_contact_phone",
  "emergency_contact_relationship",
];

const VALID_GENDERS = new Set(["male", "female", "other", "prefer_not_to_say"]);
const VALID_PAYERS = new Set(["private_pay", "medicaid_oss", "ltc_insurance", "va_aid_attendance", "other"]);

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function requireEnv(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  throw new Error(`Missing required env var: ${names.join(" or ")}`);
}

/**
 * Minimal CSV parser. Handles quoted fields with embedded commas + escaped
 * quotes. No external dependency on purpose — `scripts/` already does this
 * pattern elsewhere in the repo.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((v) => v.trim() !== "")) rows.push(row);
  }
  return rows;
}

function rowsToObjects(rows) {
  if (rows.length < 2) return { header: rows[0] ?? [], records: [] };
  const header = rows[0].map((h) => h.trim());
  const records = rows.slice(1).map((r) => {
    const obj = {};
    for (let i = 0; i < header.length; i++) obj[header[i]] = (r[i] ?? "").trim();
    return obj;
  });
  return { header, records };
}

function resolveInputPath(inputPath) {
  return path.isAbsolute(inputPath) ? inputPath : path.join(ROOT, inputPath);
}

function sourceLabel(filePath) {
  return path.isAbsolute(filePath) ? path.relative(ROOT, filePath) : filePath;
}

function residentIdentityKey(row) {
  const first = String(row.first_name || "").trim().toLowerCase();
  const last = String(row.last_name || "").trim().toLowerCase();
  const dob = String(row.date_of_birth || "").trim();
  if (!first || !last || !dob) return null;
  return `${first}|${last}|${dob}`;
}

function normalizeRoomBed(value) {
  const raw = String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
  const match = raw.match(/^(\d+)([A-Z])?$/);
  if (!match) return { roomNumber: raw, bedLabel: null, display: raw };
  const roomNumber = String(Number.parseInt(match[1], 10));
  const bedLabel = match[2] || null;
  return { roomNumber, bedLabel, display: bedLabel ? `${roomNumber}${bedLabel}` : roomNumber };
}

function loadCsvSource(source) {
  const csv = readFileSync(source.filePath, "utf8").replace(/^\uFEFF/, "");
  const { header, records } = rowsToObjects(parseCsv(csv));
  const label = sourceLabel(source.filePath);
  return {
    ...source,
    label,
    header,
    records: records.map((record, index) => ({
      ...record,
      __sourceLabel: label,
      __sourceRole: source.role,
      __sourceRow: index + 2,
    })),
  };
}

function mergeSourceRecords(sources) {
  const records = [];
  const seen = new Set();
  const warnings = [];

  for (const source of sources) {
    for (const row of source.records) {
      const key = residentIdentityKey(row);
      if (key && seen.has(key)) {
        warnings.push(
          `Skipped duplicate resident identity from ${row.__sourceLabel} row ${row.__sourceRow}; first source retained.`,
        );
        continue;
      }
      if (key) seen.add(key);
      records.push(row);
    }
  }

  return { records, warnings };
}

function safeMessage(err) {
  if (!err) return "";
  if (typeof err === "string") return err;
  return err.message || err.code || JSON.stringify(err);
}

async function main() {
  loadEnvFile(path.join(ROOT, ".env.local"));
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const csvOverride = args.find((a) => a.startsWith("--csv="));
  const csvArg = csvOverride ? csvOverride.slice("--csv=".length) : process.env.HOMEWOOD_CSV_PATH ?? DEFAULT_CSV_PATH;
  const csvPath = resolveInputPath(csvArg);
  const addendumOverride = args.find((a) => a.startsWith("--addendum="));
  const addendumArg = addendumOverride
    ? addendumOverride.slice("--addendum=".length)
    : process.env.HOMEWOOD_ADDENDUM_CSV_PATH ?? DEFAULT_ADDENDUM_CSV_PATH;
  const addendumPath = resolveInputPath(addendumArg);
  const sourcePaths = [{ role: "main roster", filePath: csvPath }];
  if (path.resolve(addendumPath) !== path.resolve(csvPath)) {
    sourcePaths.push({ role: "Karen Coone addendum", filePath: addendumPath });
  }

  const url = requireEnv("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const facilityId = process.env.HOMEWOOD_FACILITY_ID?.trim() || DEFAULT_HOMEWOOD_FACILITY_ID;

  const supa = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  console.log(
    `[homewood:import-residents] mode: ${dryRun ? "DRY-RUN" : "WRITE"}  sources: ${sourcePaths
      .map((s) => sourceLabel(s.filePath))
      .join(", ")}`,
  );
  for (const source of sourcePaths) {
    if (!existsSync(source.filePath)) {
      console.error(`[homewood:import-residents] FAIL: ${source.role} CSV not found at ${source.filePath}.`);
      if (source.filePath.endsWith("homewood-residents.csv")) {
        console.error("  Hint: copy homewood-residents.csv.example to homewood-residents.csv and fill in the real roster.");
        console.error("  The real CSV is gitignored — it must never be committed.");
      }
      process.exit(2);
    }
  }

  // 1) Parse + validate source headers. Strip UTF-8 BOM if Excel/Numbers added one.
  const sources = sourcePaths.map(loadCsvSource);
  const headerErrors = sources.flatMap((source) => {
    const missingCols = REQUIRED_COLUMNS.filter((c) => !source.header.includes(c));
    return missingCols.length
      ? [`${source.label}: missing required columns: ${missingCols.join(", ")} (got: ${source.header.join(", ")})`]
      : [];
  });
  if (headerErrors.length > 0) {
    console.error("[homewood:import-residents] FAIL: CSV header validation failed:");
    for (const error of headerErrors) console.error(`  - ${error}`);
    process.exit(1);
  }
  const { records, warnings: mergeWarnings } = mergeSourceRecords(sources);
  if (records.length === 0) {
    console.error("[homewood:import-residents] FAIL: CSV sources have no data rows.");
    process.exit(1);
  }

  // 2) Look up facility's organization_id.
  const { data: facility, error: ferr } = await supa
    .from("facilities")
    .select("id, organization_id, name")
    .eq("id", facilityId)
    .single();
  if (ferr || !facility) {
    console.error(`[homewood:import-residents] FAIL facility lookup: ${safeMessage(ferr)}`);
    process.exit(1);
  }
  if (facility.name !== "Homewood Lodge ALF") {
    console.warn(`[homewood:import-residents] WARN: facility name is '${facility.name}' (expected 'Homewood Lodge ALF') — continuing.`);
  }
  const organizationId = facility.organization_id;

  // 3) Build room_number → room_id map.
  const { data: rooms, error: rerr } = await supa
    .from("rooms")
    .select("id, room_number")
    .eq("facility_id", facilityId);
  if (rerr) {
    console.error(`[homewood:import-residents] FAIL rooms lookup: ${safeMessage(rerr)}`);
    process.exit(1);
  }
  const roomByNumber = new Map();
  for (const r of rooms ?? []) roomByNumber.set(String(r.room_number).trim(), r.id);
  console.log(`[homewood:import-residents] facility=${facility.name} org=${organizationId} rooms=${roomByNumber.size}`);

  // 4) Process records.
  const results = [];
  for (let i = 0; i < records.length; i++) {
    const row = records[i];
    const rowNum = row.__sourceRow;
    const result = { source: row.__sourceLabel, rowNum, name: `${row.first_name} ${row.last_name}`, status: "PENDING", reason: "" };

    // Validate enums + required fields per row
    const missing = REQUIRED_COLUMNS.filter((c) => !row[c] || row[c] === "");
    // emergency_contact_relationship may legitimately be empty for some residents — only fail on truly missing fields
    const hardMissing = missing.filter((m) => !["preferred_name", "primary_diagnosis", "emergency_contact_relationship"].includes(m));
    if (hardMissing.length > 0) {
      result.status = "FAILED";
      result.reason = `missing required fields: ${hardMissing.join(", ")}`;
      results.push(result);
      continue;
    }
    if (!VALID_GENDERS.has(row.gender)) {
      result.status = "FAILED";
      result.reason = `invalid gender '${row.gender}' — must be one of ${[...VALID_GENDERS].join(", ")}`;
      results.push(result);
      continue;
    }
    if (!VALID_PAYERS.has(row.payer_type)) {
      result.status = "FAILED";
      result.reason = `invalid payer_type '${row.payer_type}' — must be one of ${[...VALID_PAYERS].join(", ")}`;
      results.push(result);
      continue;
    }
    const roomBed = normalizeRoomBed(row.room_number);
    const roomId = roomByNumber.get(String(row.room_number).trim()) ?? roomByNumber.get(roomBed.roomNumber);
    if (!roomId) {
      result.status = "FAILED";
      result.reason = `room_number '${row.room_number}' not found at Homewood (available: ${[...roomByNumber.keys()].slice(0, 5).join(", ")}${roomByNumber.size > 5 ? "…" : ""})`;
      results.push(result);
      continue;
    }

    if (dryRun) {
      result.status = "DRY-OK";
      result.reason = `would create resident in room ${roomBed.roomNumber}${
        roomBed.bedLabel ? ` bed ${roomBed.bedLabel}` : ""
      }; payer=${row.payer_type}; emergency=${row.emergency_contact_name}`;
      results.push(result);
      continue;
    }

    // 5) Idempotent upsert on (facility_id, first_name, last_name, date_of_birth)
    const { data: existing, error: exerr } = await supa
      .from("residents")
      .select("id")
      .eq("facility_id", facilityId)
      .eq("first_name", row.first_name)
      .eq("last_name", row.last_name)
      .eq("date_of_birth", row.date_of_birth)
      .maybeSingle();
    if (exerr) {
      result.status = "FAILED";
      result.reason = `lookup error: ${safeMessage(exerr)}`;
      results.push(result);
      continue;
    }

    const payload = {
      facility_id: facilityId,
      organization_id: organizationId,
      first_name: row.first_name,
      last_name: row.last_name,
      preferred_name: row.preferred_name || null,
      date_of_birth: row.date_of_birth,
      gender: row.gender,
      status: "active",
      admission_date: row.admit_date || null,
      primary_diagnosis: row.primary_diagnosis || null,
      primary_payer: row.payer_type,
      emergency_contact_1_name: row.emergency_contact_name || null,
      emergency_contact_1_phone: row.emergency_contact_phone || null,
      emergency_contact_1_relationship: row.emergency_contact_relationship || null,
    };

    let residentId;
    if (existing?.id) {
      const { error: uerr } = await supa.from("residents").update(payload).eq("id", existing.id);
      if (uerr) {
        result.status = "FAILED";
        result.reason = `update error: ${safeMessage(uerr)}`;
        results.push(result);
        continue;
      }
      residentId = existing.id;
      result.status = "UPDATED";
    } else {
      const { data: ins, error: ierr } = await supa.from("residents").insert(payload).select("id").single();
      if (ierr || !ins) {
        result.status = "FAILED";
        result.reason = `insert error: ${safeMessage(ierr)}`;
        results.push(result);
        continue;
      }
      residentId = ins.id;
      result.status = "CREATED";
    }

    // Related rows — soft transaction: roll back the resident insert if any fail.
    const cleanupOnFail = async (msg) => {
      if (result.status === "CREATED") {
        await supa.from("residents").delete().eq("id", residentId);
        result.status = "FAILED";
        result.reason = msg;
      } else {
        // For UPDATED rows we don't roll back the resident — flag inconsistency in the log.
        result.status = "PARTIAL";
        result.reason = msg;
      }
    };

    // 6) resident_payers (idempotent on resident_id + is_primary)
    const { data: payerExisting } = await supa
      .from("resident_payers")
      .select("id")
      .eq("resident_id", residentId)
      .eq("is_primary", true)
      .maybeSingle();
    if (!payerExisting) {
      const { error: perr } = await supa.from("resident_payers").insert({
        resident_id: residentId,
        facility_id: facilityId,
        organization_id: organizationId,
        payer_type: row.payer_type,
        is_primary: true,
      });
      if (perr) {
        await cleanupOnFail(`resident_payers insert error: ${safeMessage(perr)}`);
        results.push(result);
        continue;
      }
    }

    // 7) resident_contacts — emergency contact (idempotent on resident_id + contact_type='emergency')
    if (row.emergency_contact_name) {
      const { data: contactExisting } = await supa
        .from("resident_contacts")
        .select("id")
        .eq("resident_id", residentId)
        .eq("contact_type", "emergency")
        .maybeSingle();
      const contactPayload = {
        resident_id: residentId,
        facility_id: facilityId,
        organization_id: organizationId,
        contact_type: "emergency",
        name: row.emergency_contact_name,
        relationship: row.emergency_contact_relationship || null,
        phone: row.emergency_contact_phone || null,
        is_emergency_contact: true,
      };
      const { error: cerr } = contactExisting
        ? await supa.from("resident_contacts").update(contactPayload).eq("id", contactExisting.id)
        : await supa.from("resident_contacts").insert(contactPayload);
      if (cerr) {
        await cleanupOnFail(`resident_contacts error: ${safeMessage(cerr)}`);
        results.push(result);
        continue;
      }
    }

    // 8) resident_status_history — initial 'active' row
    const { data: histExisting } = await supa
      .from("resident_status_history")
      .select("id")
      .eq("resident_id", residentId)
      .eq("status", "active")
      .is("effective_to", null)
      .maybeSingle();
    if (!histExisting) {
      const { error: hErr } = await supa.from("resident_status_history").insert({
        organization_id: organizationId,
        facility_id: facilityId,
        resident_id: residentId,
        status: "active",
        effective_from: row.admit_date ? new Date(row.admit_date).toISOString() : new Date().toISOString(),
        reason: "Imported via scripts/homewood/import-residents.mjs",
      });
      if (hErr) {
        await cleanupOnFail(`resident_status_history error: ${safeMessage(hErr)}`);
        results.push(result);
        continue;
      }
    }

    if (result.status === "CREATED" || result.status === "UPDATED") {
      result.reason = `room=${row.room_number} payer=${row.payer_type}`;
    }
    results.push(result);
  }

  // 9) Write log.
  const tally = results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  const lines = [];
  lines.push(`# Homewood — Resident Import Log`);
  lines.push("");
  lines.push(`_Generated: \`${new Date().toISOString()}\` — mode: **${dryRun ? "DRY-RUN" : "WRITE"}**_`);
  lines.push("");
  lines.push("- Source CSVs:");
  for (const source of sources) {
    lines.push(
      `  - \`${source.label}\` (${source.role}; ${source.records.length} row${source.records.length === 1 ? "" : "s"} loaded)`,
    );
  }
  lines.push(`- Facility: \`${facility.name}\` (${facilityId})`);
  lines.push(`- Organization: \`${organizationId}\``);
  lines.push("");
  if (mergeWarnings.length) {
    lines.push("## Source Warnings");
    lines.push("");
    for (const warning of mergeWarnings) lines.push(`- ${warning}`);
    lines.push("");
  }
  lines.push(`## Tally`);
  lines.push("");
  lines.push("| Outcome | Count |");
  lines.push("|---|---:|");
  for (const k of Object.keys(tally).sort()) lines.push(`| ${k} | ${tally[k]} |`);
  lines.push("");
  lines.push(`## Per-row detail`);
  lines.push("");
  lines.push("| Source | Row | Name | Status | Detail |");
  lines.push("|---|---:|---|---|---|");
  for (const r of results) {
    lines.push(`| ${r.source} | ${r.rowNum} | ${r.name} | ${r.status} | ${(r.reason ?? "").replace(/\|/g, "\\|")} |`);
  }
  lines.push("");
  lines.push(`_Names appear in this log because the user runs the import locally and reviews the result. The log is committed only when no real PII has been imported — i.e. when the source CSV is \`homewood-residents.csv.example\`. Real-import logs stay local._`);
  lines.push("");
  mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  writeFileSync(LOG_PATH, `${lines.join("\n")}\n`);

  console.log(`[homewood:import-residents] log: ${path.relative(ROOT, LOG_PATH)}`);
  console.log(`[homewood:import-residents] tally: ${JSON.stringify(tally)}`);
  const fatal = (tally.FAILED ?? 0) + (tally.PARTIAL ?? 0);
  if (fatal > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error("[homewood:import-residents] FATAL:", safeMessage(err));
  process.exit(1);
});
