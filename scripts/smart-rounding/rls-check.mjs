#!/usr/bin/env node
/**
 * The Smart Rounding row level security check, spec 25A acceptance 6 and 12.
 *
 * WHY THIS SCRIPT EXISTS
 * ----------------------
 * Nothing else in the 25A build has touched a real database. Every other green
 * check in the module is a replay against a throwaway cluster where
 * `scripts/pg-verify-stub.sql` stands in for Supabase auth, so row level
 * security under real JWT claims, Supabase default privileges and the PostgREST
 * schema cache are not exercised at all. Orchestrator decision D17 records
 * that, and a prior Haven finding is that a `has_table_privilege(...) = false`
 * assertion is a replay only artifact that reads the other way on hosted. This
 * script is the only thing in the module that answers the question for real.
 *
 * It signs in one Supabase client per role against a hosted project and asserts:
 *
 *   acceptance 6   a user holding the Resident Aide role (app_role 'caregiver')
 *                  creates a Monitoring Order and it is active immediately,
 *                  with no pending state anywhere in the model
 *   acceptance 12  a user with access to exactly one facility sees only that
 *                  facility's residents on every one of the five tabs, and the
 *                  resident count matches that facility's active roster
 *
 * plus three things the replay structurally cannot answer:
 *
 *   - anon reads none of the module's tables
 *   - a user at facility A cannot read facility B's cadence, Monitoring Orders
 *     or Watchlist signals
 *   - public.observation_compliance_for_range answers only for the caller's
 *     facilities
 *
 * TARGET
 * ------
 * The target is a flag and never a default.
 *
 *   node scripts/smart-rounding/rls-check.mjs --target=staging
 *   node scripts/smart-rounding/rls-check.mjs --target=<project-ref>
 *
 * `staging` resolves to Haven HFO Staging. Production is refused unless
 * `--i-understand-this-is-production` is also passed, because this script
 * writes a Monitoring Order against a real resident and a real order at a real
 * building is a clinical instruction somebody may act on.
 *
 * CREDENTIALS
 * -----------
 * Environment variables only. Never a default, never a file, never printed.
 *
 *   SMART_ROUNDING_ANON_KEY                the target project's publishable key
 *   SMART_ROUNDING_SERVICE_ROLE_KEY        the target project's service role key
 *   SMART_ROUNDING_CAREGIVER_EMAIL         an account whose app_role is 'caregiver'
 *   SMART_ROUNDING_CAREGIVER_PASSWORD
 *   SMART_ROUNDING_SINGLE_FACILITY_EMAIL   an account with access to exactly one facility
 *   SMART_ROUNDING_SINGLE_FACILITY_PASSWORD
 *   SMART_ROUNDING_OTHER_FACILITY_EMAIL    an account at a different facility
 *   SMART_ROUNDING_OTHER_FACILITY_PASSWORD
 *
 * The caregiver and the single facility account may be the same account.
 *
 * A MISSING CREDENTIAL IS A FAILURE, NEVER A SKIP. This build has already been
 * bitten twice by a silent skip: twenty six Edge Function test files that no
 * gate ran, and a fixture that only exercised the code path which already
 * worked. A verification script that exits 0 because it could not sign in is
 * worse than no script, so this one exits 2 and names every variable it needs.
 *
 * OUTPUT
 * ------
 * Counts and ids only. No resident name, no staff name, no email, no key. The
 * `redact` helper below is the single place anything reaches stdout, and it
 * refuses a value that is not an id, a count or a status word.
 */
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

const PREFIX = "[rls-check]";
const PRODUCTION_REF = "manfqmasfqppukpobpld";
const STAGING_REF = "iwcnajanvjvynolltflw";
const PRODUCTION_FLAG = "--i-understand-this-is-production";

