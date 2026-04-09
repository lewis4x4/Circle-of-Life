/**
 * Module 22 — Track D12: minimal HL7 v2 MSH parse for `referral_hl7_inbound` queue rows.
 * Does not create `referral_leads` (deferred per spec).
 *
 * POST JSON: `{ "organization_id"?: uuid, "limit"?: number }` (limit default 50, max 200).
 * Auth: `x-cron-secret` = `PROCESS_REFERRAL_HL7_INBOUND_SECRET`.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { withTiming } from "../_shared/structured-log.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** MSH field separator is the single character at index 3; MSH-9 / MSH-10 are 0-based fields[7] / fields[8] after split. */
export function parseHl7MshMinimal(
  rawMessage: string,
): { ok: true; messageControlId: string | null; triggerEvent: string | null } | { ok: false; error: string } {
  const raw = rawMessage?.trim();
  if (!raw) return { ok: false, error: "empty_raw_message" };

  const normalized = raw.replace(/\r\n/g, "\r").replace(/\n/g, "\r");
  const segments = normalized
    .split("\r")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const msh = segments.find((s) => s.startsWith("MSH"));
  if (!msh) return { ok: false, error: "no_msh_segment" };
  if (msh.length < 8) return { ok: false, error: "msh_segment_too_short" };

  const sep = msh[3];
  if (sep === undefined || sep === "\r" || sep === "\n") {
    return { ok: false, error: "missing_field_separator" };
  }

  const payload = msh.slice(4);
  const fields = payload.split(sep);

  const msh9 = fields[7]?.trim() ?? "";
  const msh10 = fields[8]?.trim() ?? "";

  let triggerEvent: string | null = null;
  if (msh9) {
    const comps = msh9.split("^");
    if (comps.length >= 2 && comps[1]) triggerEvent = comps[1];
    else if (comps[0]) triggerEvent = comps[0];
  }

  const messageControlId = msh10 || null;

  if (!msh9) {
    return { ok: false, error: "msh_missing_message_type" };
  }

  return { ok: true, messageControlId, triggerEvent };
}

Deno.serve(async (req) => {
  const t = withTiming("process-referral-hl7-inbound");

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const secret = Deno.env.get("PROCESS_REFERRAL_HL7_INBOUND_SECRET");
  const headerSecret = req.headers.get("x-cron-secret");
  if (!secret || headerSecret !== secret) {
    t.log({ event: "auth_failed", outcome: "error", error_message: "secret mismatch" });
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey);

  let body: { organization_id?: string; limit?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  const orgId = body.organization_id?.trim();
  if (orgId && !UUID_RE.test(orgId)) {
    return jsonResponse({ error: "organization_id must be a valid uuid" }, 400);
  }

  const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 200);

  let q = admin
    .from("referral_hl7_inbound")
    .select("id, organization_id, facility_id, raw_message, message_control_id")
    .eq("status", "pending")
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (orgId) q = q.eq("organization_id", orgId);

  const { data: rows, error: fetchErr } = await q;
  if (fetchErr) {
    t.log({ event: "fetch_pending_failed", outcome: "error", error_message: fetchErr.message });
    return jsonResponse({ error: fetchErr.message }, 500);
  }

  let processed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const row of rows ?? []) {
    const parsed = parseHl7MshMinimal(row.raw_message);
    if (!parsed.ok) {
      const { error: upErr } = await admin
        .from("referral_hl7_inbound")
        .update({
          status: "failed",
          parse_error: parsed.error,
        })
        .eq("id", row.id);
      if (upErr) errors.push(`${row.id}: ${upErr.message}`);
      failed += 1;
      continue;
    }

    const nextControl = parsed.messageControlId ?? row.message_control_id ?? null;

    const { error: upErr } = await admin
      .from("referral_hl7_inbound")
      .update({
        status: "processed",
        parse_error: null,
        message_control_id: nextControl,
        trigger_event: parsed.triggerEvent,
      })
      .eq("id", row.id);

    if (upErr) {
      const isDup =
        upErr.code === "23505" ||
        /duplicate key|unique constraint/i.test(upErr.message ?? "");
      if (isDup) {
        const { error: failErr } = await admin
          .from("referral_hl7_inbound")
          .update({
            status: "failed",
            parse_error: "duplicate_message_control_id",
          })
          .eq("id", row.id);
        if (failErr) errors.push(`${row.id}: ${failErr.message}`);
      } else {
        errors.push(`${row.id}: ${upErr.message}`);
      }
      failed += 1;
      continue;
    }
    processed += 1;
  }

  const ok = errors.length === 0;
  t.log({
    event: "batch_complete",
    outcome: ok ? "success" : "error",
    examined: rows?.length ?? 0,
    processed,
    failed,
  });

  return jsonResponse({
    ok,
    examined: rows?.length ?? 0,
    processed,
    failed,
    ...(errors.length ? { errors } : {}),
  });
});
