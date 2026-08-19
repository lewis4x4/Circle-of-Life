#!/usr/bin/env node
/**
 * Probes the linked Supabase project for schema artifacts required by migrations 250–288
 * and high-traffic app surfaces. Fails when columns/tables are missing (schema drift).
 *
 * Requires .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage: npm run migrations:verify:remote
 */
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("[verify-remote-schema] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(2);
}

const sb = createClient(url, key);
const NIL_UUID = "00000000-0000-0000-0000-000000000001";

/** @type {Array<{ kind: "column"; table: string; column: string; migration: string } | { kind: "table"; table: string; migration: string } | { kind: "rpc"; name: string; args: Record<string, unknown>; migration: string }>} */
const PROBES = [
  // 250
  { kind: "table", table: "organization_operational_threshold_defaults", migration: "250" },
  { kind: "column", table: "facility_operational_thresholds", column: "alert_frequency", migration: "250" },
  // 253
  { kind: "column", table: "referral_leads", column: "preferred_contact", migration: "253" },
  { kind: "column", table: "referral_leads", column: "inquiry_date", migration: "253" },
  // 254–258 admissions / residents
  { kind: "column", table: "admission_cases", column: "intake_program_type", migration: "254" },
  { kind: "column", table: "admission_cases", column: "anticipated_payer_source", migration: "256" },
  { kind: "column", table: "admission_cases", column: "anticipated_payer_other", migration: "256" },
  { kind: "column", table: "admission_cases", column: "source", migration: "258" },
  { kind: "column", table: "admission_cases", column: "source_other", migration: "258" },
  { kind: "column", table: "residents", column: "override_reason", migration: "257" },
  { kind: "column", table: "residents", column: "override_full_intake_pending", migration: "257" },
  { kind: "column", table: "residents", column: "name_suffix", migration: "258" },
  { kind: "column", table: "residents", column: "primary_phone", migration: "258" },
  { kind: "column", table: "residents", column: "gender_other", migration: "258" },
  { kind: "column", table: "residents", column: "code_status_verified_at", migration: "259" },
  { kind: "column", table: "residents", column: "code_status_verified_by", migration: "259" },
  { kind: "column", table: "residents", column: "allergy_list_reviewed_at", migration: "259" },
  { kind: "column", table: "residents", column: "allergy_list_reviewed_by", migration: "259" },
  { kind: "column", table: "residents", column: "primary_diagnosis_reviewed_at", migration: "259" },
  { kind: "column", table: "residents", column: "primary_diagnosis_reviewed_by", migration: "259" },
  // 255 discharge
  { kind: "column", table: "discharge_med_reconciliation", column: "discharge_plan_category", migration: "255" },
  { kind: "column", table: "discharge_med_reconciliation", column: "expected_discharge_date", migration: "255" },
  // 261
  {
    kind: "column",
    table: "resident_observation_escalations",
    column: "resolution_rationale",
    migration: "261",
  },
  // 262 exec
  { kind: "column", table: "exec_dashboard_configs", column: "updated_by", migration: "262" },
  { kind: "column", table: "exec_alerts", column: "updated_by", migration: "262" },
  // 274 NLQ threads
  { kind: "column", table: "exec_nlq_sessions", column: "last_message_at", migration: "274" },
  { kind: "column", table: "exec_nlq_sessions", column: "message_count", migration: "274" },
  { kind: "column", table: "exec_nlq_sessions", column: "pinned_at", migration: "274" },
  { kind: "column", table: "exec_nlq_sessions", column: "archived_at", migration: "274" },
  { kind: "column", table: "exec_nlq_sessions", column: "next_message_ordinal", migration: "276" },
  { kind: "table", table: "exec_nlq_messages", migration: "274" },
  { kind: "column", table: "exec_nlq_messages", column: "feedback", migration: "274" },
  // 280 facilities
  { kind: "column", table: "facilities", column: "facility_overrides", migration: "280" },
  { kind: "column", table: "facilities", column: "pharmacy_vendor", migration: "280" },
  { kind: "column", table: "facilities", column: "occupancy_pct", migration: "280" },
  { kind: "column", table: "facilities", column: "ahca_license_number", migration: "280" },
  { kind: "column", table: "facilities", column: "ahca_license_expiration", migration: "280" },
  // 283 compliance skeleton
  { kind: "table", table: "legal_entities", migration: "283" },
  { kind: "table", table: "fl_statutes", migration: "283" },
  { kind: "table", table: "background_screenings", migration: "283" },
  // RPCs — non-PGRST202 errors mean the function exists
  {
    kind: "rpc",
    name: "upsert_facility_operational_thresholds",
    migration: "265",
    args: {
      p_facility_id: NIL_UUID,
      p_organization_id: NIL_UUID,
      p_actor_id: NIL_UUID,
      p_thresholds: [],
    },
  },
  {
    kind: "rpc",
    name: "persist_monthly_invoices_from_preview",
    migration: "266",
    args: {
      p_facility_id: NIL_UUID,
      p_billing_year: 2026,
      p_billing_month: 1,
      p_preview: [],
      p_period_start: "2026-01-01",
      p_period_end: "2026-01-31",
      p_due_date: "2026-02-01",
    },
  },
  {
    kind: "rpc",
    name: "bulk_complete_operation_tasks",
    migration: "264",
    args: {
      p_task_ids: [],
      p_actor_id: NIL_UUID,
      p_actor_role: "owner",
      p_completion_notes: null,
      p_completed_at: new Date(0).toISOString(),
    },
  },
  {
    kind: "rpc",
    name: "apply_invoice_payment",
    migration: "288",
    args: { p_invoice_id: NIL_UUID, p_amount_cents: 0 },
  },
  {
    kind: "rpc",
    name: "search_nlq_threads",
    migration: "275",
    args: { p_query: "__schema_probe__", p_limit: 1 },
  },
  { kind: "column", table: "snack_logs", column: "snack_at", migration: "311" },
  { kind: "column", table: "snack_logs", column: "passed_by_user_id", migration: "311" },
  {
    kind: "rpc",
    name: "admin_command_center_projection",
    migration: "315",
    args: { p_facility_id: null },
  },
  {
    kind: "rpc",
    name: "apply_col_discovery_round_observation_plan",
    migration: "310",
    args: { p_resident_id: NIL_UUID },
  },
];