/** Every table spec 25A created. `supabase/tests/review_smart_rounding_authority.sql` holds the same list. */
const MODULE_TABLES = [
  "facility_shift_definitions",
  "facility_cadence_versions",
  "facility_cadence_windows",
  "resident_monitoring_orders",
  "resident_monitoring_order_events",
  "resident_monitoring_order_notifications",
  "facility_escalation_versions",
  "facility_escalation_rungs",
  "facility_escalation_rung_shift_overrides",
  "observation_escalation_dispatches",
  "observation_escalation_deliveries",
  "watchlist_signal_rules",
  "watchlist_band_rules",
  "watchlist_signal_instances",
  "watchlist_signal_dispositions",
  "watchlist_signal_notifications",
  "cadence_templates",
  "cadence_template_versions",
  "cadence_template_windows",
  "escalation_templates",
  "escalation_template_versions",
  "escalation_template_rungs",
  "facility_config_template_bindings",
  "jurisdiction_observation_floors",
  "facility_observation_thresholds",
];

/**
 * The read behind each of the five tabs, by the table or view the surface
 * actually queries. Acceptance 12 is about every tab, so the list is the tab
 * strip rather than a sample of it.
 */
const TAB_SOURCES = [
  { tab: "Live board", relation: "resident_observation_tasks" },
  { tab: "Live board", relation: "resident_observation_escalations" },
  { tab: "Watchlist", relation: "v_watchlist_facility" },
  { tab: "Watchlist", relation: "watchlist_signal_instances" },
  { tab: "Monitoring Orders", relation: "resident_monitoring_orders" },
  { tab: "Integrity", relation: "resident_observation_integrity_flags" },
];

/** Relations a facility A reader must not see a facility B row in. */
const CROSS_FACILITY_RELATIONS = [
  "facility_cadence_versions",
  "facility_cadence_windows",
  "resident_monitoring_orders",
  "watchlist_signal_instances",
  "facility_escalation_versions",
  // Holds the interval presets, the grace formula divisor and the board's
  // display thresholds since migrations 431 and 432, and authenticated holds
  // UPDATE on it. Reaching another building's row means editing what that
  // building's staff are told about a missed check.
  "facility_observation_thresholds",
];

