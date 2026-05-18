#!/usr/bin/env node
/**
 * Homewood Lodge ALF — live resident import.
 *
 * Source:
 *   /Users/brianlewis/Circle of Life/Circle-of-Life/scripts/homewood/data/homewood-residents.csv
 *
 * Target live tables:
 *   residents
 *   resident_contacts
 *   resident_payers
 *   beds.current_resident_id / beds.status
 *
 * This script is intentionally Homewood-only. It fixes the older importer's
 * room lookup mismatch by splitting values like "5A" into room_number="5" and
 * bed_label="A".
 *
 * Safety:
 *   - dry-run is default-friendly and can parse without Supabase credentials
 *   - no hard deletes
 *   - demo purge only soft-deletes deterministic migration-120 Homewood demo
 *     resident rows when --purge-demo is explicitly passed
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const DEFAULT_CSV =
  "/Users/brianlewis/Circle of Life/Circle-of-Life/scripts/homewood/data/homewood-residents.csv";
const DEFAULT_FACILITY_ID = "00000000-0000-0000-0002-000000000003";
const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";
const LOG_PATH = path.join(ROOT, "docs", "homewood", "RESIDENT_IMPORT_LOG.md");
const HOMEWOOD_DEMO_RESIDENT_IDS = [
  "c0000003-0000-0000-0000-000000000001",
  "c0000003-0000-0000-0000-000000000002",
  "c0000003-0000-0000-0000-000000000003",
  "c0000003-0000-0000-0000-000000000004",
];

const REQUIRED_COLUMNS = [
  "first_name",
  "last_name",
  "date_of_birth",
  "gender",
  "room_number",
  "admit_date",
  "payer_type",
  "emergency_contact_name",
  "emergency_contact_phone",
];

const VALID_GENDERS = new Set(["male", "female", "other", "prefer_not_to_say"]);
const VALID_PAYERS = new Set([
  "private_pay",
  "medicaid_oss",
  "ltc_insurance",
  "va_aid_attendance",
  "other",
]);

function usage() {
  return [
    "import-homewood-residents.mjs",
    "",
    "Options:",
    `  --csv <path>             Source CSV (default: ${DEFAULT_CSV})`,
    "  --dry-run                Validate/plan only; no writes",
    "  --purge-demo             Soft-delete deterministic migration-120 demo Homewood residents before import",
    `  --facility-id <uuid>     Homewood facility id (default: ${DEFAULT_FACILITY_ID})`,
    `  --organization-id <uuid> COL organization id (default: ${DEFAULT_ORG_ID})`,
    "  --applied-by <uuid>      user_profiles/auth user id to stamp created_by/updated_by where supported",
    "  --verbose                Print per-row plan",
  ].join("\n");
}

function parseArgs(argv) {
  const args = {
    csv: DEFAULT_CSV,
    dryRun: false,
    purgeDemo: false,
    facilityId: DEFAULT_FACILITY_ID,
    organizationId: DEFAULT_ORG_ID,
    appliedBy: null,
    verbose: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--csv") args.csv = path.resolve(process.cwd(), argv[++i]);
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--purge-demo") args.purgeDemo = true;
    else if (a === "--facility-id") args.facilityId = argv[++i];
    else if (a === "--organization-id") args.organizationId = argv[++i];
    else if (a === "--applied-by") args.appliedBy = argv[++i];
    else if (a === "--verbose" || a === "-v") args.verbose = true;
    else if (a === "--help" || a === "-h") {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${a}\n${usage()}`);
    }
  }

  return args;
}

function loadEnvFile() {
  for (const name of [".env.local", ".env"]) {
    const p = path.resolve(ROOT, name);
    if (!existsSync(p)) continue;
    for (const rawLine of readFileSync(p, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key]) continue;
      let value = rawValue.trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
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
  const header = rows[0].map((h) => h.trim().replace(/^\uFEFF/, ""));
  return {
    header,
    records: rows.slice(1).map((r) => {
      const obj = {};
      for (let i = 0; i < header.length; i += 1) obj[header[i]] = (r[i] ?? "").trim();
      return obj;
    }),
  };
}

function safeMessage(err) {
  if (!err) return "";
  if (typeof err === "string") return err;
  return err.message || err.code || JSON.stringify(err);
}

function normalizeRoomBed(value) {
  const raw = String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
  const match = raw.match(/^(\d+)([A-Z])?$/);
  if (!match) return { roomNumber: raw, bedLabel: null, display: raw };
  const roomNumber = String(Number.parseInt(match[1], 10));
  const bedLabel = match[2] || "A";
  return { roomNumber, bedLabel, display: `${roomNumber}${bedLabel}` };
}

function nameKey(row) {
  return [
    String(row.first_name || "").trim().toLowerCase(),
    String(row.last_name || "").trim().toLowerCase(),
    String(row.date_of_birth || "").trim(),
  ].join("|");
}

function splitDiagnosis(value) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  return raw.split(",").map((part) => part.trim()).filter(Boolean).slice(0, 25);
}

function validateRows(header, records) {
  const errors = [];
  const warnings = [];
  const missingColumns = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missingColumns.length) {
    errors.push(`Missing required columns: ${missingColumns.join(", ")}`);
  }

  const seenKeys = new Set();
  const seenBeds = new Map();
  const valid = [];

  records.forEach((row, index) => {
    const sourceRow = index + 2;
    const rowErrors = [];
    for (const column of REQUIRED_COLUMNS) {
      if (!String(row[column] || "").trim()) rowErrors.push(`missing ${column}`);
    }
    if (row.gender && !VALID_GENDERS.has(row.gender)) {
      rowErrors.push(`invalid gender ${row.gender}`);
    }
    if (row.payer_type && !VALID_PAYERS.has(row.payer_type)) {
      rowErrors.push(`invalid payer_type ${row.payer_type}`);
    }

    const roomBed = normalizeRoomBed(row.room_number);
    if (!roomBed.roomNumber || !roomBed.bedLabel) rowErrors.push(`invalid room_number ${row.room_number}`);
    const key = nameKey(row);
    if (seenKeys.has(key)) rowErrors.push(`duplicate resident identity ${key}`);
    seenKeys.add(key);

    const bedConflict = seenBeds.get(roomBed.display);
    if (bedConflict) {
      rowErrors.push(`duplicate bed assignment ${roomBed.display} also used by row ${bedConflict}`);
    }
    seenBeds.set(roomBed.display, sourceRow);

    const normalized = {
      ...row,
      sourceRow,
      roomNumber: roomBed.roomNumber,
      bedLabel: roomBed.bedLabel,
      roomBed: roomBed.display,
      first_name: row.first_name.trim(),
      last_name: row.last_name.trim(),
      preferred_name: row.preferred_name?.trim() || null,
      primary_diagnosis: row.primary_diagnosis?.trim() || null,
      emergency_contact_relationship: row.emergency_contact_relationship?.trim() || null,
    };

    if (rowErrors.length) {
      errors.push(`Row ${sourceRow} (${row.first_name} ${row.last_name}): ${rowErrors.join("; ")}`);
    } else {
      valid.push(normalized);
    }

    if (!normalized.emergency_contact_relationship) {
      warnings.push(`Row ${sourceRow} (${row.first_name} ${row.last_name}): emergency contact relationship is blank.`);
    }
  });

  return { valid, errors, warnings };
}

async function getSupabase(args) {
  loadEnvFile();
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    if (args.dryRun) return null;
    throw new Error("Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function findFacility(supa, args) {
  const { data, error } = await supa
    .from("facilities")
    .select("id, organization_id, name")
    .eq("id", args.facilityId)
    .maybeSingle();
  if (error || !data) throw new Error(`Homewood facility lookup failed: ${safeMessage(error) || "not found"}`);
  if (data.organization_id !== args.organizationId) {
    throw new Error(`Facility organization mismatch: expected ${args.organizationId}, got ${data.organization_id}`);
  }
  return data;
}

async function buildBedMap(supa, args) {
  const { data, error } = await supa
    .from("beds")
    .select("id, bed_label, status, current_resident_id, rooms!inner(id, room_number)")
    .eq("facility_id", args.facilityId)
    .is("deleted_at", null)
    .is("rooms.deleted_at", null);
  if (error) throw new Error(`Bed lookup failed: ${error.message}`);

  const bedByRoomBed = new Map();
  for (const bed of data ?? []) {
    const roomNumber = String(bed.rooms?.room_number || "").trim();
    const bedLabel = String(bed.bed_label || "").trim().toUpperCase();
    bedByRoomBed.set(`${roomNumber}${bedLabel}`, bed);
  }
  return bedByRoomBed;
}

async function findExistingResident(supa, args, row) {
  const { data, error } = await supa
    .from("residents")
    .select("*")
    .eq("facility_id", args.facilityId)
    .eq("first_name", row.first_name)
    .eq("last_name", row.last_name)
    .eq("date_of_birth", row.date_of_birth)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`Resident lookup failed for ${row.first_name} ${row.last_name}: ${error.message}`);
  return data;
}

function residentPayload(args, row, bedId) {
  return {
    facility_id: args.facilityId,
    organization_id: args.organizationId,
    bed_id: bedId,
    first_name: row.first_name,
    last_name: row.last_name,
    preferred_name: row.preferred_name,
    date_of_birth: row.date_of_birth,
    gender: row.gender,
    status: "active",
    admission_date: row.admit_date || null,
    primary_diagnosis: row.primary_diagnosis,
    diagnosis_list: splitDiagnosis(row.primary_diagnosis),
    primary_payer: row.payer_type,
    emergency_contact_1_name: row.emergency_contact_name || null,
    emergency_contact_1_phone: row.emergency_contact_phone || null,
    emergency_contact_1_relationship: row.emergency_contact_relationship,
    updated_by: args.appliedBy,
  };
}

async function purgeDemoResidents(supa, args, counters) {
  const { data: demoResidents, error } = await supa
    .from("residents")
    .select("id, bed_id")
    .eq("facility_id", args.facilityId)
    .in("id", HOMEWOOD_DEMO_RESIDENT_IDS)
    .is("deleted_at", null);
  if (error) throw new Error(`Demo resident lookup failed: ${error.message}`);

  if (!demoResidents?.length) return;

  for (const resident of demoResidents) {
    counters.demoResidentsPurged += 1;
    if (args.dryRun) continue;
    await supa
      .from("beds")
      .update({ current_resident_id: null, status: "available", updated_by: args.appliedBy })
      .eq("current_resident_id", resident.id);
    const { error: residentError } = await supa
      .from("residents")
      .update({
        status: "discharged",
        discharge_date: new Date().toISOString().slice(0, 10),
        discharge_reason: "other",
        discharge_notes: "Soft-deleted deterministic demo resident during Homewood real resident import.",
        deleted_at: new Date().toISOString(),
        updated_by: args.appliedBy,
      })
      .eq("id", resident.id);
    if (residentError) throw new Error(`Demo resident soft-delete failed for ${resident.id}: ${residentError.message}`);
  }
}

async function upsertContact(supa, args, residentId, row) {
  if (!row.emergency_contact_name) return "skipped";
  const payload = {
    resident_id: residentId,
    facility_id: args.facilityId,
    organization_id: args.organizationId,
    contact_type: "emergency",
    name: row.emergency_contact_name,
    relationship: row.emergency_contact_relationship,
    phone: row.emergency_contact_phone || null,
    is_emergency_contact: true,
    notification_preference: "phone",
    updated_by: args.appliedBy,
  };

  const { data: existing, error: lookupError } = await supa
    .from("resident_contacts")
    .select("id")
    .eq("resident_id", residentId)
    .eq("contact_type", "emergency")
    .is("deleted_at", null)
    .maybeSingle();
  if (lookupError) throw new Error(`Contact lookup failed: ${lookupError.message}`);

  if (existing?.id) {
    const { error } = await supa.from("resident_contacts").update(payload).eq("id", existing.id);
    if (error) throw new Error(`Contact update failed: ${error.message}`);
    return "updated";
  }

  const { error } = await supa.from("resident_contacts").insert({ ...payload, created_by: args.appliedBy });
  if (error) throw new Error(`Contact insert failed: ${error.message}`);
  return "created";
}

async function upsertPayer(supa, args, residentId, row) {
  const payload = {
    resident_id: residentId,
    facility_id: args.facilityId,
    organization_id: args.organizationId,
    payer_type: row.payer_type,
    is_primary: true,
    payer_name: row.payer_type === "private_pay" ? "Private Pay" : "Medicaid / OSS",
    effective_date: row.admit_date || "2026-05-01",
    updated_by: args.appliedBy,
  };

  const { data: existing, error: lookupError } = await supa
    .from("resident_payers")
    .select("id")
    .eq("resident_id", residentId)
    .eq("is_primary", true)
    .is("deleted_at", null)
    .maybeSingle();
  if (lookupError) throw new Error(`Payer lookup failed: ${lookupError.message}`);

  if (existing?.id) {
    const { error } = await supa.from("resident_payers").update(payload).eq("id", existing.id);
    if (error) throw new Error(`Payer update failed: ${error.message}`);
    return "updated";
  }

  const { error } = await supa.from("resident_payers").insert({ ...payload, created_by: args.appliedBy });
  if (error) throw new Error(`Payer insert failed: ${error.message}`);
  return "created";
}

async function setBedOccupancy(supa, args, bed, residentId) {
  const { error } = await supa
    .from("beds")
    .update({
      current_resident_id: residentId,
      status: "occupied",
      updated_by: args.appliedBy,
    })
    .eq("id", bed.id);
  if (error) throw new Error(`Bed occupancy update failed for ${bed.id}: ${error.message}`);
}

function summarize(results) {
  return results.reduce((acc, result) => {
    acc[result.status] = (acc[result.status] ?? 0) + 1;
    return acc;
  }, {});
}

function writeLog(args, facility, results, counters, warnings) {
  const lines = [];
  lines.push("# Homewood — Live Resident Import Log");
  lines.push("");
  lines.push(`_Generated: \`${new Date().toISOString()}\` — mode: **${args.dryRun ? "DRY-RUN" : "WRITE"}**_`);
  lines.push("");
  lines.push(`- Source CSV: \`${args.csv}\``);
  lines.push(`- Facility: \`${facility?.name ?? "Homewood Lodge ALF"}\` (${args.facilityId})`);
  lines.push(`- Organization: \`${args.organizationId}\``);
  lines.push(`- Purge deterministic demo residents: \`${args.purgeDemo ? "yes" : "no"}\``);
  lines.push("");
  lines.push("## Tally");
  lines.push("");
  lines.push("| Outcome | Count |");
  lines.push("|---|---:|");
  const tally = summarize(results);
  for (const key of Object.keys(tally).sort()) lines.push(`| ${key} | ${tally[key]} |`);
  lines.push(`| demo residents soft-deleted/planned | ${counters.demoResidentsPurged} |`);
  lines.push("");
  if (warnings.length) {
    lines.push("## Warnings");
    lines.push("");
    for (const warning of warnings) lines.push(`- ${warning}`);
    lines.push("");
  }
  lines.push("## Per-row detail");
  lines.push("");
  lines.push("| Row | Resident | Room/Bed | Status | Detail |");
  lines.push("|---:|---|---|---|---|");
  for (const result of results) {
    lines.push(
      `| ${result.sourceRow} | ${result.name.replace(/\|/g, "\\|")} | ${result.roomBed} | ${result.status} | ${result.detail.replace(/\|/g, "\\|")} |`,
    );
  }
  lines.push("");
  lines.push("_This log contains resident names. Do not commit it after a real production import._");
  lines.push("");

  mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  writeFileSync(LOG_PATH, `${lines.join("\n")}\n`);
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(args.csv)) throw new Error(`CSV not found: ${args.csv}`);

  const csv = readFileSync(args.csv, "utf8").replace(/^\uFEFF/, "");
  const { header, records } = rowsToObjects(parseCsv(csv));
  const { valid, errors, warnings } = validateRows(header, records);
  if (errors.length) {
    console.error("[homewood:residents] CSV validation failed:");
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }

  const supa = await getSupabase(args);
  if (!supa) {
    console.log(`[homewood:residents] parse-only dry-run: ${valid.length} residents are structurally valid.`);
    if (warnings.length) warnings.forEach((w) => console.warn(`[homewood:residents] WARN ${w}`));
    return;
  }

  const facility = await findFacility(supa, args);
  const bedByRoomBed = await buildBedMap(supa, args);
  const results = [];
  const counters = { demoResidentsPurged: 0 };

  if (args.purgeDemo) {
    await purgeDemoResidents(supa, args, counters);
  }

  for (const row of valid) {
    const result = {
      sourceRow: row.sourceRow,
      name: `${row.first_name} ${row.last_name}`,
      roomBed: row.roomBed,
      status: "planned",
      detail: "",
    };

    try {
      const bed = bedByRoomBed.get(row.roomBed);
      if (!bed) {
        result.status = "failed";
        result.detail = `No matching bed found for room_number=${row.roomNumber}, bed_label=${row.bedLabel}`;
        results.push(result);
        continue;
      }

      const existing = await findExistingResident(supa, args, row);
      if (bed.current_resident_id && bed.current_resident_id !== existing?.id) {
        result.status = "blocked";
        result.detail = `Bed already has current_resident_id=${bed.current_resident_id}; rerun after clearing stale/demo occupancy.`;
        results.push(result);
        continue;
      }

      if (args.dryRun) {
        result.status = existing ? "would_update" : "would_create";
        result.detail = `bed=${row.roomBed}; payer=${row.payer_type}; contact=${row.emergency_contact_name}`;
        results.push(result);
        continue;
      }

      const payload = residentPayload(args, row, bed.id);
      let residentId;
      if (existing?.id) {
        const { error } = await supa.from("residents").update(payload).eq("id", existing.id);
        if (error) throw new Error(`Resident update failed: ${error.message}`);
        residentId = existing.id;
        result.status = "updated";
      } else {
        const { data, error } = await supa
          .from("residents")
          .insert({ ...payload, created_by: args.appliedBy })
          .select("id")
          .single();
        if (error || !data?.id) throw new Error(`Resident insert failed: ${error?.message ?? "missing id"}`);
        residentId = data.id;
        result.status = "created";
      }

      await setBedOccupancy(supa, args, bed, residentId);
      const contactStatus = await upsertContact(supa, args, residentId, row);
      const payerStatus = await upsertPayer(supa, args, residentId, row);

      result.detail = `bed occupied; contact ${contactStatus}; payer ${payerStatus}`;
    } catch (error) {
      result.status = "failed";
      result.detail = safeMessage(error);
    }

    results.push(result);
  }

  if (args.verbose || args.dryRun) {
    for (const result of results) {
      console.log(
        `[homewood:residents] row=${result.sourceRow} ${result.status} ${result.name} ${result.roomBed} — ${result.detail}`,
      );
    }
  }

  writeLog(args, facility, results, counters, warnings);
  const tally = summarize(results);
  console.log(`[homewood:residents] ${args.dryRun ? "dry-run" : "write"} tally: ${JSON.stringify(tally)}`);
  console.log(`[homewood:residents] demo residents soft-deleted/planned: ${counters.demoResidentsPurged}`);
  console.log(`[homewood:residents] log: ${path.relative(ROOT, LOG_PATH)}`);

  const failures = (tally.failed ?? 0) + (tally.blocked ?? 0);
  if (failures > 0) process.exit(1);
}

run().catch((error) => {
  console.error("[homewood:residents] FATAL:", safeMessage(error));
  process.exit(1);
});
