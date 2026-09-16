#!/usr/bin/env node
/**
 * Spec 07A section 9 item 8: row-level security checks for `care_events`.
 *
 *   family cannot select care_events;
 *   a caregiver at facility A cannot read facility B's rows;
 *   a caregiver cannot update final_level (note-only edits are allowed).
 *
 * Runs against whatever stack the environment points at. Never point it at
 * production: it signs in as seeded demo accounts and submits one Level 2 fall
 * through `submit_care_event`, then hard-deletes what it created through the
 * service role.
 *
 * Env:
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY   required
 *   CARE_EVENT_RLS_PASSWORD                                      default HavenDemo2026!
 *   CARE_EVENT_RLS_FACILITY_ID                                   default Homewood Lodge
 *   CARE_EVENT_RLS_ACCOUNTS  JSON {"caregiver","family","other_facility","facility_admin"} email overrides
 *
 * Output: one line per check, `[rls] PASS <check>` or `[rls] FAIL <check>`; exit 1 on any FAIL.
 * Prints ids and counts only, never resident names.
 */
import process from "node:process";
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const PASSWORD = process.env.CARE_EVENT_RLS_PASSWORD ?? "HavenDemo2026!";
const FACILITY_ID = process.env.CARE_EVENT_RLS_FACILITY_ID ?? "00000000-0000-0000-0002-000000000003";

// Retired 2026-09-16: the hardcoded @circleoflifealf.com personas that used to sit here were fictitious accounts and no longer exist. Supply real accounts via the env var below.
// There is no default account map any more; CARE_EVENT_RLS_ACCOUNTS is required.
const REQUIRED_ACCOUNT_ROLES = ["caregiver", "family", "other_facility", "facility_admin"];

const SIGN_IN_ATTEMPTS = 3;
const SIGN_IN_PAUSE_MS = 5_000;

function fail(message) {
  console.error(`[rls] ${message}`);
  process.exit(1);
}

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  fail("SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are required.");
}

