/**
 * Save path for a completed assessment. Two halves, on purpose:
 *
 *   1. `insertAssessmentRecord` writes the one `assessments` row. It is the
 *      only insert, and the caller must not call it again once it has
 *      returned an id (that is how a retry after a downstream failure avoids
 *      recording the same assessment twice).
 *   2. `applyAssessmentDownstreamUpdates` performs the follow-on writes the
 *      spec attaches to a scored assessment: Morse → `residents.fall_risk_level`,
 *      Katz/Morse/Braden → resident acuity composite, and a care-plan review
 *      alert when the instrument's own risk level worsened against the prior
 *      record of the same instrument. The mappings live in `./scoring`; this
 *      module does not add or reinterpret any.
 *
 * Nothing here decides completeness. Callers pass a `CompletedResult` from
 * `assessment-entry-model`, which exists only when every section is answered.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { requireHeadCount } from "@/lib/metrics/require-head-count";
import type { Database } from "@/types/database";

import {
  computeAcuityComposite,
  computeNextDueDate,
  didRiskWorsen,
  mapMorseToFallRisk,
} from "./scoring";
import type { AssessmentScores, AssessmentTemplate } from "./types";

export type AssessmentSupabase = SupabaseClient<Database>;

export interface InsertAssessmentInput {
  residentId: string;
  facilityId: string;
  organizationId: string;
  userId: string;
  template: AssessmentTemplate;
  assessmentDate: string;
  totalScore: number;
  riskLevel: string;
  scores: AssessmentScores;
  notes: string | null;
}

export interface RecordedAssessment {
  id: string | null;
  assessmentType: string;
  instrumentName: string;
  assessmentDate: string;
  totalScore: number;
  riskLevel: string;
  nextDueDate: string;
}

export async function insertAssessmentRecord(
  supabase: AssessmentSupabase,
  input: InsertAssessmentInput,
): Promise<RecordedAssessment> {
  const nextDueDate = computeNextDueDate(
    input.assessmentDate,
    input.template.default_frequency_days,
  );
  const { data, error } = await supabase
    .from("assessments")
    .insert({
      resident_id: input.residentId,
      facility_id: input.facilityId,
      organization_id: input.organizationId,
      assessment_type: input.template.assessment_type,
      assessment_date: input.assessmentDate,
      total_score: input.totalScore,
      risk_level: input.riskLevel,
      scores: input.scores,
      notes: input.notes,
      assessed_by: input.userId,
      next_due_date: nextDueDate,
      created_by: input.userId,
      updated_by: input.userId,
    })
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return {
    id: (data as { id?: string } | null)?.id ?? null,
    assessmentType: input.template.assessment_type,
    instrumentName: input.template.name,
    assessmentDate: input.assessmentDate,
    totalScore: input.totalScore,
    riskLevel: input.riskLevel,
    nextDueDate,
  };
}

/** Count of assessments of this instrument already on record for the same date. */
export async function countSameDayAssessments(
  supabase: AssessmentSupabase,
  args: { residentId: string; assessmentType: string; assessmentDate: string },
): Promise<number> {
  const { count, error } = await supabase
    .from("assessments")
    .select("id", { count: "exact", head: true })
    .eq("resident_id", args.residentId)
    .eq("assessment_type", args.assessmentType)
    .eq("assessment_date", args.assessmentDate)
    .is("deleted_at", null);
  if (error) throw new Error(error.message);
  // A missing count is not "no duplicates": the caller shows the duplicate
  // check as unknown rather than letting a second same-day record through quietly.
  return requireHeadCount({ count }, "Same-day assessments");
}

export interface DownstreamInput {
  residentId: string;
  facilityId: string;
  organizationId: string;
  assessmentType: string;
  instrumentName: string;
  totalScore: number;
  riskLevel: string;
}

const ACUITY_INSTRUMENTS = new Set(["katz_adl", "morse_fall", "braden"]);

export async function applyAssessmentDownstreamUpdates(
  supabase: AssessmentSupabase,
  input: DownstreamInput,
): Promise<void> {
  const { residentId, facilityId, organizationId, assessmentType, totalScore, riskLevel } = input;

  if (assessmentType === "morse_fall") {
    const fallRisk = mapMorseToFallRisk(totalScore);
    const result = await supabase
      .from("residents")
      .update({ fall_risk_level: fallRisk })
      .eq("id", residentId)
      .select("id")
      .single();
    if (result.error) throw result.error;
  }

  if (ACUITY_INSTRUMENTS.has(assessmentType)) {
    const { data: latestAssessments, error: latestError } = await supabase
      .from("assessments")
      .select("assessment_type, total_score, risk_level")
      .eq("resident_id", residentId)
      .is("deleted_at", null)
      .in("assessment_type", [...ACUITY_INSTRUMENTS])
      .order("assessment_date", { ascending: false });
    if (latestError) throw latestError;

    const latest: Record<string, { total_score: number | null; risk_level: string | null }> = {};
    for (const a of latestAssessments ?? []) {
      if (!latest[a.assessment_type]) latest[a.assessment_type] = a;
    }

    const { acuityScore, acuityLevel } = computeAcuityComposite({
      katzScore: latest.katz_adl?.total_score ?? undefined,
      morseRiskLevel: latest.morse_fall?.risk_level ?? undefined,
      bradenRiskLevel: latest.braden?.risk_level ?? undefined,
    });

    const acuityResult = await supabase
      .from("residents")
      .update({ acuity_score: acuityScore, acuity_level: acuityLevel })
      .eq("id", residentId)
      .select("id")
      .single();
    if (acuityResult.error) throw acuityResult.error;
  }

  const { data: priorAssessments, error: priorError } = await supabase
    .from("assessments")
    .select("risk_level")
    .eq("resident_id", residentId)
    .eq("assessment_type", assessmentType)
    .is("deleted_at", null)
    .order("assessment_date", { ascending: false })
    .limit(2);
  if (priorError) throw priorError;
  const prior = priorAssessments && priorAssessments.length > 1 ? priorAssessments[1] : null;

  if (prior && didRiskWorsen(assessmentType, riskLevel, prior.risk_level)) {
    const { data: activePlan, error: planError } = await supabase
      .from("care_plans")
      .select("id")
      .eq("resident_id", residentId)
      .eq("status", "active")
      .is("deleted_at", null)
      .maybeSingle();
    if (planError) throw planError;
    if (activePlan) {
      const { error: alertErr } = await supabase.from("care_plan_review_alerts" as never).insert({
        care_plan_id: activePlan.id,
        resident_id: residentId,
        facility_id: facilityId,
        organization_id: organizationId,
        trigger_type: "assessment_threshold",
        trigger_detail: `${input.instrumentName} risk changed from ${prior.risk_level} to ${riskLevel}`,
      } as never);
      const pgCode = alertErr ? (alertErr as { code?: string }).code : undefined;
      const isUniqueViolation =
        pgCode === "23505" || alertErr?.message?.toLowerCase().includes("unique");
      if (alertErr && !isUniqueViolation) {
        throw new Error(`Assessment recorded; care-plan review alert failed: ${alertErr.message}`);
      }
    }
  }
}
