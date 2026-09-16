import { type Page, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import levelCases from "../../src/lib/care-events/level-cases.json";
import type { CareEventKind } from "../../src/lib/care-events/level-engine";
import { careEventTileByKind } from "../../src/lib/care-events/tiles";

/**
 * Helpers for the "Something happened" three-tap Playwright project
 * (spec 07A section 9 items 3 and 7). Every Supabase value comes from the
 * environment so the run can be pointed at a local stack; nothing here reads
 * `.env.local`.
 */

export const HOMEWOOD_FACILITY_ID =
  process.env.HOMEWOOD_FACILITY_ID ?? "00000000-0000-0000-0002-000000000003";

export const CAREGIVER = {
  // No default: the old @circleoflifealf.com persona was retired 2026-09-16.
  email: process.env.CARE_EVENT_CAREGIVER_EMAIL ?? "",
  userId: process.env.CARE_EVENT_CAREGIVER_USER_ID ?? "a0000000-0000-0000-0000-000000000004",
} as const;

const PASSWORD =
  process.env.CARE_EVENT_PASSWORD ??
  process.env.HOMEWOOD_LAUNCH_PASSWORD ??
  process.env.PHASE1_DEMO_PASSWORD ??
  "HavenDemo2026!";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const SIGN_IN_ATTEMPTS = 3;
const SIGN_IN_PAUSE_MS = 5_000;

/** The caregiver shift header stores its working facility under this session key. */
export const workingFacilityKey = (userId: string) => `haven:working-facility:${userId}`;

export function adminClient(): SupabaseClient {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY must be set for the care-events project.",
    );
  }
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sign in through the `/login` form. The local GoTrue on a memory-starved
 * host sometimes answers "Processing this request timed out" on the first
 * attempt, so the form is retried with a pause between attempts.
 */
