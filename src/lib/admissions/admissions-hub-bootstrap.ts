import type { SupabaseClient } from "@supabase/supabase-js";

import {
  admissionsHubActivityLowerBoundUtc,
  admissionsHubCalendarUpperBoundUtc,
  type AdmissionsHubScope,
} from "@/lib/admin/admissions/hub-scope";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";

export const ADMISSIONS_HUB_PREVIEW_LIMIT = 100;

export type AdmissionsHubLeadRow = Pick<
  Database["public"]["Tables"]["referral_leads"]["Row"],
  "id" | "first_name" | "last_name" | "status" | "updated_at"
> & {
  referral_sources: { name: string } | null;
};

export type AdmissionsHubCaseRow = Pick<
  Database["public"]["Tables"]["admission_cases"]["Row"],
  | "id"
  | "status"
  | "updated_at"
  | "target_move_in_date"
  | "financial_clearance_at"
  | "physician_orders_received_at"
  | "bed_id"
  | "resident_id"
  | "referral_lead_id"
  | "medicaid_pipeline_stage"
> & {
  residents: { first_name: string; last_name: string } | null;
};

export type AdmissionsHubDischargeRow = Pick<
  Database["public"]["Tables"]["discharge_med_reconciliation"]["Row"],
  | "id"
  | "status"
  | "updated_at"
  | "nurse_reconciliation_notes"
  | "pharmacist_npi"
  | "pharmacist_notes"
> & {
  residents: {
    first_name: string;
    last_name: string;
    discharge_target_date: string | null;
    hospice_status: string;
  } | null;
};

export type AdmissionsHubTriageRow = Pick<
  Database["public"]["Tables"]["family_message_triage_items"]["Row"],
  "id" | "updated_at" | "matched_keywords" | "triage_status"
> & {
  residents: { first_name: string; last_name: string } | null;
};

export type AdmissionsHubConferenceRow = Pick<
  Database["public"]["Tables"]["family_care_conference_sessions"]["Row"],
  | "id"
  | "scheduled_start"
  | "updated_at"
  | "status"
  | "recording_consent"
  | "recording_consent_at"
  | "recording_consent_by"
> & {
  residents: { first_name: string; last_name: string } | null;
};

export type AdmissionsHubBootstrap = {
  referrals: AdmissionsHubLeadRow[];
  admissions: AdmissionsHubCaseRow[];
  discharges: AdmissionsHubDischargeRow[];
  triage: AdmissionsHubTriageRow[];
  conferences: AdmissionsHubConferenceRow[];
  onboardingState: Record<string, string[]>;
  referralMetrics: { activePipeline: number };
  admissionMetrics: { pending: number; reserved: number; moveIn: number };
  dischargeMetrics: { inReview: number };
  familyMetrics: { triage: number; conferences: number; consentsPending: number };
};

export function emptyAdmissionsHubBootstrap(): AdmissionsHubBootstrap {
  return {
    referrals: [],
    admissions: [],
    discharges: [],
    triage: [],
    conferences: [],
    onboardingState: {},
    referralMetrics: { activePipeline: 0 },
    admissionMetrics: { pending: 0, reserved: 0, moveIn: 0 },
    dischargeMetrics: { inReview: 0 },
    familyMetrics: { triage: 0, conferences: 0, consentsPending: 0 },
  };
}

async function loadOnboardingState(
  supabase: SupabaseClient<Database>,
  admissions: AdmissionsHubCaseRow[],
): Promise<Record<string, string[]>> {
  const moveInCases = admissions.filter((row) => row.status === "move_in" && row.resident_id);
  const residentIds = moveInCases.map((row) => row.resident_id).filter(Boolean) as string[];
  if (residentIds.length === 0) return {};

  const [carePlansRes, medsRes, payersRes, consentsRes] = await Promise.all([
    supabase.from("care_plans").select("resident_id").in("resident_id", residentIds).is("deleted_at", null),
    supabase.from("resident_medications").select("resident_id").in("resident_id", residentIds).is("deleted_at", null),
    supabase.from("resident_payers").select("resident_id").in("resident_id", residentIds).is("deleted_at", null),
    supabase.from("family_consent_records").select("resident_id").in("resident_id", residentIds).is("deleted_at", null),
  ]);

  if (carePlansRes.error || medsRes.error || payersRes.error || consentsRes.error) {
    return {};
  }

  const carePlanIds = new Set((carePlansRes.data ?? []).map((row) => row.resident_id));
  const medIds = new Set((medsRes.data ?? []).map((row) => row.resident_id));
  const payerIds = new Set((payersRes.data ?? []).map((row) => row.resident_id));
  const consentIds = new Set((consentsRes.data ?? []).map((row) => row.resident_id));

  return Object.fromEntries(
    moveInCases.map((row) => {
      const residentId = row.resident_id as string;
      const missing = [
        !carePlanIds.has(residentId) ? "care plan" : null,
        !medIds.has(residentId) ? "medications" : null,
        !payerIds.has(residentId) ? "billing" : null,
        !consentIds.has(residentId) ? "family consent" : null,
      ].filter((value): value is string => Boolean(value));
      return [row.id, missing];
    }),
  );
}