const REQUIRED_ENV = [
  "SMART_ROUNDING_ANON_KEY",
  "SMART_ROUNDING_SERVICE_ROLE_KEY",
  "SMART_ROUNDING_CAREGIVER_EMAIL",
  "SMART_ROUNDING_CAREGIVER_PASSWORD",
  "SMART_ROUNDING_SINGLE_FACILITY_EMAIL",
  "SMART_ROUNDING_SINGLE_FACILITY_PASSWORD",
  "SMART_ROUNDING_OTHER_FACILITY_EMAIL",
  "SMART_ROUNDING_OTHER_FACILITY_PASSWORD",
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The only path to stdout for a value read out of the database.
 *
 * Ids, counts and lower case status words pass through. Anything else becomes
 * its own shape, so a resident name cannot reach a transcript by way of an
 * error message or a column somebody added later.
 */
function redact(value) {
  if (value == null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const text = String(value);
  if (UUID.test(text)) return text;
  if (/^-?\d+(\.\d+)?$/.test(text)) return text;
  if (/^[a-z][a-z0-9_]{0,40}$/.test(text)) return text;
  return `<${text.length} chars redacted>`;
}

/** A PostgREST error, reduced to the code and the constraint, never the row. */
function errorSummary(error) {
  if (!error) return "no error";
  const code = error.code ? String(error.code) : "no code";
  return `${code}`;
}

function parseArgs(argv) {
  let target = null;
  let productionAcknowledged = false;
  for (const argument of argv) {
    if (argument.startsWith("--target=")) target = argument.slice("--target=".length).trim();
    else if (argument === PRODUCTION_FLAG) productionAcknowledged = true;
    else if (argument.startsWith("--")) {
      console.error(`${PREFIX} unknown flag ${argument}`);
      process.exit(2);
    }
  }
  return { target, productionAcknowledged };
}

function resolveTarget(argv) {
  const { target, productionAcknowledged } = parseArgs(argv);
  if (!target) {
    console.error(`${PREFIX} --target is required and has no default.`);
    console.error(`${PREFIX}   --target=staging            Haven HFO Staging (${STAGING_REF})`);
    console.error(`${PREFIX}   --target=<project-ref>      any other project`);
    console.error(`${PREFIX} There is no default target on purpose: this script writes a Monitoring Order.`);
    process.exit(2);
  }
  const ref = target === "staging" ? STAGING_REF : target;
  if (!/^[a-z]{20}$/.test(ref)) {
    console.error(`${PREFIX} "${target}" is not a Supabase project ref or the word staging.`);
    process.exit(2);
  }
  if (ref === PRODUCTION_REF && !productionAcknowledged) {
    console.error(`${PREFIX} REFUSING to run against production (${PRODUCTION_REF}).`);
    console.error(`${PREFIX} This script signs in as a real caregiver and calls create_monitoring_order,`);
    console.error(`${PREFIX} which writes a live clinical instruction and generates observation tasks that`);
    console.error(`${PREFIX} appear on a real board for real staff to work. It also reads production resident`);
    console.error(`${PREFIX} counts. Rehearse on staging first.`);
    console.error(`${PREFIX} If production really is the intended target, pass ${PRODUCTION_FLAG}.`);
    process.exit(2);
  }
  return { ref, isProduction: ref === PRODUCTION_REF };
}

function requireCredentials() {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]?.trim());
  if (missing.length === 0) return;
  console.error(`${PREFIX} FAIL: ${missing.length} of ${REQUIRED_ENV.length} required environment variables are not set.`);
  for (const name of missing) console.error(`${PREFIX}   missing ${name}`);
  console.error(`${PREFIX} This is a failure, not a skip. Row level security under real JWT claims is the`);
  console.error(`${PREFIX} one thing no other check in this module exercises, and a script that exits 0`);
  console.error(`${PREFIX} because it could not sign in reports a green gate over an unverified invariant.`);
  console.error(`${PREFIX} The full set:`);
  for (const name of REQUIRED_ENV) console.error(`${PREFIX}   ${name}`);
  process.exit(2);
}

/**
 * The first interval preset the building offers.
 *
 * `public.monitoring_order_interval_options` is `RETURNS TABLE`, so PostgREST
 * answers it as an array of one row, and that row's `preset_minutes` is an
 * integer array. Both layers of that shape were got wrong here once: the first
 * version of this script indexed `[0]` correctly and then looked for a column
 * called `interval_minutes`, which does not exist, so it read `undefined` and
 * reported the call as having "given no interval". It had answered perfectly.
 *
 * The lesson is the one the Live board taught with `PGRST201`: a failure
 * message that names a cause it did not observe sends the next person to the
 * wrong place. Read the shape, and when the read fails, print the shape.
 */
function firstIntervalPreset(data) {
  const row = Array.isArray(data) ? data[0] : data;
  const presets = row?.preset_minutes;
  if (!Array.isArray(presets) || presets.length === 0) return null;
  const candidate = presets[0];
  return Number.isInteger(candidate) ? candidate : null;
}

/** What came back, structurally, with no value from it. */
function describeShape(data) {
  if (data === null || data === undefined) return String(data);
  if (Array.isArray(data)) {
    if (data.length === 0) return "an empty array";
    const keys = data[0] && typeof data[0] === "object" ? Object.keys(data[0]).join(", ") : typeof data[0];
    return `an array of ${data.length}, first element keys: ${keys}`;
  }
  if (typeof data === "object") return `an object with keys: ${Object.keys(data).join(", ")}`;
  return typeof data;
}

const results = [];
function record(check, ok, detail) {
  results.push({ check, ok, detail });
  console.log(`${PREFIX} ${ok ? "OK  " : "FAIL"} ${check}`);
  if (detail) console.log(`${PREFIX}        ${detail}`);
}

