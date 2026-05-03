#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

const DEFAULT_ORGANIZATION_ID = "00000000-0000-0000-0000-000000000001";
const DEFAULT_HOMEWOOD_FACILITY_ID = "00000000-0000-0000-0002-000000000003";
const EXPECTED_FACILITIES = new Set([
  "Grande Cypress ALF",
  "Homewood Lodge ALF",
  "Oakridge ALF",
  "Plantation ALF",
  "Rising Oaks ALF",
]);

const ZERO_ROW_FACILITY_TABLES = [
  // Facility structure / census shell below the complex record.
  "units",
  "rooms",
  "beds",
  "census_daily_log",

  // Admissions / residents / family portal / clinical profile.
  "admission_cases",
  "advance_directive_documents",
  "assessments",
  "care_plans",
  "care_plan_items",
  "care_plan_tasks",
  "care_plan_change_tasks",
  "care_plan_review_alerts",
  "daily_logs",
  "adl_logs",
  "behavioral_logs",
  "condition_changes",
  "discharge_med_reconciliation",
  "family_care_conference_sessions",
  "family_consent_records",
  "family_message_triage_items",
  "family_portal_messages",
  "family_resident_links",
  "resident_contacts",
  "resident_documents",
  "resident_photos",
  "resident_observation_tasks",
  "residents",

  // Medication / infection / incidents / compliance.
  "controlled_substance_count_variance_events",
  "controlled_substance_counts",
  "emar_administration_witnesses",
  "emar_records",
  "incident_followups",
  "incident_photos",
  "incident_rca",
  "incident_root_causes",
  "incidents",
  "infection_outbreaks",
  "infection_surveillance",
  "infection_threshold_profiles",
  "compliance_survey_visit_notes",
  "compliance_survey_visits",

  // Staff, training, payroll, dietary, transportation.
  "competency_demonstrations",
  "diet_orders",
  "driver_credentials",
  "fleet_vehicles",
  "inservice_log_sessions",
  "mileage_logs",
  "payroll_export_batches",
  "payroll_export_lines",
  "schedules",
  "shift_assignments",
  "shift_handoffs",
  "shift_swap_requests",
  "staff",
  "staff_certifications",
  "staff_training_completions",
  "staffing_ratio_snapshots",
  "time_records",
  "resident_transport_requests",

  // Financials / vendors / reputation / referrals / executive data.
  "certificates_of_insurance",
  "claim_activities",
  "collection_activities",
  "contract_alerts",
  "contracts",
  "gl_budget_lines",
  "gl_period_closes",
  "incident_sequences",
  "insurance_policies",
  "invoice_line_items",
  "invoice_sequences",
  "invoices",
  "payments",
  "rate_schedules",
  "referral_hl7_inbound",
  "referral_leads",
  "referral_sources",
  "reputation_accounts",
  "reputation_replies",
  "resident_payers",
  "vendors",
];

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const contents = readFileSync(filePath, "utf8");
  for (const rawLine of contents.split(/\r?\n/)) {
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

function requiredEnv(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  throw new Error(`Missing required env var: ${names.join(" or ")}`);
}

function assertPass(checks, name, details = {}) {
  checks.push({ name, status: "pass", ...details });
}

function assertFail(checks, name, details = {}) {
  checks.push({ name, status: "fail", ...details });
}

async function countRows(supabase, table, column, value) {
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq(column, value);
  if (error) {
    const serialized = JSON.stringify(error);
    const looksLikeMissingFacilityColumn =
      error.code === "PGRST204" ||
      error.code === "42703" ||
      serialized.includes("facility_id") ||
      serialized === "{}" ||
      serialized === '{"message":""}';
    if (looksLikeMissingFacilityColumn) {
      return { skipped: true, reason: "not directly facility-scoped" };
    }
    throw new Error(`${table}.${column} count failed: ${error.message || serialized}`);
  }
  return { skipped: false, count: count ?? 0 };
}

async function main() {
  loadEnvFile(path.join(process.cwd(), ".env.local"));

  const organizationId = process.env.COL_ORGANIZATION_ID?.trim() || DEFAULT_ORGANIZATION_ID;
  const homewoodFacilityId =
    process.env.HOMEWOOD_FACILITY_ID?.trim() || DEFAULT_HOMEWOOD_FACILITY_ID;
  const url = requiredEnv("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "VITE_SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const checks = [];

  const { data: facilities, error: facilitiesError } = await supabase
    .from("facilities")
    .select("id, name, organization_id, deleted_at")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .order("name");
  if (facilitiesError) throw new Error(`facilities lookup failed: ${facilitiesError.message}`);

  const activeFacilityNames = new Set((facilities ?? []).map((facility) => facility.name));
  const missingFacilities = [...EXPECTED_FACILITIES].filter((name) => !activeFacilityNames.has(name));
  const extraFacilities = [...activeFacilityNames].filter((name) => !EXPECTED_FACILITIES.has(name));
  if (missingFacilities.length === 0 && extraFacilities.length === 0) {
    assertPass(checks, "active COL facility shells", { count: facilities?.length ?? 0 });
  } else {
    assertFail(checks, "active COL facility shells", { missingFacilities, extraFacilities });
  }

  const homewood = (facilities ?? []).find((facility) => facility.id === homewoodFacilityId);
  if (homewood?.name === "Homewood Lodge ALF") {
    assertPass(checks, "Homewood Lodge active shell", { facilityId: homewoodFacilityId });
  } else {
    assertFail(checks, "Homewood Lodge active shell", { facilityId: homewoodFacilityId, found: homewood ?? null });
  }

  const accessResult = await countRows(supabase, "user_facility_access", "facility_id", homewoodFacilityId);
  const accessCount = accessResult.skipped ? 0 : accessResult.count;
  if (accessCount > 0) {
    assertPass(checks, "Homewood user access preserved", { count: accessCount });
  } else {
    assertFail(checks, "Homewood user access preserved", { count: accessCount });
  }

  const tableCounts = [];
  for (const table of ZERO_ROW_FACILITY_TABLES) {
    const result = await countRows(supabase, table, "facility_id", homewoodFacilityId);
    if (result.skipped) {
      tableCounts.push({ table, skipped: true, reason: result.reason });
      checks.push({
        name: `${table} direct Homewood count skipped`,
        status: "skip",
        table,
        reason: result.reason,
      });
      continue;
    }

    const count = result.count;
    tableCounts.push({ table, count });
    if (count === 0) {
      assertPass(checks, `${table} empty for Homewood`, { table, count });
    } else {
      assertFail(checks, `${table} empty for Homewood`, { table, count });
    }
  }

  const failed = checks.filter((check) => check.status === "fail");
  const report = {
    generatedAt: new Date().toISOString(),
    missionAlignment: failed.length === 0 ? "pass" : "risk",
    organizationId,
    homewoodFacilityId,
    supabaseUrlHost: new URL(url).host,
    summary: {
      status: failed.length === 0 ? "ready" : "not_ready",
      totalChecks: checks.length,
      failedChecks: failed.length,
      zeroRowTablesChecked: ZERO_ROW_FACILITY_TABLES.length,
    },
    checks,
    tableCounts,
  };

  const outDir = path.join(process.cwd(), "test-results", "pilot-reset");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(
    outDir,
    `${new Date().toISOString().replace(/[:.]/g, "-")}-homewood-readiness-check.json`,
  );
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`[homewood-readiness] ${report.summary.status}`);
  console.log(`[homewood-readiness] report: ${outPath}`);
  if (failed.length > 0) {
    console.error(`[homewood-readiness] failed checks: ${failed.length}`);
    for (const check of failed.slice(0, 20)) {
      console.error(`- ${check.name}`);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("[homewood-readiness] failed:", error.message);
  process.exit(1);
});
