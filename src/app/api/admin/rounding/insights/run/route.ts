import { NextResponse } from "next/server";

import {
  actorCanAccessFacility,
  listActorAccessibleFacilityIds,
  requireAdminApiActor,
} from "@/lib/admin/api-auth";
import type { Database } from "@/types/database";

const MAX_RESIDENTS = 25;
const VALID_SEVERITIES = new Set<Database["public"]["Enums"]["resident_observation_severity"]>([
  "low",
  "medium",
  "high",
  "critical",
]);
const MODEL = "claude-haiku-4-5-20251001";

type InsightPattern = {
  type: string;
  severity: string;
  title: string;
  body: string;
  clinical_domains: string[];
};
type ResidentInsightType =
  | "pattern_detected"
  | "risk_escalation"
  | "intervention_needed"
  | "decline_observed"
  | "positive_trend";

const VALID_TYPES = new Set<ResidentInsightType>([
  "pattern_detected",
  "risk_escalation",
  "intervention_needed",
  "decline_observed",
  "positive_trend",
]);

type ResidentRow = Pick<Database["public"]["Tables"]["residents"]["Row"], "id" | "facility_id">;
type FacilityEntityRow = Pick<Database["public"]["Tables"]["facilities"]["Row"], "id" | "entity_id">;
type ObservationRow = Pick<
  Database["public"]["Tables"]["resident_observation_logs"]["Row"],
  "quick_status" | "exception_present"
>;
type IncidentRow = Pick<Database["public"]["Tables"]["incidents"]["Row"], "category" | "severity">;
type EmarRow = Pick<
  Database["public"]["Tables"]["emar_records"]["Row"],
  "status" | "is_prn" | "prn_effectiveness_result"
>;
type AssessmentRow = Pick<
  Database["public"]["Tables"]["assessments"]["Row"],
  "assessment_type" | "total_score"
>;
type SafetyScoreRow = {
  score: number | null;
  risk_tier: string | null;
  score_delta: number | null;
};
type ResidentSafetyInsightInsert = {
  organization_id: string;
  entity_id: string | null;
  facility_id: string;
  resident_id: string;
  insight_type: ResidentInsightType;
  severity: Database["public"]["Enums"]["resident_observation_severity"];
  title: string;
  body: string | null;
  clinical_domains: string[];
  ai_model: string;
  ai_invocation_id: string | null;
  source_data_json: {
    observation_count: number;
    incident_count: number;
    adherence_pct: number;
    prn_effectiveness_pct: number | null;
  };
  created_by: string;
};

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

function normalizeSeverity(value: string): Database["public"]["Enums"]["resident_observation_severity"] {
  return VALID_SEVERITIES.has(value as Database["public"]["Enums"]["resident_observation_severity"])
    ? (value as Database["public"]["Enums"]["resident_observation_severity"])
    : "medium";
}

function normalizeInsightType(value: string): ResidentInsightType {
  return VALID_TYPES.has(value as ResidentInsightType)
    ? (value as ResidentInsightType)
    : "pattern_detected";
}

function alertSeverityForInsight(
  value: Database["public"]["Enums"]["resident_observation_severity"],
): Database["public"]["Enums"]["exec_alert_severity"] | null {
  if (value === "critical") return "critical";
  if (value === "high") return "warning";
  return null;
}

