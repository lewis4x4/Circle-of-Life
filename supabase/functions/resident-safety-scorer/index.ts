/**
 * Resident Safety Scorer — daily composite 0-100 safety score per resident.
 * Inserts `resident_safety_scores` rows; fires `exec_alerts` on downward tier transitions.
 * POST body: { organization_id: uuid, facility_id?: uuid }
 * Auth: x-cron-secret == RESIDENT_SAFETY_SCORER_SECRET
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCorsHeaders, jsonResponse } from "../_shared/cors.ts";
import { withTiming } from "../_shared/structured-log.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type RiskTier = "low" | "moderate" | "high" | "critical";
const TIER_ORD: Record<RiskTier, number> = { low: 0, moderate: 1, high: 2, critical: 3 };
function tier(s: number): RiskTier {
  return s >= 80 ? "low" : s >= 60 ? "moderate" : s >= 40 ? "high" : "critical";
}
// deno-lint-ignore no-explicit-any
type SB = ReturnType<typeof createClient<any>>;

async function obsScore(sb: SB, rid: string, since: string): Promise<number> {
  const { data } = await sb.from("resident_observation_tasks").select("status")
    .eq("resident_id", rid).gte("scheduled_for", since).is("deleted_at", null);
  if (!data?.length) return 100;
  const done = data.filter((r: { status: string }) =>
    r.status === "completed" || r.status === "completed_late").length;
  return Math.round((done / data.length) * 100);
}

async function excScore(sb: SB, rid: string, since: string): Promise<number> {
  const { data } = await sb.from("resident_observation_exceptions").select("severity")
    .eq("resident_id", rid).gte("created_at", since).is("deleted_at", null);
  if (!data?.length) return 100;
  const W: Record<string, number> = { low: 1, medium: 3, high: 7, critical: 15 };
  const pen = data.reduce((s: number, r: { severity: string }) => s + (W[r.severity] ?? 0), 0);
  return Math.max(0, 100 - pen);
}

async function incScore(sb: SB, rid: string, now: Date): Promise<number> {
  const d30 = new Date(now); d30.setDate(d30.getDate() - 30);
  const d14 = new Date(now); d14.setDate(d14.getDate() - 14);
  const d7 = new Date(now); d7.setDate(d7.getDate() - 7);
  const { data } = await sb.from("incidents").select("reported_at")
    .eq("resident_id", rid).gte("reported_at", d30.toISOString()).is("deleted_at", null);
  if (!data?.length) return 100;
  let pen = 0;
  for (const r of data as { reported_at: string }[]) {
    const t = new Date(r.reported_at);
    pen += t >= d7 ? 40 : t >= d14 ? 20 : 10;
  }
  return Math.max(0, 100 - pen);
}

async function asrScore(sb: SB, rid: string): Promise<number> {
  const { data } = await sb.from("assessments").select("assessment_type, normalized_score")
    .eq("resident_id", rid).is("deleted_at", null).order("assessed_at", { ascending: false });
  if (!data?.length) return 70;
  const byType = new Map<string, number>();
  for (const r of data as { assessment_type: string; normalized_score: number | null }[]) {
    if (r.normalized_score != null && !byType.has(r.assessment_type))
      byType.set(r.assessment_type, r.normalized_score);
  }
  if (!byType.size) return 70;
  const avg = [...byType.values()].reduce((a, b) => a + b, 0) / byType.size;
  return Math.round(Math.min(100, Math.max(0, avg)));
}

async function medScore(sb: SB, rid: string, since: string): Promise<number> {
  const { data } = await sb.from("emar_records").select("status")
    .eq("resident_id", rid).gte("administered_at", since).is("deleted_at", null);
  if (!data?.length) return 100;
  const given = data.filter((r: { status: string }) => r.status === "given").length;
  const rel = data.filter((r: { status: string }) =>
    ["given", "refused", "missed"].includes(r.status)).length;
  return rel === 0 ? 100 : Math.round((given / rel) * 100);
}

// ── Handler ──

Deno.serve(async (req) => {
  const t = withTiming("resident-safety-scorer");
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCorsHeaders(origin) });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, origin);

  const secret = Deno.env.get("RESIDENT_SAFETY_SCORER_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    t.log({ event: "auth_failed", outcome: "error", error_message: "secret mismatch" });
    return jsonResponse({ error: "Unauthorized" }, 401, origin);
  }

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let body: { organization_id?: string; facility_id?: string };
  try { body = (await req.json()) as typeof body; } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400, origin);
  }
  const orgId = body.organization_id?.trim();
  if (!orgId || !UUID_RE.test(orgId))
    return jsonResponse({ error: "organization_id (uuid) is required" }, 400, origin);
  const facId = body.facility_id?.trim();
  if (facId && !UUID_RE.test(facId))
    return jsonResponse({ error: "facility_id must be a valid uuid" }, 400, origin);

  // Load active residents
  let q = sb.from("residents").select("id, facility_id, first_name, last_name")
    .eq("organization_id", orgId).eq("status", "active").is("deleted_at", null);
  if (facId) q = q.eq("facility_id", facId);
  const { data: residents, error: resErr } = await q;
  if (resErr) {
    t.log({ event: "residents_load_failed", outcome: "error", error_message: resErr.message });
    return jsonResponse({ error: "Failed to load residents" }, 500, origin);
  }

  const now = new Date();
  const s30 = new Date(now.getTime() - 30 * 864e5).toISOString();
  const s7 = new Date(now.getTime() - 7 * 864e5).toISOString();
  const dist: Record<RiskTier, number> = { low: 0, moderate: 0, high: 0, critical: 0 };
  type Res = { id: string; facility_id: string; first_name: string; last_name: string };

  for (const res of (residents ?? []) as Res[]) {
    const [obs, exc, inc, asr, med] = await Promise.all([
      obsScore(sb, res.id, s30), excScore(sb, res.id, s30),
      incScore(sb, res.id, now), asrScore(sb, res.id), medScore(sb, res.id, s7),
    ]);
    const score = Math.round(obs * 0.25 + exc * 0.15 + inc * 0.25 + asr * 0.20 + med * 0.15);
    const rTier = tier(score);
    dist[rTier]++;

    const { data: prev } = await sb.from("resident_safety_scores")
      .select("score, risk_tier").eq("resident_id", res.id)
      .order("computed_at", { ascending: false }).limit(1).maybeSingle();
    const pScore = (prev as { score: number } | null)?.score ?? null;
    const pTier = (prev as { risk_tier: RiskTier } | null)?.risk_tier ?? null;

    await sb.from("resident_safety_scores").insert({
      organization_id: orgId, facility_id: res.facility_id, resident_id: res.id,
      score, risk_tier: rTier,
      component_scores: { observation_compliance: obs, exception_severity: exc,
        incident_recency: inc, assessment_risk: asr, medication_adherence: med },
      previous_score: pScore, score_delta: pScore != null ? score - pScore : null,
      computed_at: now.toISOString(),
    });

    // Alert on downward tier transition
    if (pTier && TIER_ORD[rTier] > TIER_ORD[pTier]) {
      const resRef = res.id.slice(0, 8); // Use ID fragment only — never expose resident names in alerts
      const sev = rTier === "critical" ? "critical" : rTier === "high" ? "warning" : null;
      const title = rTier === "critical"
        ? `Resident safety score is CRITICAL \u2014 resident ${resRef}`
        : rTier === "high" ? `Resident safety score declined to HIGH \u2014 resident ${resRef}` : null;
      if (sev && title) {
        const { data: dup } = await sb.from("exec_alerts").select("id")
          .eq("organization_id", orgId).eq("title", title)
          .is("resolved_at", null).is("deleted_at", null).maybeSingle();
        if (!dup) {
          await sb.from("exec_alerts").insert({
            organization_id: orgId, facility_id: res.facility_id,
            source_module: "resident_assurance", severity: sev, title,
            body: `Safety score dropped from ${pScore ?? "N/A"} (${pTier}) to ${score} (${rTier}).`,
          });
        }
      }
    }
  }

  t.log({ event: "complete", outcome: "success",
    residents_scored: residents?.length ?? 0, tier_distribution: dist });
  return jsonResponse({ ok: true, residents_scored: residents?.length ?? 0,
    tier_distribution: dist }, 200, origin);
});
