/**
 * Resident Assurance AI — cron-triggered clinical pattern analysis.
 * Uses Claude (haiku) to analyze 7-day clinical data per resident and detect
 * early warning signs. Inserts into `resident_safety_insights` and creates
 * `exec_alerts` for high/critical patterns.
 *
 * POST body: { organization_id: uuid, facility_id?: uuid, max_residents?: number }
 * Auth: x-cron-secret header matching RESIDENT_ASSURANCE_AI_SECRET.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCorsHeaders, jsonResponse } from "../_shared/cors.ts";
import { withTiming } from "../_shared/structured-log.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODEL = "claude-haiku-4-5-20251001";
const MAX_CAP = 50;
const VALID_SEV = ["low", "medium", "high", "critical"];
const VALID_TYPES = ["pattern_detected", "risk_escalation", "intervention_needed", "decline_observed", "positive_trend"];

async function sha256(s: string): Promise<string> {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const t = withTiming("resident-assurance-ai");
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCorsHeaders(origin) });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, origin);

  const secret = Deno.env.get("RESIDENT_ASSURANCE_AI_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    t.log({ event: "auth_failed", outcome: "error", error_message: "secret mismatch" });
    return jsonResponse({ error: "Unauthorized" }, 401, origin);
  }
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) return jsonResponse({ error: "AI provider not configured" }, 500, origin);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let body: { organization_id?: string; facility_id?: string; max_residents?: number };
  try { body = (await req.json()) as typeof body; } catch { return jsonResponse({ error: "Invalid JSON body" }, 400, origin); }

  const orgId = body.organization_id?.trim();
  if (!orgId || !UUID_RE.test(orgId)) return jsonResponse({ error: "organization_id (uuid) required" }, 400, origin);
  const facilityId = body.facility_id?.trim();
  if (facilityId && !UUID_RE.test(facilityId)) return jsonResponse({ error: "facility_id must be a valid uuid" }, 400, origin);

  // PHI compliance gate
  const { data: policy } = await admin.from("ai_invocation_policies").select("allow_phi").eq("organization_id", orgId).maybeSingle();
  if (!policy?.allow_phi) {
    t.log({ event: "phi_blocked", outcome: "blocked", organization_id: orgId });
    return jsonResponse({ error: "PHI processing not authorized for this organization" }, 403, origin);
  }

  // Load active residents and facility entity mapping
  const cap = Math.min(Math.max(Number(body.max_residents) || MAX_CAP, 1), MAX_CAP);
  let q = admin.from("residents").select("id, facility_id").eq("organization_id", orgId).is("deleted_at", null).eq("status", "active").limit(cap);
  if (facilityId) q = q.eq("facility_id", facilityId);
  const [{ data: residents }, { data: facilities }] = await Promise.all([
    q,
    admin.from("facilities").select("id, entity_id").eq("organization_id", orgId).is("deleted_at", null),
  ]);
  if (!residents?.length) {
    t.log({ event: "no_residents", outcome: "success", organization_id: orgId });
    return jsonResponse({ ok: true, residents_analyzed: 0, insights_generated: 0, alerts_created: 0 });
  }
  const entityByFacility = new Map((facilities ?? []).map((facility) => [facility.id, facility.entity_id]));

  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  let insightsGenerated = 0, alertsCreated = 0;

  for (const r of residents) {
    // Gather 7-day clinical data in parallel
    const [obsRes, incRes, emarRes, scoreRes, assessRes] = await Promise.all([
      admin.from("resident_observation_logs").select("quick_status, exception_present").eq("resident_id", r.id).gte("observed_at", since).is("deleted_at", null),
      admin.from("incidents").select("category, severity").eq("resident_id", r.id).gte("created_at", since).is("deleted_at", null),
      admin.from("emar_records").select("status, is_prn, prn_effectiveness_result").eq("resident_id", r.id).gte("scheduled_time", since).is("deleted_at", null),
      admin.from("resident_safety_scores").select("score, risk_tier, score_delta").eq("resident_id", r.id).is("deleted_at", null).order("computed_at", { ascending: false }).limit(1).maybeSingle(),
      admin.from("assessments").select("assessment_type, total_score").eq("resident_id", r.id).gte("created_at", since).is("deleted_at", null),
    ]);

    if (obsRes.error || incRes.error || emarRes.error || scoreRes.error || assessRes.error) {
      t.log({
        event: "resident_data_load_failed",
        outcome: "error",
        resident_id: r.id,
        error_message:
          obsRes.error?.message ??
          incRes.error?.message ??
          emarRes.error?.message ??
          scoreRes.error?.message ??
          assessRes.error?.message,
      });
      continue;
    }

    const obs = obsRes.data ?? [], incidents = incRes.data ?? [], emars = emarRes.data ?? [];
    const ss = scoreRes.data, assessments = assessRes.data ?? [];

    // Aggregate observations
    const statusDist: Record<string, number> = {};
    let excCount = 0;
    for (const o of obs) { statusDist[o.quick_status] = (statusDist[o.quick_status] || 0) + 1; if (o.exception_present) excCount++; }

    // Aggregate incidents
    const incByType: Record<string, number> = {};
    for (const i of incidents) incByType[i.category] = (incByType[i.category] || 0) + 1;

    // Aggregate eMAR
    const given = emars.filter((e) => e.status === "given").length;
    const refused = emars.filter((e) => e.status === "refused").length;
    const missed = emars.filter((e) => e.status === "missed").length;
    const prn = emars.filter((e) => e.is_prn);
    const prnEff = prn.filter((e) => e.prn_effectiveness_result === "effective").length;
    const adherePct = emars.length ? Math.round((given / emars.length) * 100) : 100;
    const prnRate = prn.length ? Math.round((prnEff / prn.length) * 100) : 0;

    // Latest assessments by type
    const latest: Record<string, number> = {};
    for (const a of assessments) if (!(a.assessment_type in latest)) latest[a.assessment_type] = a.total_score;

    const incStr = Object.entries(incByType).map(([k, v]) => `${k}: ${v}`).join(", ") || "none";
    const assStr = Object.entries(latest).map(([k, v]) => `${k}: ${v}`).join(", ") || "none";

    const prompt = `You are a clinical analyst for an assisted living facility in Florida.
Analyze this resident's 7-day clinical data and identify patterns.

RESIDENT DATA:
- Observation logs: ${obs.length} entries, quick_status distribution: ${JSON.stringify(statusDist)}
- Exceptions: ${excCount}
- Incidents: ${incidents.length} (${incStr})
- Medication: ${adherePct}% adherence, ${refused} refusals, ${missed} missed, PRN effectiveness: ${prnRate}%
- Safety score: ${ss?.score ?? "N/A"}/100 (${ss?.risk_tier ?? "N/A"}), delta: ${ss?.score_delta ?? "N/A"}
- Latest assessments: ${assStr}

Respond with JSON only:
{
  "patterns": [{"type":"pattern_detected|risk_escalation|intervention_needed|decline_observed|positive_trend","severity":"low|medium|high|critical","title":"Short title","body":"Clinical explanation","clinical_domains":["fall_risk","medication","behavioral","cognitive","nutrition","skin","infection"]}],
  "risk_direction": "improving|stable|declining|critical"
}`;

    // Call Anthropic
    let parsed: { patterns: Array<{ type: string; severity: string; title: string; body: string; clinical_domains: string[] }> };
    let tokensUsed = 0;
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: MODEL, max_tokens: 1024, messages: [{ role: "user", content: prompt }] }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!resp.ok) { t.log({ event: "anthropic_error", outcome: "error", status: resp.status, resident_id: r.id }); continue; }
      const result = await resp.json();
      tokensUsed = (result.usage?.input_tokens ?? 0) + (result.usage?.output_tokens ?? 0);
      parsed = JSON.parse(result.content?.[0]?.text ?? "");
    } catch { t.log({ event: "ai_parse_error", outcome: "error", resident_id: r.id }); continue; }

    // Log AI invocation (hash prompt — never store raw PHI)
    const promptHash = await sha256(prompt);
    await admin.from("ai_invocations").insert({
      organization_id: orgId, model: MODEL, phi_class: "phi", prompt_hash: promptHash,
      response_hash: await sha256(JSON.stringify(parsed)),
      created_by: "00000000-0000-0000-0000-000000000000", tokens_used: tokensUsed,
      metadata_json: { edge_fn: "resident-assurance-ai", resident_id: r.id },
    });

    // Insert insights + exec_alerts for high/critical
    for (const p of parsed.patterns ?? []) {
      const sev = VALID_SEV.includes(p.severity) ? p.severity : "medium";
      const iType = VALID_TYPES.includes(p.type) ? p.type : "pattern_detected";

      const { error: insErr } = await admin.from("resident_safety_insights").insert({
        organization_id: orgId, entity_id: entityByFacility.get(r.facility_id) ?? null, facility_id: r.facility_id,
        resident_id: r.id, insight_type: iType, severity: sev,
        title: (p.title ?? "").slice(0, 200), body: (p.body ?? "").slice(0, 2000),
        clinical_domains: Array.isArray(p.clinical_domains) ? p.clinical_domains : [],
        ai_model: MODEL, source_data_json: { observation_count: obs.length, incident_count: incidents.length },
      });
      if (!insErr) insightsGenerated++;

      if (sev === "high" || sev === "critical") {
        const { error: aErr } = await admin.from("exec_alerts").insert({
          organization_id: orgId, facility_id: r.facility_id, entity_id: entityByFacility.get(r.facility_id) ?? null, source_module: "system",
          severity: sev === "critical" ? "critical" : "warning", title: `[AI] ${(p.title ?? "").slice(0, 180)}`, body: p.body?.slice(0, 2000),
          category: "clinical", why_it_matters: "AI-detected clinical pattern requiring attention",
          current_value_json: { resident_id: r.id, insight_type: iType },
          deep_link_path: "/admin/rounding/insights",
        });
        if (!aErr) alertsCreated++;
      }
    }
  }

  t.log({ event: "complete", outcome: "success", organization_id: orgId, residents_analyzed: residents.length, insights_generated: insightsGenerated, alerts_created: alertsCreated });
  return jsonResponse({ ok: true, residents_analyzed: residents.length, insights_generated: insightsGenerated, alerts_created: alertsCreated }, 200, origin);
});
