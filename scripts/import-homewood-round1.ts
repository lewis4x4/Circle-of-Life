#!/usr/bin/env tsx
/**
 * Import Homewood Round-1 Facility DNA values into `facility_launch_module_values`.
 *
 * Source : facility-launch-center/data/homewood-round1-state.json
 * Target : public.facility_launch_module_values
 *
 * Behavior
 *  - Writes one row per (module_code, field_path) for each source-backed value.
 *  - Skips fields prefixed with "_" (e.g. _sourceNotes) — those are surfaced into
 *    each row's `provenance.source_notes` instead of being written as values.
 *  - Modules that are NOT present in `mvpData` are treated as explicit Round-2
 *    gaps and intentionally not written (no placeholder rows).
 *  - Idempotent: SELECT by (org, facility, module, field_path) WHERE
 *    deleted_at IS NULL AND superseded_at IS NULL → UPDATE if present,
 *    INSERT otherwise. (The active-row unique index is partial, so we cannot
 *    rely on ON CONFLICT via the JS client.)
 *
 * Usage
 *   npm run import:homewood-round1 -- --dry-run
 *   npm run import:homewood-round1 -- --facility-id <uuid> --organization-id <uuid>
 *   npm run import:homewood-round1 -- --state-file <path-to-state.json>
 *
 * Environment (required unless --dry-run-only)
 *   SUPABASE_URL                  or NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Module allowlist — only these modules may be written by Round 1.
// Order/labels mirror the user's Round-1 readiness table.
// ---------------------------------------------------------------------------
const ROUND1_MODULE_ALLOWLIST = new Set([
  "M1",  // Company / Portfolio
  "M2",  // Facility Profile
  "M3",  // Rooms / Beds / Units
  "M6",  // Rates / Billing / Payer (partial)
  "M10", // Medications (partial)
  "M11", // Dining / Dietary (partial)
  "M13", // Maintenance / Assets (partial)
  "M14", // Admissions / Move-In (partial)
  "M16", // Incidents / Risk (partial)
  "M17", // Documents / Insurance
  "M18", // Vendors / Emergency Contacts (partial)
  "M19", // Reports / KPIs (partial)
]);

const ROUND2_GAPS = ["M4", "M5", "M7", "M8", "M9", "M12", "M15"];

// Default IDs match scripts/pilot/homewood-readiness-check.mjs.
const DEFAULT_ORGANIZATION_ID = "00000000-0000-0000-0000-000000000001";
const DEFAULT_HOMEWOOD_FACILITY_ID = "00000000-0000-0000-0002-000000000003";

// ---------------------------------------------------------------------------
// CLI parsing (no external deps).
// ---------------------------------------------------------------------------
type Args = {
  stateFile: string;
  organizationId: string;
  facilityId: string;
  dryRun: boolean;
  appliedBy: string | null;
  verbose: boolean;
};

function parseArgs(argv: string[]): Args {
  const out: Args = {
    stateFile: path.resolve(
      process.cwd(),
      "facility-launch-center/data/homewood-round1-state.json",
    ),
    organizationId: DEFAULT_ORGANIZATION_ID,
    facilityId: DEFAULT_HOMEWOOD_FACILITY_ID,
    dryRun: false,
    appliedBy: null,
    verbose: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--verbose" || a === "-v") out.verbose = true;
    else if (a === "--state-file") out.stateFile = path.resolve(process.cwd(), argv[++i]);
    else if (a === "--facility-id") out.facilityId = argv[++i];
    else if (a === "--organization-id") out.organizationId = argv[++i];
    else if (a === "--applied-by") out.appliedBy = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log(usage());
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${a}`);
      console.error(usage());
      process.exit(2);
    }
  }
  return out;
}

function usage(): string {
  return [
    "import-homewood-round1.ts",
    "",
    "Options:",
    "  --dry-run                Print diff, do not write to the database",
    "  --state-file <path>      Path to homewood-round1-state.json",
    "  --facility-id <uuid>     Target facility UUID (default: Homewood)",
    "  --organization-id <uuid> Target organization UUID (default: COL)",
    "  --applied-by <uuid>      auth.users id to record as `applied_by`",
    "  --verbose                Print per-row diffs",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Types describing what we'll write.
// ---------------------------------------------------------------------------
type RowKey = {
  organization_id: string;
  facility_id: string;
  module_code: string;
  field_path: string;
};

type RowPayload = RowKey & {
  value: unknown;                         // jsonb
  provenance: Record<string, unknown>;    // jsonb
  source_document_id: string | null;
  source_fact_id: string | null;
  applied_by: string | null;
  applied_at: string;
};

type ExistingRow = RowKey & {
  id: string;
  value: unknown;
  provenance: Record<string, unknown> | null;
};

type ChangeKind = "insert" | "update" | "noop";

type Plan = {
  kind: ChangeKind;
  payload: RowPayload;
  existing?: ExistingRow;
  diffSummary?: string;
};

// ---------------------------------------------------------------------------
// Build row payloads from the state JSON.
// ---------------------------------------------------------------------------
function isMeaningfulValue(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true; // numbers, booleans
}

function buildPayloads(
  state: Record<string, unknown>,
  args: Args,
  exportedAt: string,
): { payloads: RowPayload[]; skippedModules: string[]; skippedFields: Array<{ module: string; field: string; reason: string }> } {
  const mvpData = (state.mvpData ?? {}) as Record<string, Record<string, unknown>>;
  const payloads: RowPayload[] = [];
  const skippedModules: string[] = [];
  const skippedFields: Array<{ module: string; field: string; reason: string }> = [];

  for (const moduleCode of Object.keys(mvpData)) {
    if (ROUND2_GAPS.includes(moduleCode)) {
      skippedModules.push(`${moduleCode} (Round-2 gap)`);
      continue;
    }
    if (!ROUND1_MODULE_ALLOWLIST.has(moduleCode)) {
      skippedModules.push(`${moduleCode} (not in Round-1 allowlist)`);
      continue;
    }
    const moduleData = mvpData[moduleCode] ?? {};
    const sourceNotes = typeof moduleData._sourceNotes === "string" ? moduleData._sourceNotes : null;

    for (const fieldKey of Object.keys(moduleData)) {
      if (fieldKey.startsWith("_")) continue; // meta, e.g. _sourceNotes
      const value = moduleData[fieldKey];
      if (!isMeaningfulValue(value)) {
        skippedFields.push({ module: moduleCode, field: fieldKey, reason: "empty value" });
        continue;
      }
      payloads.push({
        organization_id: args.organizationId,
        facility_id: args.facilityId,
        module_code: moduleCode,
        field_path: fieldKey,
        value,
        provenance: {
          source: "facility-launch-center/data/homewood-round1-state.json",
          round: 1,
          exported_at: exportedAt,
          captured_by: "facility-launch-center",
          source_notes: sourceNotes,
        },
        source_document_id: null,
        source_fact_id: null,
        applied_by: args.appliedBy,
        applied_at: new Date().toISOString(),
      });
    }
  }

  const documents = Array.isArray(state.documents) ? state.documents as Array<Record<string, unknown>> : [];
  for (const doc of documents) {
    const docId = typeof doc.id === "string" && doc.id.trim() ? doc.id.trim() : null;
    if (!docId || !isMeaningfulValue(doc)) {
      skippedFields.push({ module: "M17", field: "documents", reason: "document missing id or metadata" });
      continue;
    }
    payloads.push({
      organization_id: args.organizationId,
      facility_id: args.facilityId,
      module_code: "M17",
      field_path: `documents.${docId}`,
      value: doc,
      provenance: {
        source: "facility-launch-center.documents",
        round: 1,
        exported_at: exportedAt,
        captured_by: "facility-launch-center",
      },
      source_document_id: null,
      source_fact_id: null,
      applied_by: args.appliedBy,
      applied_at: new Date().toISOString(),
    });
  }

  // Modules that the user listed in Round-1 but provided no fields for: log them.
  for (const code of ROUND1_MODULE_ALLOWLIST) {
    if (!mvpData[code]) {
      skippedModules.push(`${code} (no fields in state.mvpData)`);
    }
  }

  // Allowlisted modules that only had `_sourceNotes` (provenance only, no values).
  const rowsByModule = new Map<string, number>();
  for (const p of payloads) rowsByModule.set(p.module_code, (rowsByModule.get(p.module_code) ?? 0) + 1);
  for (const code of Object.keys(mvpData)) {
    if (!ROUND1_MODULE_ALLOWLIST.has(code)) continue;
    if ((rowsByModule.get(code) ?? 0) === 0) {
      skippedModules.push(`${code} (only _sourceNotes — no concrete values yet)`);
    }
  }

  return { payloads, skippedModules, skippedFields };
}

// ---------------------------------------------------------------------------
// Plan / apply against Supabase.
// ---------------------------------------------------------------------------
async function fetchExistingRows(
  supabase: SupabaseClient,
  organizationId: string,
  facilityId: string,
  moduleCodes: string[],
): Promise<Map<string, ExistingRow>> {
  const map = new Map<string, ExistingRow>();
  if (moduleCodes.length === 0) return map;

  const { data, error } = await supabase
    .from("facility_launch_module_values")
    .select("id, organization_id, facility_id, module_code, field_path, value, provenance")
    .eq("organization_id", organizationId)
    .eq("facility_id", facilityId)
    .in("module_code", moduleCodes)
    .is("deleted_at", null)
    .is("superseded_at", null);

  if (error) {
    throw new Error(`Failed to read existing facility_launch_module_values: ${error.message}`);
  }

  for (const row of data ?? []) {
    map.set(`${row.module_code}::${row.field_path}`, row as ExistingRow);
  }
  return map;
}

function diffValues(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

function shortPreview(value: unknown, max = 120): string {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

async function planAndApply(supabase: SupabaseClient, payloads: RowPayload[], args: Args): Promise<Plan[]> {
  const modules = Array.from(new Set(payloads.map((p) => p.module_code)));
  const existing = await fetchExistingRows(supabase, args.organizationId, args.facilityId, modules);

  const plans: Plan[] = payloads.map((payload) => {
    const key = `${payload.module_code}::${payload.field_path}`;
    const found = existing.get(key);
    if (!found) {
      return {
        kind: "insert",
        payload,
        diffSummary: `INSERT  ${payload.module_code}.${payload.field_path} = ${shortPreview(payload.value)}`,
      };
    }
    if (diffValues(found.value, payload.value)) {
      return {
        kind: "update",
        payload,
        existing: found,
        diffSummary: `UPDATE  ${payload.module_code}.${payload.field_path}: ${shortPreview(found.value)} → ${shortPreview(payload.value)}`,
      };
    }
    return {
      kind: "noop",
      payload,
      existing: found,
      diffSummary: `NOOP    ${payload.module_code}.${payload.field_path} (unchanged)`,
    };
  });

  if (args.dryRun) return plans;

  // Apply: inserts first (bulk), then updates one-by-one.
  const inserts = plans.filter((p) => p.kind === "insert").map((p) => p.payload);
  if (inserts.length > 0) {
    const { error } = await supabase.from("facility_launch_module_values").insert(inserts);
    if (error) throw new Error(`Insert failed: ${error.message}`);
  }
  for (const plan of plans) {
    if (plan.kind !== "update" || !plan.existing) continue;
    const { error } = await supabase
      .from("facility_launch_module_values")
      .update({
        value: plan.payload.value,
        provenance: plan.payload.provenance,
        source_document_id: plan.payload.source_document_id,
        source_fact_id: plan.payload.source_fact_id,
        applied_by: plan.payload.applied_by,
        applied_at: plan.payload.applied_at,
      })
      .eq("id", plan.existing.id);
    if (error) {
      throw new Error(
        `Update failed for ${plan.payload.module_code}.${plan.payload.field_path}: ${error.message}`,
      );
    }
  }

  return plans;
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!existsSync(args.stateFile)) {
    console.error(`state file not found: ${args.stateFile}`);
    process.exit(1);
  }
  const stateRaw = readFileSync(args.stateFile, "utf8");
  let state: Record<string, unknown>;
  try {
    state = JSON.parse(stateRaw) as Record<string, unknown>;
  } catch (err) {
    console.error(`state file is not valid JSON: ${(err as Error).message}`);
    process.exit(1);
  }

  const exportedAt =
    (state._meta && typeof (state._meta as Record<string, unknown>).exportedAt === "string"
      ? ((state._meta as Record<string, unknown>).exportedAt as string)
      : null) ?? new Date().toISOString();

  const { payloads, skippedModules, skippedFields } = buildPayloads(state, args, exportedAt);

  console.log("Homewood Round-1 importer");
  console.log("-------------------------");
  console.log(`state file        : ${args.stateFile}`);
  console.log(`organization_id   : ${args.organizationId}`);
  console.log(`facility_id       : ${args.facilityId}`);
  console.log(`mode              : ${args.dryRun ? "DRY-RUN" : "APPLY"}`);
  console.log(`payload row count : ${payloads.length}`);
  console.log(`round-2 gaps      : ${ROUND2_GAPS.join(", ")}`);
  if (skippedModules.length > 0) {
    console.log(`skipped modules   : ${skippedModules.join(", ")}`);
  }
  if (skippedFields.length > 0) {
    console.log(`skipped fields    : ${skippedFields.length} (use --verbose to list)`);
    if (args.verbose) {
      for (const s of skippedFields) console.log(`  - ${s.module}.${s.field} (${s.reason})`);
    }
  }

  if (payloads.length === 0) {
    console.log("Nothing to apply. Exiting.");
    return;
  }

  // Connect to Supabase (skip if dry-run AND no creds present).
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!supabaseUrl || !supabaseKey) {
    if (args.dryRun) {
      console.log("\nNo SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env — dry-run will only");
      console.log("print the planned payload without comparing against the live table.\n");
      for (const p of payloads) {
        console.log(`PLAN   ${p.module_code}.${p.field_path} = ${shortPreview(p.value)}`);
      }
      return;
    }
    console.error("Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY in environment.");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const plans = await planAndApply(supabase, payloads, args);

  const counts = { insert: 0, update: 0, noop: 0 };
  for (const plan of plans) {
    counts[plan.kind] += 1;
    if (args.verbose || plan.kind !== "noop") {
      console.log(plan.diffSummary);
    }
  }

  console.log("");
  console.log(`Done. inserts=${counts.insert}  updates=${counts.update}  noop=${counts.noop}`);
  if (args.dryRun) {
    console.log("(dry-run — no rows written)");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