function clientFor(url, key) {
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function signIn(url, anonKey, emailVar, passwordVar) {
  const client = clientFor(url, anonKey);
  const { data, error } = await client.auth.signInWithPassword({
    email: process.env[emailVar].trim(),
    password: process.env[passwordVar],
  });
  if (error) {
    console.error(`${PREFIX} FAIL: sign-in failed for ${emailVar}: ${error.message}`);
    console.error(`${PREFIX} Not a skip. The account named by ${emailVar} must exist on the target project.`);
    process.exit(2);
  }
  return { client, userId: data.user?.id ?? null };
}

/** Facility ids an account can reach, read with the service role so the answer is not itself under test. */
async function accessibleFacilities(admin, userId) {
  const { data, error } = await admin
    .from("user_facility_access")
    .select("facility_id")
    .eq("user_id", userId)
    .is("revoked_at", null);
  if (error) throw new Error(`user_facility_access read failed: ${errorSummary(error)}`);
  return [...new Set((data ?? []).map((row) => row.facility_id))];
}

async function main() {
  const { ref, isProduction } = resolveTarget(process.argv.slice(2));
  requireCredentials();

  const url = `https://${ref}.supabase.co`;
  const anonKey = process.env.SMART_ROUNDING_ANON_KEY.trim();
  const admin = clientFor(url, process.env.SMART_ROUNDING_SERVICE_ROLE_KEY.trim());

  console.log(`${PREFIX} target ${ref}${isProduction ? " (PRODUCTION, acknowledged)" : ""}`);
  console.log(`${PREFIX} output carries ids, counts and status words only`);

  // -------------------------------------------------------------------------
  // anon holds nothing on the module's tables.
  // -------------------------------------------------------------------------
  const anon = clientFor(url, anonKey);
  const anonLeaks = [];
  const anonRefusals = [];
  const anonEmpty = [];
  for (const table of MODULE_TABLES) {
    const { data, error } = await anon.from(table).select("*").limit(1);
    if (error) anonRefusals.push(`${table}:${errorSummary(error)}`);
    else if ((data ?? []).length > 0) anonLeaks.push(table);
    else anonEmpty.push(table);
  }
  record(
    "anon reads none of the module's tables",
    anonLeaks.length === 0,
    `${MODULE_TABLES.length} tables: ${anonRefusals.length} refused the read, ${anonEmpty.length} answered empty, ${anonLeaks.length} returned a row${anonLeaks.length > 0 ? ` (${anonLeaks.join(", ")})` : ""}`,
  );

  // -------------------------------------------------------------------------
  // Acceptance 6: a Resident Aide enters a Monitoring Order and it is active.
  // -------------------------------------------------------------------------
  const caregiver = await signIn(url, anonKey, "SMART_ROUNDING_CAREGIVER_EMAIL", "SMART_ROUNDING_CAREGIVER_PASSWORD");
  const caregiverProfile = await admin
    .from("user_profiles")
    .select("id, app_role, organization_id")
    .eq("id", caregiver.userId)
    .maybeSingle();
  if (caregiverProfile.error || !caregiverProfile.data) {
    console.error(`${PREFIX} FAIL: no user_profiles row for the caregiver account (${errorSummary(caregiverProfile.error)}).`);
    process.exit(2);
  }
  const caregiverRole = caregiverProfile.data.app_role;
  record(
    "the acceptance 6 account holds the Resident Aide role",
    caregiverRole === "caregiver",
    `app_role is ${redact(caregiverRole)}; acceptance 6 is specifically about the lowest role permitted to enter an order, so any other role makes the check meaningless`,
  );
  if (caregiverRole !== "caregiver") {
    console.error(`${PREFIX} FAIL: point SMART_ROUNDING_CAREGIVER_EMAIL at an account whose app_role is caregiver.`);
    process.exit(1);
  }

  // The caregiver's own read finds the resident, which is also the first proof
  // that the read is facility scoped. Ids only, never a name.
  const caregiverFacilities = await accessibleFacilities(admin, caregiver.userId);
  const caregiverResident = await caregiver.client
    .from("residents")
    .select("id, facility_id")
    .eq("status", "active")
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  if (caregiverResident.error || !caregiverResident.data) {
    console.error(`${PREFIX} FAIL: the caregiver's own resident read returned nothing (${errorSummary(caregiverResident.error)}).`);
    console.error(`${PREFIX} Acceptance 6 needs one active resident the caregiver can reach.`);
    process.exit(1);
  }

  const options = await caregiver.client.rpc("monitoring_order_interval_options", {
    p_facility_id: caregiverResident.data.facility_id,
  });
  const intervalMinutes = firstIntervalPreset(options.data);
  if (options.error || intervalMinutes == null) {
    console.error(`${PREFIX} FAIL: could not read an interval preset from monitoring_order_interval_options.`);
    console.error(`${PREFIX} error: ${errorSummary(options.error)}`);
    console.error(`${PREFIX} shape returned: ${describeShape(options.data)}`);
    console.error(`${PREFIX} It returns a table of one row, so the read is data[0].preset_minutes, an integer array.`);
    console.error(`${PREFIX} Since migration 432 that row comes from public.facility_observation_thresholds, so an`);
    console.error(`${PREFIX} empty answer means facility ${redact(caregiverResident.data.facility_id)} has no thresholds row.`);
    process.exit(1);
  }

  const reviewDueAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const created = await caregiver.client.rpc("create_monitoring_order", {
    p_resident_id: caregiverResident.data.id,
    p_interval_minutes: intervalMinutes,
    p_ordered_by_type: "facility_nurse",
    p_ordered_by_name: "Verification run, spec 25A acceptance 6",
    p_order_received_as: "verbal",
    p_reason_category: "change_in_condition",
    p_reason_note: "Automated row level security verification. Cancel on sight.",
    p_review_due_at: reviewDueAt,
  });

  let orderId = typeof created.data === "string" ? created.data : null;
  if (created.error || !orderId) {
    record(
      "acceptance 6: a Resident Aide enters a Monitoring Order",
      false,
      `create_monitoring_order refused the caregiver: ${errorSummary(created.error)}`,
    );
  } else {
    const readBack = await caregiver.client
      .from("resident_monitoring_orders")
      .select("id, facility_id, status, entered_by, starts_at, cancelled_at")
      .eq("id", orderId)
      .maybeSingle();
    const row = readBack.data;
    const activeNow = row?.status === "active" && row?.cancelled_at == null;
    const enteredByCaregiver = row?.entered_by === caregiver.userId;
    record(
      "acceptance 6: a Resident Aide enters a Monitoring Order and it is active immediately",
      Boolean(activeNow && enteredByCaregiver),
      `order ${redact(orderId)} status ${redact(row?.status)}, entered_by is the caregiver ${enteredByCaregiver}, cancelled_at ${redact(row?.cancelled_at)}`,
    );

    // "No pending state" is a claim about the model, not about one row. The
    // status domain is the proof: if the CHECK ever grows a pending value, a
    // later order could sit unworked and this row would still read active.
    const pendingRows = await admin
      .from("resident_monitoring_orders")
      .select("id", { count: "exact", head: true })
      .not("status", "in", "(active,completed,cancelled,expired)");
    record(
      "acceptance 6: the Monitoring Order model has no pending state",
      !pendingRows.error && (pendingRows.count ?? 0) === 0,
      `rows outside the four terminal-or-active statuses: ${redact(pendingRows.count ?? 0)}${pendingRows.error ? ` (read error ${errorSummary(pendingRows.error)})` : ""}`,
    );

    const orderTasks = await admin
      .from("resident_observation_tasks")
      .select("id", { count: "exact", head: true })
      .eq("monitoring_order_id", orderId);
    record(
      "the order generated its own checks, with no approval step in between",
      !orderTasks.error && (orderTasks.count ?? 0) > 0,
      `${redact(orderTasks.count ?? 0)} order tasks stamped with monitoring_order_id ${redact(orderId)}`,
    );
  }

  // -------------------------------------------------------------------------
  // Acceptance 12: one facility, every tab, and the roster count.
  // -------------------------------------------------------------------------
  const single = await signIn(url, anonKey, "SMART_ROUNDING_SINGLE_FACILITY_EMAIL", "SMART_ROUNDING_SINGLE_FACILITY_PASSWORD");
  const singleFacilities = await accessibleFacilities(admin, single.userId);
  record(
    "the acceptance 12 account reaches exactly one facility",
    singleFacilities.length === 1,
    `user_facility_access rows resolve to ${singleFacilities.length} facility id(s)${singleFacilities.length === 1 ? ` (${redact(singleFacilities[0])})` : ""}`,
  );
  if (singleFacilities.length !== 1) {
    console.error(`${PREFIX} FAIL: point SMART_ROUNDING_SINGLE_FACILITY_EMAIL at an account with access to one facility.`);
    process.exit(1);
  }
  const facilityA = singleFacilities[0];

  for (const source of TAB_SOURCES) {
    const { data, error } = await single.client.from(source.relation).select("facility_id").limit(2000);
    if (error) {
      record(`acceptance 12: ${source.tab} (${source.relation}) is facility scoped`, false, `read failed: ${errorSummary(error)}`);
      continue;
    }
    const foreign = (data ?? []).filter((row) => row.facility_id && row.facility_id !== facilityA);
    record(
      `acceptance 12: ${source.tab} (${source.relation}) is facility scoped`,
      foreign.length === 0,
      `${(data ?? []).length} rows read, ${foreign.length} carrying another facility_id`,
    );
  }

  const serviceDate = new Date().toISOString().slice(0, 10);
  const compliance = await single.client.rpc("observation_compliance_for_range", {
    p_facility_id: null,
    p_from: serviceDate,
    p_to: serviceDate,
  });
  if (compliance.error) {
    record("acceptance 12: the compliance read answers only for the caller's facilities", false, `rpc failed: ${errorSummary(compliance.error)}`);
  } else {
    const rows = compliance.data ?? [];
    const facilities = [...new Set(rows.map((row) => row.facility_id))];
    record(
      "acceptance 12: the compliance read answers only for the caller's facilities",
      facilities.every((id) => id === facilityA),
      `${rows.length} compliance rows across ${facilities.length} facility id(s), all the caller's: ${facilities.every((id) => id === facilityA)}`,
    );

    const complianceResidents = new Set(rows.map((row) => row.resident_id));
    const roster = await admin
      .from("residents")
      .select("id", { count: "exact", head: true })
      .eq("facility_id", facilityA)
      .eq("status", "active")
      .is("deleted_at", null);
    const rosterCount = roster.count ?? null;
    record(
      "acceptance 12: the resident count matches the facility's active roster",
      rosterCount != null && complianceResidents.size === rosterCount,
      `compliance covers ${redact(complianceResidents.size)} resident(s); the facility's active roster is ${redact(rosterCount)}. A shortfall means the module is silent about somebody in the building, which is the defect public.observation_compliance_for_range exists to remove`,
    );

    const callerRoster = await single.client
      .from("residents")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .is("deleted_at", null);
    record(
      "acceptance 12: the caller's own roster read sees one facility's worth of residents",
      !callerRoster.error && callerRoster.count === rosterCount,
      `the caller reads ${redact(callerRoster.count ?? 0)} active residents against a roster of ${redact(rosterCount)}${callerRoster.error ? ` (read error ${errorSummary(callerRoster.error)})` : ""}`,
    );
  }

  // -------------------------------------------------------------------------
  // Facility A cannot read facility B.
  // -------------------------------------------------------------------------
  const other = await signIn(url, anonKey, "SMART_ROUNDING_OTHER_FACILITY_EMAIL", "SMART_ROUNDING_OTHER_FACILITY_PASSWORD");
  const otherFacilities = await accessibleFacilities(admin, other.userId);
  const facilityB = otherFacilities.find((id) => id !== facilityA) ?? null;
  record(
    "the cross-facility account reaches a different facility",
    facilityB != null,
    `the second account reaches ${otherFacilities.length} facility id(s); a facility other than ${redact(facilityA)} is required for the isolation checks`,
  );

  if (facilityB) {
    for (const relation of CROSS_FACILITY_RELATIONS) {
      const { data, error } = await single.client.from(relation).select("id, facility_id").eq("facility_id", facilityB).limit(50);
      const leaked = (data ?? []).length;
      record(
        `facility isolation: ${relation} hides facility B from a facility A reader`,
        leaked === 0,
        `${leaked} row(s) returned for facility_id ${redact(facilityB)}${error ? `; the read itself errored ${errorSummary(error)}, which also hides the rows` : ""}`,
      );
    }

    const crossCompliance = await single.client.rpc("observation_compliance_for_range", {
      p_facility_id: facilityB,
      p_from: serviceDate,
      p_to: serviceDate,
    });
    const crossRows = crossCompliance.data ?? [];
    record(
      "facility isolation: the compliance read asked for facility B answers nothing",
      crossRows.length === 0,
      `${crossRows.length} row(s) returned when a facility A reader names facility B${crossCompliance.error ? `; raised ${errorSummary(crossCompliance.error)}` : ""}. The function runs on the caller's authority, so an answer here would mean a facility administrator can read another building's compliance`,
    );
  }

  // -------------------------------------------------------------------------
  // Clean up the order this run wrote. A verification run must not leave a
  // clinical instruction behind for somebody to work.
  // -------------------------------------------------------------------------
  if (orderId) {
    const closedAt = new Date().toISOString();
    const cancelled = await admin
      .from("resident_monitoring_orders")
      .update({ status: "cancelled", cancelled_at: closedAt, cancelled_by: caregiver.userId, cancel_reason: "Automated verification run", deleted_at: closedAt })
      .eq("id", orderId);
    const tasksClosed = await admin
      .from("resident_observation_tasks")
      .update({ deleted_at: closedAt })
      .eq("monitoring_order_id", orderId)
      .is("deleted_at", null);
    record(
      "the verification order and its checks were withdrawn",
      !cancelled.error && !tasksClosed.error,
      `order ${redact(orderId)} cancelled and soft deleted${cancelled.error ? `; order update raised ${errorSummary(cancelled.error)}` : ""}${tasksClosed.error ? `; task update raised ${errorSummary(tasksClosed.error)}` : ""}`,
    );
    if (cancelled.error || tasksClosed.error) {
      console.error(`${PREFIX} A Monitoring Order this run created is still live. Cancel ${orderId} by hand.`);
    }
  }

  // -------------------------------------------------------------------------
  // Table
  // -------------------------------------------------------------------------
  const width = Math.max(...results.map((row) => row.check.length), 5);
  console.log("");
  console.log(`${"check".padEnd(width)}  result  detail`);
  console.log(`${"-".repeat(width)}  ------  ------`);
  for (const row of results) {
    console.log(`${row.check.padEnd(width)}  ${row.ok ? "PASS  " : "FAIL  "}  ${row.detail}`);
  }

  const failures = results.filter((row) => !row.ok);
  console.log("");
  console.log(`${PREFIX} ${results.length - failures.length}/${results.length} checks passed against ${ref}`);
  if (failures.length > 0) {
    console.error(`${PREFIX} FAIL`);
    process.exit(1);
  }
  console.log(`${PREFIX} PASS`);
}

main().catch((cause) => {
  console.error(`${PREFIX} FATAL: ${cause instanceof Error ? cause.message : String(cause)}`);
  process.exit(1);
});
