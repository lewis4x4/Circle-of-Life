#!/usr/bin/env node
import process from "node:process";

import { assertNoError, createAdminSupabaseClient, DEMO, DEMO_IDS } from "./_config.mjs";

async function deleteByOrg(supabase, table) {
  await assertNoError(
    `delete ${table}`,
    supabase.from(table).delete().eq("organization_id", DEMO_IDS.orgId),
  );
}

async function requireExplicitDemoResetApproval(supabase) {
  if (process.env.HAVEN_ALLOW_DEMO_RESET !== "1") {
    throw new Error(
      "Refusing to reset demo data without HAVEN_ALLOW_DEMO_RESET=1. This script is destructive.",
    );
  }

  const targetUrl =
    process.env.SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.VITE_SUPABASE_URL ??
    "";
  const isHostedSupabase = /\.supabase\.co\/?$/.test(targetUrl.replace(/^https?:\/\//, ""));
  if (isHostedSupabase && process.env.HAVEN_ALLOW_REMOTE_DEMO_RESET !== "1") {
    throw new Error(
      "Refusing to reset demo data on hosted Supabase without HAVEN_ALLOW_REMOTE_DEMO_RESET=1.",
    );
  }

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("id, name, deleted_at")
    .eq("id", DEMO_IDS.orgId)
    .maybeSingle();
  if (orgError) throw new Error(`demo org verification failed: ${orgError.message}`);
  if (!org || org.name !== DEMO.orgName) {
    throw new Error("Refusing reset: deterministic demo organization was not found.");
  }

  const { data: facility, error: facilityError } = await supabase
    .from("facilities")
    .select("id, name, organization_id, deleted_at")
    .eq("id", DEMO_IDS.facilityId)
    .maybeSingle();
  if (facilityError) {
    throw new Error(`demo facility verification failed: ${facilityError.message}`);
  }
  if (
    !facility ||
    facility.name !== DEMO.facilityName ||
    facility.organization_id !== DEMO_IDS.orgId
  ) {
    throw new Error("Refusing reset: deterministic demo facility was not found.");
  }
}

async function main() {
  const supabase = createAdminSupabaseClient();
  await requireExplicitDemoResetApproval(supabase);
  const facilityId = DEMO_IDS.facilityId;

  console.log("[demo:reset] deleting deterministic demo workspace data...");

  // Break resident <-> bed cyclic reference first.
  await assertNoError(
    "clear bed occupancy",
    supabase
      .from("beds")
      .update({ current_resident_id: null })
      .eq("organization_id", DEMO_IDS.orgId),
  );

  // Highest-dependency tables first.
  await deleteByOrg(supabase, "collection_activities");
  await deleteByOrg(supabase, "payments");
  await deleteByOrg(supabase, "invoice_line_items");
  await deleteByOrg(supabase, "invoices");
  await deleteByOrg(supabase, "resident_payers");
  await deleteByOrg(supabase, "rate_schedules");

  await deleteByOrg(supabase, "staffing_ratio_snapshots");
  await deleteByOrg(supabase, "shift_swap_requests");
  await deleteByOrg(supabase, "time_records");
  await deleteByOrg(supabase, "shift_assignments");
  await deleteByOrg(supabase, "schedules");
  await deleteByOrg(supabase, "staff_certifications");
  await deleteByOrg(supabase, "staff");

  await deleteByOrg(supabase, "incident_photos");
  await deleteByOrg(supabase, "incident_followups");
  await deleteByOrg(supabase, "incidents");

  await deleteByOrg(supabase, "activity_attendance");
  await deleteByOrg(supabase, "activity_sessions");
  await deleteByOrg(supabase, "activities");
  await deleteByOrg(supabase, "shift_handoffs");
  await deleteByOrg(supabase, "condition_changes");
  await deleteByOrg(supabase, "behavioral_logs");
  await deleteByOrg(supabase, "emar_records");
  await deleteByOrg(supabase, "resident_medications");
  await deleteByOrg(supabase, "adl_logs");
  await deleteByOrg(supabase, "daily_logs");
  await deleteByOrg(supabase, "census_daily_log");

  await deleteByOrg(supabase, "resident_documents");
  await deleteByOrg(supabase, "resident_contacts");
  await deleteByOrg(supabase, "resident_photos");
  await deleteByOrg(supabase, "assessments");
  await deleteByOrg(supabase, "care_plan_items");
  await deleteByOrg(supabase, "care_plans");
  await deleteByOrg(supabase, "residents");

  await deleteByOrg(supabase, "family_resident_links");
  await deleteByOrg(supabase, "user_facility_access");
  await deleteByOrg(supabase, "user_profiles");

  await deleteByOrg(supabase, "beds");
  await deleteByOrg(supabase, "rooms");
  await deleteByOrg(supabase, "units");

  await deleteByOrg(supabase, "search_documents");
  await deleteByOrg(supabase, "payroll_export_batches");
  await deleteByOrg(supabase, "diet_orders");
  await deleteByOrg(supabase, "reputation_replies");
  await deleteByOrg(supabase, "reputation_accounts");
  await deleteByOrg(supabase, "competency_demonstrations");
  await deleteByOrg(supabase, "insurance_policies");

  await assertNoError(
    "delete incident_sequences",
    supabase.from("incident_sequences").delete().eq("facility_id", facilityId),
  );
  await assertNoError(
    "delete invoice_sequences",
    supabase.from("invoice_sequences").delete().eq("facility_id", facilityId),
  );

  await assertNoError(
    "delete facilities",
    supabase.from("facilities").delete().eq("organization_id", DEMO_IDS.orgId),
  );
  await assertNoError(
    "delete entities",
    supabase.from("entities").delete().eq("organization_id", DEMO_IDS.orgId),
  );
  await assertNoError(
    "delete organizations",
    supabase.from("organizations").delete().eq("id", DEMO_IDS.orgId),
  );

  console.log("[demo:reset] done");
}

main().catch((error) => {
  console.error("[demo:reset] failed:", error.message);
  process.exit(1);
});