export async function loadAdmissionsHubBootstrap(
  selectedFacilityId: string | null,
  hubScope: AdmissionsHubScope,
  supabase: SupabaseClient<Database> = createClient(),
): Promise<AdmissionsHubBootstrap> {
  if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
    return emptyAdmissionsHubBootstrap();
  }

  const activityLower = admissionsHubActivityLowerBoundUtc(hubScope);
  const calendarUpper = admissionsHubCalendarUpperBoundUtc(hubScope);
  const nowIso = new Date().toISOString();

  let refSel = supabase
    .from("referral_leads")
    .select("id, first_name, last_name, status, updated_at, referral_sources(name)")
    .eq("facility_id", selectedFacilityId)
    .is("deleted_at", null)
    .not("status", "in", "(converted,lost,merged)")
    .order("updated_at", { ascending: false });
  if (activityLower) refSel = refSel.gte("updated_at", activityLower);
  refSel = refSel.limit(ADMISSIONS_HUB_PREVIEW_LIMIT);

  let admSel = supabase
    .from("admission_cases")
    .select(
      "id, referral_lead_id, status, medicaid_pipeline_stage, updated_at, target_move_in_date, financial_clearance_at, physician_orders_received_at, bed_id, resident_id, residents(first_name, last_name)",
    )
    .eq("facility_id", selectedFacilityId)
    .is("deleted_at", null)
    .not("status", "eq", "cancelled")
    .order("updated_at", { ascending: false });
  if (activityLower) admSel = admSel.gte("updated_at", activityLower);
  admSel = admSel.limit(ADMISSIONS_HUB_PREVIEW_LIMIT);

  let disSel = supabase
    .from("discharge_med_reconciliation")
    .select(
      "id, status, updated_at, nurse_reconciliation_notes, pharmacist_npi, pharmacist_notes, residents(first_name, last_name, discharge_target_date, hospice_status)",
    )
    .eq("facility_id", selectedFacilityId)
    .is("deleted_at", null)
    .not("status", "eq", "cancelled")
    .order("updated_at", { ascending: false });
  if (activityLower) disSel = disSel.gte("updated_at", activityLower);
  disSel = disSel.limit(ADMISSIONS_HUB_PREVIEW_LIMIT);

  let triSel = supabase
    .from("family_message_triage_items")
    .select("id, updated_at, matched_keywords, triage_status, residents(first_name, last_name)")
    .eq("facility_id", selectedFacilityId)
    .is("deleted_at", null)
    .in("triage_status", ["pending_review", "in_review"])
    .order("updated_at", { ascending: false });
  if (activityLower) triSel = triSel.gte("updated_at", activityLower);
  triSel = triSel.limit(ADMISSIONS_HUB_PREVIEW_LIMIT);

  let confSel = supabase
    .from("family_care_conference_sessions")
    .select(
      "id, scheduled_start, updated_at, status, recording_consent, recording_consent_at, recording_consent_by, residents(first_name, last_name)",
    )
    .eq("facility_id", selectedFacilityId)
    .is("deleted_at", null)
    .gte("scheduled_start", nowIso)
    .order("scheduled_start", { ascending: true });
  if (calendarUpper) confSel = confSel.lte("scheduled_start", calendarUpper);
  confSel = confSel.limit(ADMISSIONS_HUB_PREVIEW_LIMIT);

  let cRefPipe = supabase
    .from("referral_leads")
    .select("id", { count: "exact", head: true })
    .eq("facility_id", selectedFacilityId)
    .is("deleted_at", null)
    .not("status", "in", "(converted,lost,merged)");
  if (activityLower) cRefPipe = cRefPipe.gte("updated_at", activityLower);

  let cAdmPend = supabase
    .from("admission_cases")
    .select("id", { count: "exact", head: true })
    .eq("facility_id", selectedFacilityId)
    .is("deleted_at", null)
    .eq("status", "pending_clearance");
  if (activityLower) cAdmPend = cAdmPend.gte("updated_at", activityLower);

  let cAdmRes = supabase
    .from("admission_cases")
    .select("id", { count: "exact", head: true })
    .eq("facility_id", selectedFacilityId)
    .is("deleted_at", null)
    .eq("status", "bed_reserved");
  if (activityLower) cAdmRes = cAdmRes.gte("updated_at", activityLower);

  let cAdmMove = supabase
    .from("admission_cases")
    .select("id", { count: "exact", head: true })
    .eq("facility_id", selectedFacilityId)
    .is("deleted_at", null)
    .eq("status", "move_in");
  if (activityLower) cAdmMove = cAdmMove.gte("updated_at", activityLower);

  let cDisRev = supabase
    .from("discharge_med_reconciliation")
    .select("id", { count: "exact", head: true })
    .eq("facility_id", selectedFacilityId)
    .is("deleted_at", null)
    .eq("status", "pharmacist_review");
  if (activityLower) cDisRev = cDisRev.gte("updated_at", activityLower);

  let cFamTriage = supabase
    .from("family_message_triage_items")
    .select("id", { count: "exact", head: true })
    .eq("facility_id", selectedFacilityId)
    .is("deleted_at", null)
    .in("triage_status", ["pending_review", "in_review"]);
  if (activityLower) cFamTriage = cFamTriage.gte("updated_at", activityLower);

  let cFamConf = supabase
    .from("family_care_conference_sessions")
    .select("id", { count: "exact", head: true })
    .eq("facility_id", selectedFacilityId)
    .is("deleted_at", null)
    .gte("scheduled_start", nowIso);
  if (calendarUpper) cFamConf = cFamConf.lte("scheduled_start", calendarUpper);

  let cFamConsent = supabase
    .from("family_consent_records")
    .select("id", { count: "exact", head: true })
    .eq("facility_id", selectedFacilityId)
    .is("deleted_at", null);
  if (hubScope !== "all" && activityLower) cFamConsent = cFamConsent.gte("updated_at", activityLower);

  const [
    refList,
    admList,
    disList,
    triList,
    confList,
    pipeCt,
    admPendCt,
    admResCt,
    admMoveCt,
    disRevCt,
    famTriageCt,
    famConfCt,
    famConsentCt,
  ] = await Promise.all([
    refSel,
    admSel,
    disSel,
    triSel,
    confSel,
    cRefPipe,
    cAdmPend,
    cAdmRes,
    cAdmMove,
    cDisRev,
    cFamTriage,
    cFamConf,
    cFamConsent,
  ]);

  if (refList.error) throw refList.error;
  if (admList.error) throw admList.error;
  if (disList.error) throw disList.error;
  if (triList.error) throw triList.error;
  if (confList.error) throw confList.error;
  if (pipeCt.error) throw pipeCt.error;
  if (admPendCt.error) throw admPendCt.error;
  if (admResCt.error) throw admResCt.error;
  if (admMoveCt.error) throw admMoveCt.error;
  if (disRevCt.error) throw disRevCt.error;
  if (famTriageCt.error) throw famTriageCt.error;
  if (famConfCt.error) throw famConfCt.error;
  if (famConsentCt.error) throw famConsentCt.error;

  const admissions = (admList.data ?? []) as AdmissionsHubCaseRow[];
  const onboardingState = await loadOnboardingState(supabase, admissions);

  return {
    referrals: (refList.data ?? []) as AdmissionsHubLeadRow[],
    admissions,
    discharges: (disList.data ?? []) as AdmissionsHubDischargeRow[],
    triage: (triList.data ?? []) as AdmissionsHubTriageRow[],
    conferences: (confList.data ?? []) as AdmissionsHubConferenceRow[],
    onboardingState,
    referralMetrics: { activePipeline: pipeCt.count ?? 0 },
    admissionMetrics: {
      pending: admPendCt.count ?? 0,
      reserved: admResCt.count ?? 0,
      moveIn: admMoveCt.count ?? 0,
    },
    dischargeMetrics: { inReview: disRevCt.count ?? 0 },
    familyMetrics: {
      triage: famTriageCt.count ?? 0,
      conferences: famConfCt.count ?? 0,
      consentsPending: famConsentCt.count ?? 0,
    },
  };
}