export async function POST(request: Request) {
  const auth = await requireAdminApiActor({
    allowedRoles: ["owner", "org_admin", "facility_admin"],
  });
  if ("response" in auth) return auth.response;

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return NextResponse.json({ error: "AI provider not configured." }, { status: 503 });
  }

  let body: { facilityId?: string | null; maxResidents?: number } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const facilityId = body.facilityId?.trim() || null;
  if (facilityId) {
    const hasAccess = await actorCanAccessFacility(auth.actor, facilityId);
    if (!hasAccess) {
      return NextResponse.json({ error: "No access to this facility." }, { status: 403 });
    }
  }

  const { data: policy, error: policyError } = await auth.actor.admin
    .from("ai_invocation_policies")
    .select("allow_phi")
    .eq("organization_id", auth.actor.organization_id)
    .maybeSingle();
  if (policyError) {
    return NextResponse.json({ error: policyError.message }, { status: 500 });
  }
  if (!policy?.allow_phi) {
    return NextResponse.json({ error: "PHI processing not authorized for this organization." }, { status: 403 });
  }

  const accessibleFacilityIds = facilityId ? [facilityId] : await listActorAccessibleFacilityIds(auth.actor);
  if (accessibleFacilityIds.length === 0) {
    return NextResponse.json({ error: "No accessible facilities available." }, { status: 404 });
  }

  const residentCap = Math.min(Math.max(Number(body.maxResidents) || MAX_RESIDENTS, 1), MAX_RESIDENTS);
  const [residentResult, facilityResult] = await Promise.all([
    auth.actor.admin
      .from("residents")
      .select("id, facility_id")
      .eq("organization_id", auth.actor.organization_id)
      .eq("status", "active")
      .is("deleted_at", null)
      .in("facility_id", accessibleFacilityIds)
      .limit(residentCap),
    auth.actor.admin
      .from("facilities")
      .select("id, entity_id")
      .eq("organization_id", auth.actor.organization_id)
      .is("deleted_at", null)
      .in("id", accessibleFacilityIds),
  ]);

  if (residentResult.error) {
    return NextResponse.json({ error: residentResult.error.message }, { status: 500 });
  }
  if (facilityResult.error) {
    return NextResponse.json({ error: facilityResult.error.message }, { status: 500 });
  }

  const residents = (residentResult.data ?? []) as ResidentRow[];
  if (residents.length === 0) {
    return NextResponse.json({ ok: true, residentsAnalyzed: 0, insightsGenerated: 0, alertsCreated: 0 });
  }

  const facilityEntityMap = new Map(
    ((facilityResult.data ?? []) as FacilityEntityRow[]).map((facility) => [facility.id, facility.entity_id]),
  );
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  let insightsGenerated = 0;
  let alertsCreated = 0;

  for (const resident of residents) {
    const [observationResult, incidentResult, emarResult, scoreResult, assessmentResult] = await Promise.all([
      auth.actor.admin
        .from("resident_observation_logs")
        .select("quick_status, exception_present")
        .eq("resident_id", resident.id)
        .gte("observed_at", since)
        .is("deleted_at", null),
      auth.actor.admin
        .from("incidents")
        .select("category, severity")
        .eq("resident_id", resident.id)
        .gte("created_at", since)
        .is("deleted_at", null),
      auth.actor.admin
        .from("emar_records")
        .select("status, is_prn, prn_effectiveness_result")
        .eq("resident_id", resident.id)
        .gte("scheduled_time", since)
        .is("deleted_at", null),
      (auth.actor.admin
        .from("resident_safety_scores" as never)
        .select("score, risk_tier, score_delta")
        .eq("resident_id" as never, resident.id as never)
        .is("deleted_at" as never, null as never)
        .order("computed_at" as never, { ascending: false })
        .limit(1)
        .maybeSingle() as unknown as Promise<{
        data: SafetyScoreRow | null;
        error: { message: string } | null;
      }>),
      auth.actor.admin
        .from("assessments")
        .select("assessment_type, total_score")
        .eq("resident_id", resident.id)
        .gte("created_at", since)
        .is("deleted_at", null),
    ]);

    const loadError =
      observationResult.error ??
      incidentResult.error ??
      emarResult.error ??
      scoreResult.error ??
      assessmentResult.error;
    if (loadError) {
      continue;
    }

    const observations = (observationResult.data ?? []) as ObservationRow[];
    const incidents = (incidentResult.data ?? []) as IncidentRow[];
    const emars = (emarResult.data ?? []) as EmarRow[];
    const latestScore = scoreResult.data;
    const assessments = (assessmentResult.data ?? []) as AssessmentRow[];

    const statusDistribution: Record<string, number> = {};
    let exceptionCount = 0;
    for (const observation of observations) {
      statusDistribution[observation.quick_status] = (statusDistribution[observation.quick_status] || 0) + 1;
      if (observation.exception_present) exceptionCount += 1;
    }

    const incidentSummary = incidents.length
      ? incidents.map((incident) => `${incident.category}:${incident.severity}`).join(", ")
      : "none";
    const given = emars.filter((record) => record.status === "given").length;
    const refused = emars.filter((record) => record.status === "refused").length;
    const missed = emars.filter((record) => record.status === "not_available").length;
    const adherencePct = emars.length ? Math.round((given / emars.length) * 100) : 100;
    const prnRecords = emars.filter((record) => record.is_prn);
    const prnEffective = prnRecords.filter((record) => record.prn_effectiveness_result === "effective").length;
    const prnEffectivenessPct = prnRecords.length
      ? Math.round((prnEffective / prnRecords.length) * 100)
      : null;
    const assessmentSummary = assessments.length
      ? assessments.map((assessment) => `${assessment.assessment_type}:${assessment.total_score ?? "n/a"}`).join(", ")
      : "none";

    const prompt = `You are a clinical analyst for an assisted living facility in Florida.
Analyze this resident's 7-day clinical data and identify early warning patterns.

RESIDENT DATA
- Observation count: ${observations.length}
- Observation status distribution: ${JSON.stringify(statusDistribution)}
- Observation exceptions: ${exceptionCount}
- Incidents: ${incidents.length} (${incidentSummary})
- Medication adherence: ${adherencePct}% with ${refused} refusals and ${missed} unavailable doses
- PRN effectiveness: ${prnEffectivenessPct ?? "N/A"}%
- Latest safety score: ${latestScore?.score ?? "N/A"} (${latestScore?.risk_tier ?? "N/A"}), delta ${latestScore?.score_delta ?? "N/A"}
- Latest assessments: ${assessmentSummary}

Return JSON only:
{
  "patterns": [
    {
      "type": "pattern_detected|risk_escalation|intervention_needed|decline_observed|positive_trend",
      "severity": "low|medium|high|critical",
      "title": "Short title",
      "body": "Clinical explanation",
      "clinical_domains": ["fall_risk","medication","behavioral","cognitive","nutrition","skin","infection"]
    }
  ]
}`;

    let patterns: InsightPattern[] = [];
    let invocationId: string | null = null;
    try {
      const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 800,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!anthropicResponse.ok) continue;
      const payload = (await anthropicResponse.json()) as {
        content?: Array<{ text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const parsed = JSON.parse(payload.content?.[0]?.text ?? "{}") as { patterns?: InsightPattern[] };
      patterns = Array.isArray(parsed.patterns) ? parsed.patterns : [];

      const invocationResult = await auth.actor.admin
        .from("ai_invocations")
        .insert({
          organization_id: auth.actor.organization_id,
          model: MODEL,
          phi_class: "phi",
          prompt_hash: await sha256(prompt),
          response_hash: await sha256(JSON.stringify(parsed)),
          created_by: auth.actor.id,
          tokens_used: (payload.usage?.input_tokens ?? 0) + (payload.usage?.output_tokens ?? 0),
          metadata_json: { route: "admin-rounding-insights-run", resident_id: resident.id },
        })
        .select("id")
        .single();
      invocationId = invocationResult.data?.id ?? null;
    } catch {
      continue;
    }

    for (const pattern of patterns) {
      const severity = normalizeSeverity(pattern.severity);
      const insightType = normalizeInsightType(pattern.type);
      const entityId = facilityEntityMap.get(resident.facility_id) ?? null;
      const insightInsert: ResidentSafetyInsightInsert = {
        organization_id: auth.actor.organization_id,
        entity_id: entityId,
        facility_id: resident.facility_id,
        resident_id: resident.id,
        insight_type: insightType,
        severity,
        title: (pattern.title ?? "").slice(0, 200),
        body: pattern.body?.slice(0, 2000) ?? null,
        clinical_domains: Array.isArray(pattern.clinical_domains) ? pattern.clinical_domains : [],
        ai_model: MODEL,
        ai_invocation_id: invocationId,
        source_data_json: {
          observation_count: observations.length,
          incident_count: incidents.length,
          adherence_pct: adherencePct,
          prn_effectiveness_pct: prnEffectivenessPct,
        },
        created_by: auth.actor.id,
      };

      const { error: insertError } = await (auth.actor.admin
        .from("resident_safety_insights" as never)
        .insert(insightInsert as never) as unknown as Promise<{
        error: { message: string } | null;
      }>);
      if (!insertError) insightsGenerated += 1;

      const alertSeverity = alertSeverityForInsight(severity);
      if (alertSeverity) {
        const { error: alertError } = await auth.actor.admin.from("exec_alerts").insert({
          organization_id: auth.actor.organization_id,
          entity_id: entityId,
          facility_id: resident.facility_id,
          source_module: "system",
          severity: alertSeverity,
          title: `[AI] ${(pattern.title ?? "").slice(0, 180)}`,
          body: pattern.body?.slice(0, 2000) ?? null,
          category: "clinical",
          why_it_matters: "AI-detected resident safety pattern requiring review.",
          current_value_json: { resident_id: resident.id, insight_type: insightType },
          deep_link_path: "/admin/rounding/insights",
        });
        if (!alertError) alertsCreated += 1;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    residentsAnalyzed: residents.length,
    insightsGenerated,
    alertsCreated,
  });
}
