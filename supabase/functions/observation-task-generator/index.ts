/**
 * Observation task generator (spec 25A, Smart Rounding cadence).
 *
 * Cron triggered. Repairs open windows in the current shift and generates one
 * shift ahead, so cadence activations cannot leave the current board empty.
 *
 * This file deliberately contains no observation time, no grace value and no
 * shift boundary. The cadence in force, the shift model and all window
 * arithmetic live in facility configuration and are read through
 * `facility_current_and_next_shift_observation_windows`, which resolves them against the
 * facility timezone. Changing a window time is a configuration change here,
 * never a deploy.
 *
 * Every task is stamped with the cadence version that produced it, so a later
 * cadence change cannot rewrite a past compliance number.
 *
 * Monitoring Order suppression is per window, not per resident. A resident under
 * an order loses exactly the standard windows the order's interval covers and
 * keeps the rest, resolved by `observation_windows_under_monitoring_order`, and
 * gets their order tasks from `generate_monitoring_order_tasks` in the same
 * tick, so one cron entry covers both kinds. Asking "is an order in force right
 * now?" once per resident was wrong in both directions: an order starting later
 * today read as not in force and the resident got standard tasks across the
 * order's hours as well as order tasks, and an order ending three hours into a
 * twelve hour shift suppressed the whole shift and left the resident with no
 * task of any kind until the next tick.
 *
 * Every generated task gets an owner the floor can actually be, resolved by
 * `resolve_observation_task_assignees`: the resident split where one exists,
 * otherwise a staff member scheduled for that shift, chosen by a stable hash so
 * a re-run does not reshuffle the board. Where nobody is scheduled no assignee
 * is invented. The tasks are still generated, so the gap is counted rather than
 * hidden, and the shift is raised as a visible defect through
 * `record_observation_staffing_gap` and reported here by facility, shift and
 * service date.
 *
 * Where the building runs the timeclock and nobody is scheduled (COL-693), the
 * staff on the clock own the checks of the shift in progress, by the same
 * stable hash. The incoming shift's checks are written unowned
 * (`awaiting_clock_in`, not a gap) and every run hands still-unowned, not yet
 * due checks of the shift in progress to on-clock staff through
 * `assign_unowned_observation_tasks`; the count is `tasks_assigned_on_clock`.
 * Checks that already have an owner never change hands.
 *
 * The response is a per facility outcome, not a total. A facility that threw, a
 * facility that has no cadence in force and therefore generated nothing, and a
 * facility whose shift has nobody on the schedule are all reported by id and all
 * make `ok` false with a non 200 status. A run that silently logged a per
 * facility exception and still answered `ok: true` told a cron monitor that a
 * building which generated zero tasks was healthy, and a run that generated a
 * full board no caregiver could work would have read the same way.
 *
 * POST body: `{ "organization_id": uuid, "facility_id"?: uuid }`
 * Auth: `x-cron-secret` must equal env `OBSERVATION_TASK_GENERATOR_SECRET`.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCorsHeaders, jsonResponse } from "../_shared/cors.ts";
import { withTiming } from "../_shared/structured-log.ts";
import { FacilitiesQueryError, runObservationTaskGenerator } from "./engine.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const t = withTiming("observation-task-generator");
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") return new Response("ok", { headers: getCorsHeaders(origin) });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, origin);

  const secret = Deno.env.get("OBSERVATION_TASK_GENERATOR_SECRET");
  const headerSecret = req.headers.get("x-cron-secret");
  if (!secret || headerSecret !== secret) {
    t.log({ event: "auth_failed", outcome: "error", error_message: "secret mismatch" });
    return jsonResponse({ error: "Unauthorized" }, 401, origin);
  }

  let body: { organization_id?: string; facility_id?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  const orgId = body.organization_id;
  if (!orgId || !UUID_RE.test(orgId)) {
    return jsonResponse({ error: "organization_id required" }, 400, origin);
  }
  const scopedFacilityId = body.facility_id;
  if (scopedFacilityId && !UUID_RE.test(scopedFacilityId)) {
    return jsonResponse({ error: "facility_id must be a uuid" }, 400, origin);
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const summary = await runObservationTaskGenerator({
      admin,
      organizationId: orgId,
      facilityId: scopedFacilityId ?? null,
      atIso: new Date().toISOString(),
      log: t,
    });
    const { ok, ...counts } = summary;
    return jsonResponse(
      { ok, organization_id: orgId, ...counts },
      // 207 rather than 500: some buildings did generate, and a monitor that
      // retries a 500 would regenerate for them. `ok` is the field to alert on.
      ok ? 200 : 207,
      origin,
    );
  } catch (caught) {
    if (caught instanceof FacilitiesQueryError) return jsonResponse({ error: "Query failed" }, 500, origin);
    throw caught;
  }
});