export async function signInWithRetry(page: Page, email: string, password = PASSWORD): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= SIGN_IN_ATTEMPTS; attempt += 1) {
    try {
      await page.goto("/login");
      await page.getByLabel(/work email|email/i).fill(email);
      await page.getByLabel(/^password/i).fill(password);
      const submit = page.getByRole("button", { name: /sign in|log in/i });
      await submit.click();
      // Either the app leaves /login, or the form settles back into an error state
      // (GoTrue answered 504 and the button is enabled again). Poll rather than
      // wait the full navigation timeout on a failed attempt.
      const started = Date.now();
      const deadline = started + 45_000;
      let settledOnError = false;
      while (Date.now() < deadline) {
        if (!new URL(page.url()).pathname.startsWith("/login")) return;
        const busy = await page
          .getByRole("button", { name: /verifying|signing in/i })
          .count()
          .catch(() => 0);
        if (busy === 0 && Date.now() - started > 3_000) {
          settledOnError = true;
          break;
        }
        await sleep(500);
      }
      throw new Error(settledOnError ? "The login form settled without leaving /login." : "Sign-in did not leave /login in time.");
    } catch (error) {
      lastError = error;
      // eslint-disable-next-line no-console
      console.warn(
        `[care-events] sign-in attempt ${attempt} of ${SIGN_IN_ATTEMPTS} failed (${error instanceof Error ? error.message : String(error)}); retrying`,
      );
      await sleep(SIGN_IN_PAUSE_MS);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Sign-in failed after retries.");
}

/** Pick the working facility the way the shift header does (session preference, re-authorized server side). */
export async function setWorkingFacility(page: Page, userId: string, facilityId: string): Promise<void> {
  await page.evaluate(
    ([key, value]) => {
      window.sessionStorage.setItem(key, value);
    },
    [workingFacilityKey(userId), facilityId] as const,
  );
}

// ---------------------------------------------------------------------------
// Fixture cases
// ---------------------------------------------------------------------------

export type LevelCase = {
  id: string;
  kind: CareEventKind;
  answers: Record<string, string | string[] | boolean>;
  context: {
    location_label?: string | null;
    time_label?: string | null;
    active_watch?: boolean;
    elopement_risk?: boolean;
    prior_unexplained_bruise_30d?: boolean;
  };
  expect: {
    level: 1 | 2 | 3 | 4;
    derived_level: 1 | 2 | 3 | 4;
    category: string;
    flags: Record<string, boolean>;
    sentence: string;
  };
};

const CASES = levelCases as unknown as LevelCase[];

/**
 * One representative case per tile. Ids first; when an id is missing from the
 * fixture, the first case of that kind whose answers cover every single-select
 * question and that relies on neither the reporter bump nor resident context
 * (the seeded residents carry no active watch, elopement risk, or prior bruise).
 */
const PREFERRED_CASE_IDS: Record<CareEventKind, string> = {
  fall: "fall_head_yes_not_hurt",
  injury_found: "injury_bruise_cause_known_first_aid_photo",
  condition_change: "condition_chest_pain_alone",
  behavior: "behavior_yelling_no_one_over",
  wandering: "wandering_found_grounds_not_hurt",
  medication: "medication_refused_no_reaction_emar",
  family_complaint: "family_mistreated_abuse_allegation",
  environment: "environment_broken_equipment",
};

function coversEverySingleSelect(candidate: LevelCase): boolean {
  const tile = careEventTileByKind(candidate.kind);
  return tile.questions.every((question) => {
    if (question.multi) return true;
    const value = candidate.answers[question.key];
    return typeof value === "string" && question.options.some((option) => option.value === value);
  });
}

function needsNoRaise(candidate: LevelCase): boolean {
  if (candidate.answers.worried === true) return false;
  const context = candidate.context ?? {};
  return !context.active_watch && !context.elopement_risk && !context.prior_unexplained_bruise_30d;
}

export function pickCaseForTile(kind: CareEventKind): LevelCase {
  const preferred = CASES.find((candidate) => candidate.id === PREFERRED_CASE_IDS[kind]);
  if (preferred) return preferred;
  const fallback = CASES.find(
    (candidate) => candidate.kind === kind && coversEverySingleSelect(candidate) && needsNoRaise(candidate),
  );
  if (!fallback) throw new Error(`level-cases.json has no walkable case for kind ${kind}`);
  return fallback;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

type CareEventRow = {
  id: string;
  incident_id: string | null;
  condition_change_id: string | null;
  behavioral_log_id: string | null;
};

function warn(step: string, error: { message?: string } | null | undefined): void {
  if (!error) return;
  // eslint-disable-next-line no-console
  console.warn(`[care-events] cleanup ${step} failed: ${error.message ?? "unknown error"}`);
}

/**
 * Hard-delete everything a test run created through `submit_care_event`,
 * in dependency order, through the service role. Logs and continues on
 * any error so one stuck table never hides the rest of the cleanup.
 */
export async function cleanupCareEventsForUser(userId: string, sinceIso: string): Promise<void> {
  const supa = adminClient();
  const events = await supa
    .from("care_events")
    .select("id, incident_id, condition_change_id, behavioral_log_id")
    .eq("reported_by", userId)
    .gte("created_at", sinceIso);
  warn("select care_events", events.error);
  const rows = (events.data ?? []) as CareEventRow[];
  if (rows.length === 0) return;

  const eventIds = rows.map((row) => row.id);
  const incidentIds = rows.map((row) => row.incident_id).filter((id): id is string => Boolean(id));
  const conditionIds = rows.map((row) => row.condition_change_id).filter((id): id is string => Boolean(id));
  const behaviorIds = rows.map((row) => row.behavioral_log_id).filter((id): id is string => Boolean(id));
  const sourceIds = [...incidentIds, ...eventIds];

  warn("care_event_deliveries", (await supa.from("care_event_deliveries").delete().in("care_event_id", eventIds)).error);

  if (incidentIds.length > 0) {
    warn("incident_followups", (await supa.from("incident_followups").delete().in("incident_id", incidentIds)).error);
    warn(
      "regulatory_reporting_obligations",
      (await supa.from("regulatory_reporting_obligations").delete().in("incident_id", incidentIds)).error,
    );
    warn("incident_photos", (await supa.from("incident_photos").delete().in("incident_id", incidentIds)).error);
  }

  warn(
    "care_plan_review_alerts",
    (await supa.from("care_plan_review_alerts").delete().in("trigger_source_id", sourceIds)).error,
  );

  const watches = await supa.from("resident_watch_instances").select("id").in("triggered_by_id", sourceIds);
  warn("select resident_watch_instances", watches.error);
  const watchIds = ((watches.data ?? []) as { id: string }[]).map((row) => row.id);
  if (watchIds.length > 0) {
    warn("resident_watch_events", (await supa.from("resident_watch_events").delete().in("watch_instance_id", watchIds)).error);
    warn("resident_watch_instances", (await supa.from("resident_watch_instances").delete().in("id", watchIds)).error);
  }

  for (const eventId of eventIds) {
    warn("exec_alerts", (await supa.from("exec_alerts").delete().like("deep_link_path", `/admin/care-events/${eventId}%`)).error);
  }

  // care_events references condition_changes and behavioral_logs, so it goes first.
  warn("care_events", (await supa.from("care_events").delete().in("id", eventIds)).error);
  if (conditionIds.length > 0) {
    warn("condition_changes", (await supa.from("condition_changes").delete().in("id", conditionIds)).error);
  }
  if (behaviorIds.length > 0) {
    warn("behavioral_logs", (await supa.from("behavioral_logs").delete().in("id", behaviorIds)).error);
  }
  if (incidentIds.length > 0) {
    warn("incidents", (await supa.from("incidents").delete().in("id", incidentIds)).error);
  }
}

export const HOMEWOOD = {
  facilityId: HOMEWOOD_FACILITY_ID,
  baseUrl: process.env.BASE_URL ?? "http://127.0.0.1:4310",
};

export { test, expect } from "@playwright/test";