async function probeColumn(table, column) {
  const { error } = await sb.from(table).select(column).limit(0);
  if (!error) return { ok: true };
  const msg = error.message ?? "";
  if (
    msg.includes("does not exist") ||
    error.code === "42703" ||
    error.code === "PGRST204" ||
    msg.includes("Could not find the table")
  ) {
    return { ok: false, reason: msg };
  }
  return { ok: true, note: msg };
}

async function probeTable(table) {
  const { error } = await sb.from(table).select("id").limit(0);
  if (!error) return { ok: true };
  const msg = error.message ?? "";
  if (msg.includes("Could not find the table") || error.code === "PGRST205") {
    return { ok: false, reason: msg };
  }
  return { ok: true, note: msg };
}

async function probeRpc(name, args) {
  const { error } = await sb.rpc(name, args);
  if (!error) return { ok: true };
  const msg = error.message ?? "";
  if (error.code === "PGRST202" || /Could not find the function/i.test(msg)) {
    return { ok: false, reason: msg };
  }
  return { ok: true, note: msg };
}

async function main() {
  console.log(`[verify-remote-schema] Probing ${url}\n`);

  const missing = [];

  for (const probe of PROBES) {
    let r;
    if (probe.kind === "column") {
      r = await probeColumn(probe.table, probe.column);
    } else if (probe.kind === "table") {
      r = await probeTable(probe.table);
    } else {
      r = await probeRpc(probe.name, probe.args);
    }

    if (!r.ok) {
      const artifact =
        probe.kind === "column"
          ? `${probe.table}.${probe.column}`
          : probe.kind === "table"
            ? `table ${probe.table}`
            : `rpc ${probe.name}()`;
      missing.push({
        migration: probe.migration,
        artifact,
        reason: r.reason,
      });
    }
  }

  if (missing.length === 0) {
    console.log(`PASS: ${PROBES.length} probes OK`);
    process.exit(0);
  }

  console.error(`FAIL: ${missing.length} missing artifact(s)\n`);
  for (const m of missing) {
    console.error(`  [migration ${m.migration}] ${m.artifact}`);
    console.error(`    ${m.reason}`);
    console.error(`    Repair: npx supabase db query --linked -f supabase/migrations/${m.migration}_*.sql\n`);
  }
  process.exit(1);
}

main().catch((err) => {
  console.error("[verify-remote-schema] fatal:", err);
  process.exit(2);
});
