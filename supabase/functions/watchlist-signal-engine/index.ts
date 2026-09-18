/**
 * Watchlist signal engine (spec 25A section 7).
 *
 * Cron triggered. On each tick it evaluates every enabled Watchlist rule at
 * every building in the organization, opens the signals that are newly true,
 * refreshes the ones that still are, closes the ones that stopped being true,
 * and queues the Acute push through `notification_routes`.
 *
 * This file and the modules beside it deliberately contain no threshold, no
 * lookback span, no baseline, no severity, no band boundary, no recipient and
 * no channel. Every one of those is a row in `watchlist_signal_rules`,
 * `watchlist_band_rules` or `notification_routes`, read inside
 * `evaluate_watchlist_signals`. Changing when a resident reads as Acute, or who
 * hears about it, is a row edit.
 *
 * No AI derived number reaches a resident row through this function or any
 * other. The Watchlist carries named signals and a band, and nothing else.
 *
 * A building whose evaluation fails is reported as a failure with HTTP 207, not
 * folded into a cheerful ok, because a Watchlist that quietly stopped looking at
 * a building is worse than one that says it could not.
 *
 * POST body: `{ "organization_id": uuid, "facility_id"?: uuid }`
 * Auth: `x-cron-secret` must equal env `WATCHLIST_SIGNAL_SECRET`.
 *
 * Env (names only, values in Edge Function secrets):
 *   WATCHLIST_SIGNAL_SECRET   required
 *   SUPABASE_URL              required
 *   SUPABASE_SERVICE_ROLE_KEY required
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCorsHeaders, jsonResponse } from "../_shared/cors.ts";
import { withTiming } from "../_shared/structured-log.ts";
import { runWatchlistEngine } from "./engine.ts";
import { supabaseStore } from "./store.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const t = withTiming("watchlist-signal-engine");
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") return new Response("ok", { headers: getCorsHeaders(origin) });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, origin);

  const secret = Deno.env.get("WATCHLIST_SIGNAL_SECRET");
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
    t.log({ event: "config_missing", outcome: "error", error_message: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing" });
    return jsonResponse({ error: "Service configuration missing" }, 503, origin);
  }

  const admin = createClient(url, serviceRoleKey);

  try {
    const result = await runWatchlistEngine({
      store: supabaseStore(admin),
      log: t,
      organizationId,
      facilityId,
    });
    const ok = result.facilities_failed === 0;
    return jsonResponse({ ok, organization_id: organizationId, ...result }, ok ? 200 : 207, origin);
  } catch (error) {
    t.log({
      event: "tick_failed",
      outcome: "error",
      error_message: error instanceof Error ? error.message : "unknown",
    });
    return jsonResponse({ error: "Watchlist tick failed" }, 500, origin);
  }
});
