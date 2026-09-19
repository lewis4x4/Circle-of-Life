/**
 * Observation escalation engine (spec 25A, Smart Rounding escalation).
 *
 * Cron triggered. On each tick it marks tasks whose observation window has
 * closed as overdue, fires every escalation rung that has come due and has not
 * already fired, and drains the deliveries those rungs wrote.
 *
 * This file and the modules beside it deliberately contain no escalation
 * offset, no recipient, no channel, no shift boundary, no grace value and no
 * timer. The ladder lives in `facility_escalation_versions` and
 * `facility_escalation_rungs`, including the per shift overrides and the per
 * rung channels, and it is read through `observation_escalations_due`. The
 * window close every offset is measured from is resolved by
 * `observation_task_window_close` in SQL. Moving tier 1 or muting a channel
 * overnight is a row edit, never a deploy.
 *
 * Every escalation is stamped with the policy version that fired it, so a later
 * policy change cannot rewrite what the ladder was on the day it ran.
 *
 * The nudge is an assigned staff only rung: it is a staff reminder, not an
 * escalation, and it writes no `resident_observation_escalations` row. Its
 * firing is recorded in `observation_escalation_dispatches`, which is also what
 * makes it idempotent.
 *
 * POST body: `{ "organization_id": uuid, "facility_id"?: uuid }`
 * Auth: `x-cron-secret` must equal env `OBSERVATION_ESCALATION_SECRET`.
 *
 * Env (names only, values in Edge Function secrets):
 *   OBSERVATION_ESCALATION_SECRET           required
 *   DISPATCH_PUSH_SECRET                    push channel; missing means push rows skip
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER,
 *   OBSERVATION_ESCALATION_SMS_ENABLED      all four required for sms; otherwise skipped
 *   OBSERVATION_ESCALATION_APP_BASE_URL     optional deep link prefix, default bare path
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCorsHeaders, jsonResponse } from "../_shared/cors.ts";
import { withTiming } from "../_shared/structured-log.ts";
import { type EngineEnv, runEscalationEngine } from "./engine.ts";
import { supabaseStore } from "./store.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ENV_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DISPATCH_PUSH_SECRET",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_FROM_NUMBER",
  "OBSERVATION_ESCALATION_SMS_ENABLED",
  "OBSERVATION_ESCALATION_APP_BASE_URL",
] as const;

function readEnv(): EngineEnv {
  const env: EngineEnv = {};
  for (const key of ENV_KEYS) env[key] = Deno.env.get(key);
  return env;
}

Deno.serve(async (req) => {
  const t = withTiming("observation-escalation-engine");
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") return new Response("ok", { headers: getCorsHeaders(origin) });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, origin);

  const secret = Deno.env.get("OBSERVATION_ESCALATION_SECRET");
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

  const env = readEnv();
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    t.log({ event: "config_missing", outcome: "error", error_message: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing" });
    return jsonResponse({ error: "Service configuration missing" }, 503, origin);
  }

  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  try {
    const result = await runEscalationEngine({
      store: supabaseStore(admin),
      fetchImpl: fetch,
      env,
      log: t,
      organizationId,
      facilityId,
    });
    const ok = result.deliveries_failed + result.rungs_failed + result.delivery_outcomes_failed + result.queue_claims_failed === 0;
    return jsonResponse({ ok, organization_id: organizationId, ...result }, ok ? 200 : 207, origin);
  } catch (error) {
    t.log({
      event: "tick_failed",
      outcome: "error",
      error_message: error instanceof Error ? error.message : "unknown",
    });
    return jsonResponse({ error: "Escalation tick failed" }, 500, origin);
  }
});
