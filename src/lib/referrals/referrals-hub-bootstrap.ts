import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";

export const REFERRAL_UPCOMING_TOUR_LIMIT = 6;

export type ReferralLeadStatus = Database["public"]["Enums"]["referral_lead_status"];

export type ReferralsHubLeadRow = Pick<
  Database["public"]["Tables"]["referral_leads"]["Row"],
  | "id"
  | "first_name"
  | "last_name"
  | "status"
  | "updated_at"
  | "created_at"
  | "converted_at"
  | "email"
  | "phone"
  | "external_reference"
  | "notes"
> & {
  tour_scheduled_for: string | null;
  referral_sources: { name: string } | null;
};

export type ReferralsHubUpcomingTourRow = {
  id: string;
  first_name: string;
  last_name: string;
  status: ReferralLeadStatus;
  tour_scheduled_for: string | null;
};

export type ReferralsHandoffPhase = "blocked" | "ready" | "onboarding" | "complete";

export type ReferralsActiveAdmissionCase = {
  id: string;
  phase: ReferralsHandoffPhase;
};

type AdmissionMini = {
  id: string;
  referral_lead_id: string | null;
  status: string;
  resident_id: string;
  target_move_in_date: string | null;
  financial_clearance_at: string | null;
  physician_orders_received_at: string | null;
  bed_id: string | null;
};

export type ReferralsOutreachRow = {
  id: string;
  activity_type: string;
  status: string;
  scheduled_for: string | null;
  performed_for_week: string | null;
  external_partner_name: string | null;
  notes: string | null;
};

export type ReferralsHandoffRollup = {
  blocked: number;
  ready: number;
  onboarding: number;
};

export type ReferralsHubBootstrap = {
  rows: ReferralsHubLeadRow[];
  upcomingTours: ReferralsHubUpcomingTourRow[];
  outreachRows: ReferralsOutreachRow[];
  activeAdmissionCaseByLeadId: Record<string, ReferralsActiveAdmissionCase>;
  handoffRollup: ReferralsHandoffRollup;
  hl7Counts: { pending: number; failed: number };
};

export function emptyReferralsHubBootstrap(): ReferralsHubBootstrap {
  return {
    rows: [],
    upcomingTours: [],
    outreachRows: [],
    activeAdmissionCaseByLeadId: {},
    handoffRollup: { blocked: 0, ready: 0, onboarding: 0 },
    hl7Counts: { pending: 0, failed: 0 },
  };
}

type ReferralsQueryResult<T> = { data: T | null; error: { message: string } | null };

