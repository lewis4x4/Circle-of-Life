#!/usr/bin/env node
/**
 * Seed the Smart Rounding surfaces in the Haven Demo Workspace so the Live
 * board, Monitoring Orders, Integrity and Reports tabs have something to show.
 *
 * DEMO WORKSPACE ONLY
 * -------------------
 * The organization is resolved by name (`Haven Demo Workspace`). If the name
 * does not resolve, the script prints SKIP and exits 0. If it resolves to the
 * Circle of Life organization it refuses and exits non-zero. Nothing here ever
 * runs against COL: a Monitoring Order is a clinical instruction and a seeded
 * one at a real building is an instruction staff will work.
 *
 * NO RESIDENT PHI
 * ---------------
 * No name of any kind is read out of the database or printed. The residents are
 * whoever the demo workspace already has, addressed by id. The one name this
 * script writes is the Monitoring Order's ordering party, which the column
 * requires, and it is generated from the synthetic list below and marked as a
 * demo value so it cannot be mistaken for a real prescriber.
 *
 * IDEMPOTENT
 * ----------
 * Every write is guarded. The Monitoring Order carries a marker in its reason
 * note and is not created twice. The observations are recorded only against
 * tasks that have no log yet. Re-running adds nothing and changes nothing.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It does not generate cadence tasks itself. `observation-task-generator` owns
 * that: absorption coverage, the stand-down of ungenerated tasks and assignee
 * resolution are all in it, and a second copy of that logic in a seed script is
 * how the two drift. When DEMO_TASK_GENERATOR_URL and its secret are set, this
 * script calls the deployed function. When they are not, it says so and leaves
 * the cadence board to the function's next scheduled tick rather than writing
 * task rows by hand.
 *
 * Env:
 *   SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)        required
 *   SUPABASE_SERVICE_ROLE_KEY                         required
 *   SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)  required, to sign in the demo caregiver
 *   DEMO_CAREGIVER_PASSWORD                           default HavenDemo2026!
 *   DEMO_CAREGIVER_EMAIL                              optional; otherwise the first caregiver in the workspace
 *   DEMO_TASK_GENERATOR_URL                           optional; the deployed function URL
 *   DEMO_TASK_GENERATOR_SECRET                        optional; its x-cron-secret
 *
 *   node scripts/smart-rounding/seed-demo-observations.mjs
 */
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { DEMO, createAdminSupabaseClient, optionalEnv } from "../demo/_config.mjs";

const PREFIX = "[seed-demo-observations]";
const COL_ORGANIZATION_ID = "00000000-0000-0000-0000-000000000001";

/** The marker that makes every write on this script's second run a no-op. */
const SEED_MARKER = "haven-demo-seed:smart-rounding:v1";

/**
 * Invented ordering parties. None of these is a real prescriber and the "demo"
 * suffix keeps it that way on screen: a seeded clinical instruction that reads
 * as though a real physician gave it is worse than an obviously seeded one.
 */
const SYNTHETIC_ORDERING_PARTIES = [
  "Dr A. Quillon (demo)",
  "Dr M. Brackwater (demo)",
  "Dr S. Hollindale (demo)",
  "Dr R. Fennimore (demo)",
  "Dr T. Aldergrove (demo)",
];

/** The three chip groups Part 2 added, as `observation_vocab.field_name` values. */
const CHIP_GROUPS = ["meal_intake", "mood_state", "med_response"];

function log(message) {
  console.log(`${PREFIX} ${message}`);
}

function fail(message) {
  console.error(`${PREFIX} ${message}`);
  process.exit(1);
}

async function resolveDemoOrganization(admin) {
  const { data, error } = await admin
    .from("organizations")
    .select("id, name")
    .eq("name", DEMO.orgName)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) fail(`organization lookup failed: ${error.message}`);
  if (!data) {
    log(`SKIP: ${DEMO.orgName} not found on this project`);
    process.exit(0);
  }
  if (data.id === COL_ORGANIZATION_ID) {
    fail(
      `REFUSING to seed. "${DEMO.orgName}" resolved to the Circle of Life organization ${COL_ORGANIZATION_ID}. ` +
        "This script creates Monitoring Orders and observation logs; at a real building those are a clinical instruction and a clinical record. " +
        "Point SUPABASE_URL at the demo project.",
    );
  }
  return data.id;
}

async function signInCaregiver(organizationId, admin) {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) fail("SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) is required to sign in the demo caregiver.");

  let query = admin
    .from("user_profiles")
    .select("id, email, app_role")
    .eq("organization_id", organizationId)
    .eq("app_role", "caregiver")
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  const explicit = optionalEnv("DEMO_CAREGIVER_EMAIL");
  if (explicit) query = query.eq("email", explicit);
  const { data, error } = await query.limit(1).maybeSingle();
  if (error) fail(`caregiver lookup failed: ${error.message}`);
  if (!data) fail("no caregiver in the demo workspace; run scripts/demo/seed-demo-data.mjs first.");

  const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const password = optionalEnv("DEMO_CAREGIVER_PASSWORD") ?? "HavenDemo2026!";
  const { error: signInError } = await client.auth.signInWithPassword({ email: data.email, password });
  if (signInError) fail(`demo caregiver sign-in failed: ${signInError.message}`);
  return { client, userId: data.id };
}

