#!/usr/bin/env node
/**
 * Seed eight "Something happened" events (one per tile) into the Haven Demo
 * Workspace so the Administrator's board, the delivery ledger, and the receipt
 * screens have something to show (spec 07A section 9 item 3 companion).
 *
 * Demo workspace only. The organization is resolved by name
 * (`Haven Demo Workspace`); when it is absent the script prints SKIP and exits 0,
 * and it refuses to run if the resolved organization is the Circle of Life
 * production organization. Each event is submitted through `submit_care_event`
 * as a demo caregiver so the level, routing, and ledger rows are the real ones.
 * Re-runs are idempotent: the `client_event_id` is derived from the fixture
 * case id, and events that already exist are skipped.
 *
 * Env:
 *   SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY   required
 *   SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)                   required (caregiver sign-in)
 *   DEMO_CAREGIVER_PASSWORD                                                default HavenDemo2026!
 *   DEMO_CAREGIVER_EMAIL                                                   optional; otherwise the first caregiver in the workspace
 *
 * Prints ids, kinds, and levels only; never resident names.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import { DEMO, createAdminSupabaseClient, optionalEnv } from "../demo/_config.mjs";

const COL_ORGANIZATION_ID = "00000000-0000-0000-0000-000000000001";
const CLIENT_EVENT_NAMESPACE = "haven:care-events:seed-demo-events:v1";
const PREFIX = "[seed-demo-events]";

const PREFERRED_CASE_IDS = {
  fall: "fall_head_yes_not_hurt",
  injury_found: "injury_bruise_cause_known_first_aid_photo",
  condition_change: "condition_one_sign_today",
  behavior: "behavior_yelling_no_one_over",
  wandering: "wandering_found_grounds_not_hurt",
  medication: "medication_refused_no_reaction_emar",
  family_complaint: "family_mistreated_abuse_allegation",
  environment: "environment_broken_equipment",
};

/** Single-select answer keys per kind (spec 07A-level-engine-contract section 2). */
const SINGLE_SELECT_KEYS = {
  fall: ["hurt", "head", "witnessed", "going_out"],
  injury_found: ["care", "cause_known"],
  condition_change: ["onset"],
  behavior: ["what", "touched", "over"],
  wandering: ["where", "hurt"],
  medication: ["what", "reaction"],
  family_complaint: ["what"],
  environment: ["what", "danger"],
};

const SIGN_IN_ATTEMPTS = 3;
const SIGN_IN_PAUSE_MS = 5_000;

function log(message) {
  console.log(`${PREFIX} ${message}`);
}

function fail(message) {
  console.error(`${PREFIX} ${message}`);
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Deterministic uuid shaped from sha1(namespace + case id), version nibble 5, RFC 4122 variant. */
export function clientEventIdForCase(caseId) {
  const digest = createHash("sha1").update(`${CLIENT_EVENT_NAMESPACE}:${caseId}`).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function loadCases() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const file = path.resolve(here, "../../src/lib/care-events/level-cases.json");
  return JSON.parse(readFileSync(file, "utf8"));
}

function needsNoRaise(candidate) {
  if (candidate.answers?.worried === true) return false;
  const context = candidate.context ?? {};
  return !context.active_watch && !context.elopement_risk && !context.prior_unexplained_bruise_30d;
}

function coversEverySingleSelect(candidate) {
  return (SINGLE_SELECT_KEYS[candidate.kind] ?? []).every((key) => typeof candidate.answers?.[key] === "string");
}

function pickCaseForTile(cases, kind) {
  const preferred = cases.find((candidate) => candidate.id === PREFERRED_CASE_IDS[kind]);
  if (preferred) return preferred;
  const fallback = cases.find((candidate) => candidate.kind === kind && coversEverySingleSelect(candidate) && needsNoRaise(candidate));
  if (!fallback) throw new Error(`level-cases.json has no sendable case for kind ${kind}`);
  return fallback;
}

async function signInCaregiver(email, password) {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) fail("SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) is required to sign in as the demo caregiver.");
  const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  let lastError = null;
  for (let attempt = 1; attempt <= SIGN_IN_ATTEMPTS; attempt += 1) {
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (!error) return client;
    lastError = error;
    console.warn(`${PREFIX} caregiver sign-in attempt ${attempt} of ${SIGN_IN_ATTEMPTS} failed: ${error.message}`);
    if (attempt < SIGN_IN_ATTEMPTS) await sleep(SIGN_IN_PAUSE_MS);
  }
  throw new Error(`caregiver sign-in failed: ${lastError?.message ?? "unknown error"}`);
}

