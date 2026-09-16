/**
 * care-event-dispatcher: cron every minute (spec 07A section 6.2).
 *
 * Drains care_event_deliveries where status = 'queued' and send_after <= now()
 * and sends each row over its channel: in_app (mark sent), push (dispatch-push
 * with x-dispatch-secret), sms and voice (Twilio, only when enabled). See
 * handler.ts for the rules and message.ts for the PHI boundary.
 *
 * Auth: x-cron-secret == CARE_EVENT_DISPATCHER_SECRET. Gateway JWT
 * verification is off; the function itself is the auth boundary.
 *
 * Env (names only, values in Edge Function secrets):
 *   CARE_EVENT_DISPATCHER_SECRET   required
 *   DISPATCH_PUSH_SECRET           push channel; missing -> push rows skipped
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, CARE_EVENT_SMS_ENABLED
 *                                  all four required for sms and voice; otherwise skipped
 *   CARE_EVENT_APP_BASE_URL        optional; prefix for the deep link, default empty (bare path)
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCorsHeaders, jsonResponse } from "../_shared/cors.ts";
import { withTiming } from "../_shared/structured-log.ts";
import { type DispatcherEnv, runDispatcher } from "./handler.ts";
import { supabaseStore } from "./store.ts";

const ENV_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DISPATCH_PUSH_SECRET",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_FROM_NUMBER",
  "CARE_EVENT_SMS_ENABLED",
  "CARE_EVENT_APP_BASE_URL",
] as const;

function readEnv(): DispatcherEnv {
  const env: DispatcherEnv = {};
  for (const key of ENV_KEYS) env[key] = Deno.env.get(key);
  return env;
}

Deno.serve(async (req) => {
  const t = withTiming("care-event-dispatcher");
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCorsHeaders(origin) });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, origin);

  const secret = Deno.env.get("CARE_EVENT_DISPATCHER_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    t.log({ event: "auth_failed", outcome: "error", error_message: "secret mismatch" });
    return jsonResponse({ error: "Unauthorized" }, 401, origin);
  }

  const env = readEnv();
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    t.log({ event: "config_missing", outcome: "error", error_message: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing" });
    return jsonResponse({ error: "Service configuration missing" }, 503, origin);
  }

  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  try {
    const result = await runDispatcher({
      store: supabaseStore(admin),
      fetchImpl: fetch,
      env,
      log: t,
    });
    return jsonResponse({ ...result }, 200, origin);
  } catch (error) {
    t.log({
      event: "drain_failed",
      outcome: "error",
      error_message: error instanceof Error ? error.message : "unknown",
    });
    return jsonResponse({ error: "Dispatcher failed" }, 500, origin);
  }
});
