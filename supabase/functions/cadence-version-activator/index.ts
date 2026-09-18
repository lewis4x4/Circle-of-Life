/**
 * Cadence version activator (spec 25A section 9).
 *
 * Cron triggered. On each tick it puts every scheduled cadence and escalation
 * version whose effective_from has passed into force, closing the outgoing
 * version's effective_to at exactly that instant, and asks the task generator
 * to rebuild the board for any building where pending tasks were cancelled.
 *
 * The whole of that decision lives in
 * `activate_due_scheduled_config_versions`, which goes through
 * `haven.apply_observation_config_activation`, the one function allowed to
 * write an active version. That is deliberate: this file contains no
 * observation time, no grace value, no escalation offset, no recipient, no
 * channel, no shift boundary, no threshold and no lookback span, and it does
 * not restate the timeline invariant either. An activator that carried its own
 * copy of the invariant would be a second place for it to be wrong.
 *
 * Nothing here can put a version in force that an administrator did not
 * already approve. There is no app_role in a cron context, and the
 * authorization happened when a human called `activate_cadence_version` and
 * left the version scheduled with a reason on it.
 *
 * A version that refuses is reported by id with HTTP 207, not folded into a
 * cheerful ok. A scheduled change that silently did not happen leaves staff
 * working yesterday's schedule while the settings surface shows today's.
 *
 * POST body: `{ "organization_id": uuid, "facility_id"?: uuid }`
 * Auth: `x-cron-secret` must equal env `CADENCE_VERSION_ACTIVATOR_SECRET`.
 *
 * Env (names only, values in Edge Function secrets):
 *   CADENCE_VERSION_ACTIVATOR_SECRET   required
 *   SUPABASE_URL                       required
 *   SUPABASE_SERVICE_ROLE_KEY          required
 *   OBSERVATION_TASK_GENERATOR_URL     optional; without it the tick reports
 *                                      that regeneration was not requested
 *   OBSERVATION_TASK_GENERATOR_SECRET  optional, same
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCorsHeaders, jsonResponse } from "../_shared/cors.ts";
import { withTiming } from "../_shared/structured-log.ts";
import { runCadenceVersionActivator } from "./engine.ts";
import { supabaseStore } from "./store.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const t = withTiming("cadence-version-activator");
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") return new Response("ok", { headers: getCorsHeaders(origin) });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, origin);

  const secret = Deno.env.get("CADENCE_VERSION_ACTIVATOR_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    t.log({ event: "auth_failed", outcome: "error", error_message: "secret mismatch" });
    return jsonResponse({ error: "Unauthorized" }, 401, origin);
  }

  let body: { organization_id?: string; facility_id?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400, origin);
  }

  const organizationId = body.organization_id?.trim();
  if (!organizationId || !UUID_RE.test(organizationId)) {
    return jsonResponse({ error: "organization_id (uuid) is required" }, 400, origin);
  }
  const facilityId = body.facility_id?.trim() || null;
  if (facilityId && !UUID_RE.test(facilityId)) {
    return jsonResponse({ error: "facility_id must be a uuid" }, 400, origin);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) {
    t.log({
      event: "config_missing",
      outcome: "error",
      error_message: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing",
    });
    return jsonResponse({ error: "Service configuration missing" }, 503, origin);
  }

  const admin = createClient(url, serviceRoleKey);
  const store = supabaseStore(admin, {
    url: Deno.env.get("OBSERVATION_TASK_GENERATOR_URL") ?? null,
    secret: Deno.env.get("OBSERVATION_TASK_GENERATOR_SECRET") ?? null,
  });

  try {
    const result = await runCadenceVersionActivator({
      store,
      log: t,
      organizationId,
      facilityId,
    });
    const ok = result.versions_failed === 0;
    return jsonResponse({ ok, organization_id: organizationId, ...result }, ok ? 200 : 207, origin);
  } catch (error) {
    t.log({
      event: "tick_failed",
      outcome: "error",
      error_message: error instanceof Error ? error.message : "unknown",
    });
    return jsonResponse({ error: "Cadence version activation tick failed" }, 500, origin);
  }
});
