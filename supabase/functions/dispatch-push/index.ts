/**
 * Sends a Web Push notification to all active notification_subscriptions for a user (or users in org).
 *
 * Security:
 * - `Authorization: Bearer <jwt>` — caller must be owner or org_admin in the same org as target user.
 * - OR `x-dispatch-secret` must equal env DISPATCH_PUSH_SECRET (for trusted server/cron callers).
 *
 * POST { "user_id": "<uuid>", "title": "...", "body": "...", "url"?: "..." }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import webpush from "npm:web-push@3.6.7";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { withTiming } from "../_shared/structured-log.ts";

Deno.serve(async (req) => {
  const t = withTiming("dispatch-push");

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  let body: {
    user_id?: string;
    title?: string;
    body?: string;
    url?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const targetUserId = body.user_id;
  const title = body.title;
  const text = body.body;
  if (!targetUserId || !title || !text) {
    return jsonResponse(
      { error: "user_id, title, and body are required" },
      400,
    );
  }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(targetUserId)) {
    return jsonResponse({ error: "user_id must be a UUID" }, 400);
  }

  const cronSecret = Deno.env.get("DISPATCH_PUSH_SECRET");
  const headerSecret = req.headers.get("x-dispatch-secret");
  const admin = createClient(supabaseUrl, serviceKey);

  let authorized = false;

  if (cronSecret && headerSecret === cronSecret) {
    authorized = true;
  } else {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user) {
      return jsonResponse({ error: "Invalid session" }, 401);
    }

    const { data: caller, error: pErr } = await userClient
      .from("user_profiles")
      .select("organization_id, app_role")
      .eq("id", user.id)
      .maybeSingle();

    if (pErr || !caller?.organization_id) {
      return jsonResponse({ error: "Profile not found" }, 403);
    }
    if (!["owner", "org_admin"].includes(caller.app_role)) {
      return jsonResponse({ error: "Forbidden" }, 403);
    }

    const { data: target, error: tErr } = await admin
      .from("user_profiles")
      .select("organization_id")
      .eq("id", targetUserId)
      .maybeSingle();

    if (tErr || !target) {
      return jsonResponse({ error: "Target user not found" }, 404);
    }
    if (target.organization_id !== caller.organization_id) {
      return jsonResponse({ error: "Cross-org not allowed" }, 403);
    }
    authorized = true;
  }

  if (!authorized) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const vapidSubject = Deno.env.get("VAPID_SUBJECT");
  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");

  if (!vapidSubject || !vapidPublic || !vapidPrivate) {
    return jsonResponse(
      {
        error:
          "VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY must be set as Edge Function secrets",
      },
      503,
    );
  }

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  const { data: subs, error: sErr } = await admin
    .from("notification_subscriptions")
    .select("id, endpoint, keys_json")
    .eq("user_id", targetUserId)
    .is("deleted_at", null);

  if (sErr) {
    t.log({ event: "error", outcome: "error", error_message: "Could not load subscriptions", error_code: sErr.code });
    return jsonResponse({ error: "Could not load subscriptions" }, 500);
  }

  const payload = JSON.stringify({
    title,
    body: text,
    url: body.url ?? "/",
  });

  const results: { id: string; ok: boolean; error?: string }[] = [];

  for (const sub of subs ?? []) {
    const keys = sub.keys_json as { p256dh?: string; auth?: string };
    if (!keys?.p256dh || !keys?.auth) {
      results.push({ id: sub.id, ok: false, error: "missing keys" });
      continue;
    }
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: {
            p256dh: keys.p256dh,
            auth: keys.auth,
          },
        },
        payload,
        { TTL: 3600 },
      );
      await admin
        .from("notification_subscriptions")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", sub.id);
      results.push({ id: sub.id, ok: true });
    } catch (e) {
      t.log({ event: "send_failed", outcome: "error", subscription_id: sub.id, error_message: e instanceof Error ? e.message : String(e) });
      results.push({ id: sub.id, ok: false, error: "send_failed" });
    }
  }

  const sent = results.filter((r) => r.ok).length;
  const failedCount = results.filter((r) => !r.ok).length;
  t.log({ event: "complete", outcome: failedCount === 0 ? "success" : "error", sent, failed: failedCount, user_id: targetUserId });

  return jsonResponse({ sent, failed: failedCount, results });
});