/** The vocabulary codes this building offers, one chip per group. Never a literal. */
async function firstChipCodes(admin, organizationId, facilityId) {
  const { data, error } = await admin
    .from("observation_vocab")
    .select("field_name, value_code, display_order, facility_id")
    .eq("organization_id", organizationId)
    .eq("active", true)
    .is("deleted_at", null)
    .in("field_name", [...CHIP_GROUPS, "location", "state"])
    .order("display_order", { ascending: true });
  if (error) fail(`observation_vocab read failed: ${error.message}`);

  const byField = new Map();
  for (const row of data ?? []) {
    // A facility row wins over the organization wide row for the same field.
    if (row.facility_id && row.facility_id !== facilityId) continue;
    const held = byField.get(row.field_name);
    if (!held || (!held.facility_id && row.facility_id)) byField.set(row.field_name, row);
  }
  return byField;
}

async function main() {
  const admin = createAdminSupabaseClient();
  const organizationId = await resolveDemoOrganization(admin);
  log(`organization ${organizationId}`);

  const { data: facilities, error: facilitiesError } = await admin
    .from("facilities")
    .select("id")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (facilitiesError) fail(`facility lookup failed: ${facilitiesError.message}`);
  if (!facilities || facilities.length === 0) fail("the demo workspace has no facility.");
  // Selected by organization, never by name: migration 318 renamed two of the
  // five COL buildings and any script carrying a facility name silently
  // touches a subset and reports success.
  log(`facilities ${facilities.length}`);

  const summary = {
    configured: 0,
    configurationSkipped: [],
    ordersCreated: 0,
    ordersAlreadyPresent: 0,
    generatorCalled: false,
    observationsRecorded: 0,
    observationsAlreadyPresent: 0,
  };

  // 1. Configuration first. Idempotent by design, and it never opens a version
  //    inside a timeline a facility already owns.
  for (const facility of facilities) {
    const { data, error } = await admin.rpc("ensure_facility_observation_defaults", { p_facility_id: facility.id });
    if (error) fail(`ensure_facility_observation_defaults failed for ${facility.id}: ${error.message}`);
    const seeded = data?.seeded ?? data?.[0]?.seeded ?? null;
    if (seeded === false) summary.configurationSkipped.push(`${facility.id}:${data?.reason ?? "no reason given"}`);
    else summary.configured += 1;
  }

  const caregiver = await signInCaregiver(organizationId, admin);
  log(`caregiver ${caregiver.userId}`);

  // 2. One Monitoring Order per facility, guarded by the seed marker. The
  //    command generates the order's own checks, so the board is not empty even
  //    when the cadence generator has not run here.
  const intervalOptions = await admin.rpc("monitoring_order_interval_options");
  const intervalMinutes = Array.isArray(intervalOptions.data) && intervalOptions.data.length > 0
    ? intervalOptions.data[0].interval_minutes ?? intervalOptions.data[0].minutes ?? null
    : null;
  if (intervalOptions.error || intervalMinutes == null) {
    fail(`monitoring_order_interval_options gave no interval: ${intervalOptions.error?.message ?? "empty"}`);
  }

  for (const [index, facility] of facilities.entries()) {
    const existing = await admin
      .from("resident_monitoring_orders")
      .select("id", { count: "exact", head: true })
      .eq("facility_id", facility.id)
      .like("reason_note", `%${SEED_MARKER}%`)
      .is("deleted_at", null);
    if (existing.error) fail(`Monitoring Order lookup failed: ${existing.error.message}`);
    if ((existing.count ?? 0) > 0) {
      summary.ordersAlreadyPresent += 1;
      continue;
    }

    const resident = await admin
      .from("residents")
      .select("id")
      .eq("facility_id", facility.id)
      .eq("status", "active")
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (resident.error) fail(`resident lookup failed: ${resident.error.message}`);
    if (!resident.data) {
      log(`facility ${facility.id} has no active resident; no Monitoring Order seeded there`);
      continue;
    }

    const created = await caregiver.client.rpc("create_monitoring_order", {
      p_resident_id: resident.data.id,
      p_interval_minutes: intervalMinutes,
      p_ordered_by_type: "facility_nurse",
      p_ordered_by_name: SYNTHETIC_ORDERING_PARTIES[index % SYNTHETIC_ORDERING_PARTIES.length],
      p_order_received_as: "verbal",
      p_reason_category: "change_in_condition",
      p_reason_note: `Demo workspace sample order. ${SEED_MARKER}`,
      p_review_due_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
    if (created.error) fail(`create_monitoring_order failed at ${facility.id}: ${created.error.message}`);
    summary.ordersCreated += 1;
  }

  // 3. Cadence tasks, from the function that owns them.
  const generatorUrl = optionalEnv("DEMO_TASK_GENERATOR_URL");
  const generatorSecret = optionalEnv("DEMO_TASK_GENERATOR_SECRET");
  if (generatorUrl && generatorSecret) {
    const response = await fetch(generatorUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cron-secret": generatorSecret },
      body: JSON.stringify({ organization_id: organizationId }),
    });
    const body = await response.json().catch(() => ({}));
    summary.generatorCalled = true;
    log(`observation-task-generator answered ${response.status}: attempted ${body.facilities_attempted ?? "?"}, succeeded ${body.facilities_succeeded ?? "?"}, without cadence ${body.facilities_without_cadence ?? "?"}`);
    if (!response.ok && response.status !== 207) fail(`the generator refused the call (${response.status})`);
  } else {
    log("DEMO_TASK_GENERATOR_URL / DEMO_TASK_GENERATOR_SECRET not set, so no cadence tasks were generated.");
    log("The order tasks above are on the board now; the cadence board fills on the function's next tick.");
    log("This script does not write cadence task rows by hand: observation-task-generator owns absorption, stand-down and assignee resolution, and a second copy of that logic here would drift from it.");
  }

  // 4. Record observations against a few open tasks, so the composed narrative,
  //    the chip selections and the compliance read all have real material.
  //    Deliberately not all of them: a board with nothing outstanding shows
  //    neither an escalation nor a compliance gap.
  const RECORD_PER_FACILITY = 4;
  for (const facility of facilities) {
    const codes = await firstChipCodes(admin, organizationId, facility.id);
    const location = codes.get("location")?.value_code ?? null;
    const state = codes.get("state")?.value_code ?? null;
    if (!location || !state) {
      log(`facility ${facility.id} has no location or presentation vocabulary; no observations recorded there`);
      continue;
    }
    const chipSelections = {};
    for (const group of CHIP_GROUPS) {
      const code = codes.get(group)?.value_code;
      if (code) chipSelections[group] = [code];
    }
    if (Object.keys(chipSelections).length === 0) {
      log(`facility ${facility.id} has no chip vocabulary; no observations recorded there`);
      continue;
    }

    const open = await admin
      .from("resident_observation_tasks")
      .select("id")
      .eq("facility_id", facility.id)
      .in("status", ["due_now", "due_soon", "overdue", "upcoming"])
      .is("deleted_at", null)
      .order("due_at", { ascending: true })
      .limit(RECORD_PER_FACILITY * 4);
    if (open.error) fail(`task lookup failed: ${open.error.message}`);

    let recorded = 0;
    for (const task of open.data ?? []) {
      if (recorded >= RECORD_PER_FACILITY) break;
      const logged = await admin
        .from("resident_observation_logs")
        .select("id", { count: "exact", head: true })
        .eq("task_id", task.id)
        .is("deleted_at", null);
      if (logged.error) fail(`log lookup failed: ${logged.error.message}`);
      if ((logged.count ?? 0) > 0) {
        summary.observationsAlreadyPresent += 1;
        continue;
      }

      const submitted = await caregiver.client.rpc("submit_observation", {
        p_task_id: task.id,
        p_chip_selections: chipSelections,
        p_resident_location: location,
        p_resident_state: state,
        p_quick_status: "calm",
        // Deliberately empty. Acceptance item 4: a chip composed observation
        // succeeds with no free text and still stores a composed summary.
        p_note: null,
      });
      if (submitted.error) {
        // A task the caregiver holds no assignment on is refused by design
        // (decision D12). That is the security model working, not a seed
        // failure, so it moves on to the next task and reports the total.
        continue;
      }
      recorded += 1;
      summary.observationsRecorded += 1;
    }
  }

  log("");
  log(`facilities configured                 ${summary.configured}`);
  if (summary.configurationSkipped.length > 0) {
    log(`facilities with nothing to inherit    ${summary.configurationSkipped.length}`);
    for (const entry of summary.configurationSkipped) log(`  ${entry}`);
  }
  log(`Monitoring Orders created             ${summary.ordersCreated}`);
  log(`Monitoring Orders already seeded      ${summary.ordersAlreadyPresent}`);
  log(`cadence generator called              ${summary.generatorCalled}`);
  log(`observations recorded                 ${summary.observationsRecorded}`);
  log(`tasks that already carried a log      ${summary.observationsAlreadyPresent}`);
  log("ids and counts only; no resident name was read or printed");
  log("PASS");
}

main().catch((cause) => {
  console.error(`${PREFIX} FATAL: ${cause instanceof Error ? cause.message : String(cause)}`);
  process.exit(1);
});