async function main() {
  const admin = createAdminSupabaseClient();

  const org = await admin.from("organizations").select("id, name").eq("name", DEMO.orgName).is("deleted_at", null).maybeSingle();
  if (org.error) fail(`organization lookup failed: ${org.error.message}`);
  if (!org.data) {
    log(`SKIP: ${DEMO.orgName} not found`);
    process.exit(0);
  }
  if (org.data.id === COL_ORGANIZATION_ID) {
    fail(`refusing to seed: ${DEMO.orgName} resolved to the Circle of Life organization ${COL_ORGANIZATION_ID}`);
  }
  const organizationId = org.data.id;
  log(`organization ${organizationId}`);

  // Demo caregiver and their facility.
  let caregiverQuery = admin
    .from("user_profiles")
    .select("id, email")
    .eq("organization_id", organizationId)
    .eq("app_role", "caregiver")
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  const explicitEmail = optionalEnv("DEMO_CAREGIVER_EMAIL");
  if (explicitEmail) caregiverQuery = caregiverQuery.eq("email", explicitEmail);
  const caregiver = await caregiverQuery.limit(1).maybeSingle();
  if (caregiver.error) fail(`caregiver lookup failed: ${caregiver.error.message}`);
  if (!caregiver.data) fail("no caregiver user_profiles row in the demo workspace; run scripts/demo/seed-demo-data.mjs first.");

  const access = await admin
    .from("user_facility_access")
    .select("facility_id, is_primary")
    .eq("user_id", caregiver.data.id)
    .is("revoked_at", null)
    .order("is_primary", { ascending: false });
  if (access.error) fail(`facility access lookup failed: ${access.error.message}`);
  let facilityId = access.data?.[0]?.facility_id ?? null;
  if (!facilityId) {
    const facility = await admin
      .from("facilities")
      .select("id")
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .order("name")
      .limit(1)
      .maybeSingle();
    if (facility.error) fail(`facility lookup failed: ${facility.error.message}`);
    facilityId = facility.data?.id ?? null;
  }
  if (!facilityId) fail("the demo caregiver has no facility.");
  log(`caregiver ${caregiver.data.id} at facility ${facilityId}`);

  const resident = await admin
    .from("residents")
    .select("id")
    .eq("facility_id", facilityId)
    .eq("status", "active")
    .is("deleted_at", null)
    .order("last_name", { ascending: true })
    .order("first_name", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (resident.error) fail(`resident lookup failed: ${resident.error.message}`);
  if (!resident.data) fail(`no active resident at facility ${facilityId}.`);
  const residentId = resident.data.id;
  log(`resident ${residentId}`);

  const password = optionalEnv("DEMO_CAREGIVER_PASSWORD") ?? "HavenDemo2026!";
  const session = await signInCaregiver(caregiver.data.email, password);

  const cases = loadCases();
  const kinds = Object.keys(PREFERRED_CASE_IDS);
  const summary = { created: [], skipped: [], failed: [] };
  const now = Date.now();

  for (const [index, kind] of kinds.entries()) {
    const levelCase = pickCaseForTile(cases, kind);
    const clientEventId = clientEventIdForCase(levelCase.id);

    const existing = await admin
      .from("care_events")
      .select("id, final_level")
      .eq("organization_id", organizationId)
      .eq("client_event_id", clientEventId)
      .maybeSingle();
    if (existing.error) fail(`existence check failed for ${levelCase.id}: ${existing.error.message}`);
    if (existing.data) {
      summary.skipped.push(`${kind} (${levelCase.id}) already ${existing.data.id}`);
      continue;
    }

    // Spread the events over the last day so the board shows a timeline, newest first.
    const occurredAt = new Date(now - (index + 1) * 2 * 60 * 60_000).toISOString();
    const payload = {
      client_event_id: clientEventId,
      facility_id: facilityId,
      resident_id: kind === "environment" ? null : residentId,
      kind,
      answers: { ...levelCase.answers, worried: levelCase.answers?.worried === true },
      note: null,
      occurred_at: occurredAt,
      location_code: null,
      captured_offline: false,
    };
    const result = await session.rpc("submit_care_event", { p_payload: payload });
    if (result.error) {
      summary.failed.push(`${kind} (${levelCase.id}): ${result.error.message}`);
      continue;
    }
    const receipt = result.data ?? {};
    summary.created.push(
      `${kind} (${levelCase.id}) -> ${receipt.care_event_id ?? "?"} level ${receipt.level ?? "?"}${receipt.incident_number ? ` incident ${receipt.incident_number}` : ""}`,
    );
  }

  log(`created ${summary.created.length}, skipped ${summary.skipped.length}, failed ${summary.failed.length}`);
  for (const line of summary.created) log(`created ${line}`);
  for (const line of summary.skipped) log(`skipped ${line}`);
  for (const line of summary.failed) log(`failed ${line}`);
  process.exit(summary.failed.length > 0 ? 1 : 0);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((error) => {
    fail(error instanceof Error ? error.message : String(error));
  });
}