export async function loadReferralsHubBootstrap(
  selectedFacilityId: string | null,
  supabase: SupabaseClient<Database> = createClient(),
): Promise<ReferralsHubBootstrap> {
  if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
    return emptyReferralsHubBootstrap();
  }

  const nowIso = new Date().toISOString();

  const [
    { data: list, error: listErr },
    { data: outreachList, error: outreachErr },
    { data: upcomingTourList, error: upcomingToursErr },
  ] = await Promise.all([
    supabase
      .from("referral_leads" as never)
      .select(
        "id, first_name, last_name, status, updated_at, created_at, converted_at, email, phone, external_reference, notes, tour_scheduled_for, referral_sources(name)",
      )
      .eq("facility_id", selectedFacilityId)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false }) as unknown as Promise<
      ReferralsQueryResult<ReferralsHubLeadRow[]>
    >,
    supabase
      .from("referral_outreach_activities" as never)
      .select("id, activity_type, status, scheduled_for, performed_for_week, external_partner_name, notes")
      .eq("facility_id", selectedFacilityId)
      .is("deleted_at", null)
      .order("scheduled_for", { ascending: false })
      .limit(48) as unknown as Promise<ReferralsQueryResult<ReferralsOutreachRow[]>>,
    supabase
      .from("referral_leads" as never)
      .select("id, first_name, last_name, status, tour_scheduled_for")
      .eq("facility_id", selectedFacilityId)
      .is("deleted_at", null)
      .not("status", "in", "(lost,merged)")
      .not("tour_scheduled_for", "is", null)
      .gte("tour_scheduled_for", nowIso)
      .order("tour_scheduled_for", { ascending: true })
      .limit(REFERRAL_UPCOMING_TOUR_LIMIT) as unknown as Promise<
      ReferralsQueryResult<ReferralsHubUpcomingTourRow[]>
    >,
  ]);

  if (listErr) throw listErr;
  if (outreachErr) throw outreachErr;
  if (upcomingToursErr) throw upcomingToursErr;

  const leadRows = list ?? [];
  const outreachRows = outreachList ?? [];
  const upcomingTours = upcomingTourList ?? [];

  let handoffBlocked = 0;
  let handoffReady = 0;
  let handoffOnboarding = 0;

  const { data: admissionCases, error: admissionErr } = await supabase
    .from("admission_cases")
    .select(
      "id, referral_lead_id, status, resident_id, target_move_in_date, financial_clearance_at, physician_orders_received_at, bed_id",
    )
    .eq("facility_id", selectedFacilityId)
    .is("deleted_at", null)
    .not("status", "eq", "cancelled");

  if (admissionErr) throw admissionErr;

  const admissionRows = (admissionCases ?? []) as AdmissionMini[];
  const residentIds = Array.from(
    new Set(
      admissionRows
        .map((row) => row.resident_id)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    ),
  );

  const [carePlansRes, medsRes, payersRes, consentsRes] =
    residentIds.length > 0
      ? await Promise.all([
          supabase.from("care_plans").select("resident_id").in("resident_id", residentIds).is("deleted_at", null),
          supabase.from("resident_medications").select("resident_id").in("resident_id", residentIds).is("deleted_at", null),
          supabase.from("resident_payers").select("resident_id").in("resident_id", residentIds).is("deleted_at", null),
          supabase.from("family_consent_records").select("resident_id").in("resident_id", residentIds).is("deleted_at", null),
        ])
      : [
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
        ];

  if (carePlansRes.error) throw carePlansRes.error;
  if (medsRes.error) throw medsRes.error;
  if (payersRes.error) throw payersRes.error;
  if (consentsRes.error) throw consentsRes.error;

  const carePlanIds = new Set((carePlansRes.data ?? []).map((row) => row.resident_id));
  const medIds = new Set((medsRes.data ?? []).map((row) => row.resident_id));
  const payerIds = new Set((payersRes.data ?? []).map((row) => row.resident_id));
  const consentIds = new Set((consentsRes.data ?? []).map((row) => row.resident_id));

  const activeAdmissionCaseByLeadId = Object.fromEntries(
    admissionRows
      .filter((row) => !!row.referral_lead_id)
      .map((row) => {
        let phase: ReferralsHandoffPhase = "complete";
        const blocked =
          !row.financial_clearance_at ||
          !row.physician_orders_received_at ||
          !row.bed_id ||
          !row.target_move_in_date;
        if (blocked) {
          phase = "blocked";
          handoffBlocked += 1;
        } else if (row.status !== "move_in") {
          phase = "ready";
          handoffReady += 1;
        } else {
          const onboardingMissing =
            !carePlanIds.has(row.resident_id) ||
            !medIds.has(row.resident_id) ||
            !payerIds.has(row.resident_id) ||
            !consentIds.has(row.resident_id);
          if (onboardingMissing) {
            phase = "onboarding";
            handoffOnboarding += 1;
          }
        }
        return [row.referral_lead_id as string, { id: row.id, phase }] as const;
      }),
  );

  const hl7Base = () =>
    supabase
      .from("referral_hl7_inbound")
      .select("id", { count: "exact", head: true })
      .eq("facility_id", selectedFacilityId)
      .is("deleted_at", null);

  const [hl7Pending, hl7Failed] = await Promise.all([
    hl7Base().eq("status", "pending"),
    hl7Base().eq("status", "failed"),
  ]);

  return {
    rows: leadRows,
    upcomingTours,
    outreachRows,
    activeAdmissionCaseByLeadId,
    handoffRollup: {
      blocked: handoffBlocked,
      ready: handoffReady,
      onboarding: handoffOnboarding,
    },
    hl7Counts: {
      pending: hl7Pending.count ?? 0,
      failed: hl7Failed.count ?? 0,
    },
  };
}