function readAccounts() {
  const raw = process.env.CARE_EVENT_RLS_ACCOUNTS;
  if (!raw) {
    fail(
      `CARE_EVENT_RLS_ACCOUNTS is required — JSON mapping ${REQUIRED_ACCOUNT_ROLES.join(", ")} to real account emails. ` +
        "The former hardcoded @circleoflifealf.com defaults were fictitious personas retired 2026-09-16.",
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fail(`CARE_EVENT_RLS_ACCOUNTS is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { ...DEFAULT_ACCOUNTS, ...(parsed && typeof parsed === "object" ? parsed : {}) };
}

const ACCOUNTS = readAccounts();

const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function anonClient() {
  return createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function signIn(label, email) {
  const client = anonClient();
  let lastError = null;
  for (let attempt = 1; attempt <= SIGN_IN_ATTEMPTS; attempt += 1) {
    const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
    if (!error) return client;
    lastError = error;
    console.warn(`[rls] sign-in as ${label} attempt ${attempt} of ${SIGN_IN_ATTEMPTS} failed: ${error.message}`);
    if (attempt < SIGN_IN_ATTEMPTS) await sleep(SIGN_IN_PAUSE_MS);
  }
  throw new Error(`sign-in as ${label} failed: ${lastError?.message ?? "unknown error"}`);
}

const results = [];
function record(ok, check, detail) {
  results.push(ok);
  console.log(`[rls] ${ok ? "PASS" : "FAIL"} ${check}${detail ? ` (${detail})` : ""}`);
}

// ---------------------------------------------------------------------------
// Cleanup (same order as tests/care-events/_helpers.ts cleanupCareEventsForUser)
// ---------------------------------------------------------------------------

function warn(step, error) {
  if (error) console.warn(`[rls] cleanup ${step} failed: ${error.message ?? "unknown error"}`);
}

async function cleanup(careEventId) {
  const event = await service
    .from("care_events")
    .select("id, incident_id, condition_change_id, behavioral_log_id")
    .eq("id", careEventId)
    .maybeSingle();
  warn("select care_events", event.error);
  const row = event.data;
  if (!row) return;
  const incidentIds = row.incident_id ? [row.incident_id] : [];
  const sourceIds = [...incidentIds, row.id];

  warn("care_event_deliveries", (await service.from("care_event_deliveries").delete().eq("care_event_id", row.id)).error);
  if (incidentIds.length > 0) {
    warn("incident_followups", (await service.from("incident_followups").delete().in("incident_id", incidentIds)).error);
    warn(
      "regulatory_reporting_obligations",
      (await service.from("regulatory_reporting_obligations").delete().in("incident_id", incidentIds)).error,
    );
    warn("incident_photos", (await service.from("incident_photos").delete().in("incident_id", incidentIds)).error);
  }
  warn("care_plan_review_alerts", (await service.from("care_plan_review_alerts").delete().in("trigger_source_id", sourceIds)).error);
  const watches = await service.from("resident_watch_instances").select("id").in("triggered_by_id", sourceIds);
  warn("select resident_watch_instances", watches.error);
  const watchIds = (watches.data ?? []).map((watch) => watch.id);
  if (watchIds.length > 0) {
    warn("resident_watch_events", (await service.from("resident_watch_events").delete().in("watch_instance_id", watchIds)).error);
    warn("resident_watch_instances", (await service.from("resident_watch_instances").delete().in("id", watchIds)).error);
  }
  warn("exec_alerts", (await service.from("exec_alerts").delete().like("deep_link_path", `/admin/care-events/${row.id}%`)).error);
  warn("care_events", (await service.from("care_events").delete().eq("id", row.id)).error);
  if (row.condition_change_id) {
    warn("condition_changes", (await service.from("condition_changes").delete().eq("id", row.condition_change_id)).error);
  }
  if (row.behavioral_log_id) {
    warn("behavioral_logs", (await service.from("behavioral_logs").delete().eq("id", row.behavioral_log_id)).error);
  }
  if (incidentIds.length > 0) {
    warn("incidents", (await service.from("incidents").delete().in("id", incidentIds)).error);
  }
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

async function main() {
  const resident = await service
    .from("residents")
    .select("id")
    .eq("facility_id", FACILITY_ID)
    .eq("status", "active")
    .is("deleted_at", null)
    .order("last_name", { ascending: true })
    .order("first_name", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (resident.error) fail(`resident lookup failed: ${resident.error.message}`);
  if (!resident.data) fail(`no active resident at facility ${FACILITY_ID}`);
  const residentId = resident.data.id;

  const caregiver = await signIn("caregiver", ACCOUNTS.caregiver);
  const clientEventId = randomUUID();
  const submit = await caregiver.rpc("submit_care_event", {
    p_payload: {
      client_event_id: clientEventId,
      facility_id: FACILITY_ID,
      resident_id: residentId,
      kind: "fall",
      answers: { hurt: "not_hurt", head: "no", witnessed: "yes", going_out: "no", worried: false },
      note: null,
      occurred_at: new Date().toISOString(),
      location_code: null,
      captured_offline: false,
    },
  });
  if (submit.error) fail(`submit_care_event failed: ${submit.error.message}`);
  const careEventId = submit.data?.care_event_id ?? null;
  const submittedLevel = Number(submit.data?.level);
  record(Boolean(careEventId) && submittedLevel === 2, "caregiver submits a Level 2 fall", `care_event ${careEventId}, level ${submittedLevel}`);
  if (!careEventId) fail("no care_event_id in the receipt; stopping before the cross-role checks.");

  try {
    // family cannot select care_events
    const family = await signIn("family", ACCOUNTS.family);
    const familyRead = await family.from("care_events").select("id").eq("id", careEventId);
    const familyRows = familyRead.data?.length ?? 0;
    record(
      Boolean(familyRead.error) || familyRows === 0,
      "family cannot select care_events",
      familyRead.error ? `error: ${familyRead.error.message}` : `${familyRows} rows`,
    );

    // a user without access to this facility cannot read its rows
    const other = await signIn("other_facility", ACCOUNTS.other_facility);
    const otherRead = await other.from("care_events").select("id").eq("facility_id", FACILITY_ID);
    const otherRows = otherRead.data?.length ?? 0;
    record(
      Boolean(otherRead.error) || otherRows === 0,
      "other-facility user cannot read this facility's care_events",
      otherRead.error ? `error: ${otherRead.error.message}` : `${otherRows} rows`,
    );

    // caregiver cannot change final_level
    const levelUpdate = await caregiver.from("care_events").update({ final_level: "level_1" }).eq("id", careEventId).select("id");
    const levelChanged = levelUpdate.data?.length ?? 0;
    const reread = await service.from("care_events").select("final_level, note").eq("id", careEventId).maybeSingle();
    if (reread.error) fail(`service re-read failed: ${reread.error.message}`);
    const levelIntact = reread.data?.final_level === "level_2";
    record(
      (Boolean(levelUpdate.error) || levelChanged === 0) && levelIntact,
      "caregiver cannot update final_level",
      levelUpdate.error ? `error: ${levelUpdate.error.message}; level ${reread.data?.final_level}` : `${levelChanged} rows changed; level ${reread.data?.final_level}`,
    );

    // caregiver may edit the note
    const noteText = `rls-check ${clientEventId}`;
    const noteUpdate = await caregiver.from("care_events").update({ note: noteText }).eq("id", careEventId).select("id");
    const noteRows = noteUpdate.data?.length ?? 0;
    const noteReread = await service.from("care_events").select("note").eq("id", careEventId).maybeSingle();
    record(
      !noteUpdate.error && noteRows === 1 && noteReread.data?.note === noteText,
      "caregiver can update the note",
      noteUpdate.error ? `error: ${noteUpdate.error.message}` : `${noteRows} rows changed; note ${noteReread.data?.note === noteText ? "matches" : "does not match"}`,
    );
  } finally {
    await cleanup(careEventId);
    const remaining = await service.from("care_events").select("id", { count: "exact", head: true }).eq("id", careEventId);
    console.log(`[rls] cleanup: ${remaining.count ?? "?"} care_events rows remain for ${careEventId}`);
  }

  const failed = results.filter((ok) => !ok).length;
  console.log(`[rls] ${results.length - failed} of ${results.length} checks passed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
