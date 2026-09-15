import type { SupabaseClient } from "@supabase/supabase-js";

import { formatReviewsDueResidentLabel } from "@/lib/care-plans/reviews-due-display-copy";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";

import type { Form1823DraftSource } from "./draft-from-form-1823";
import { alignForm1823WithPlan, form1823AgeState, formatForm1823AgeLabel, type AlignmentPlanItem, type AlignmentSummary } from "./form-1823-alignment";

export type Form1823AlignmentRosterRow = {
  residentId: string;
  residentName: string;
  /** null when the resident has no current, received 1823 at all. */
  form1823: { id: string; examDate: string | null; ageLabel: string; expired: boolean } | null;
  planId: string | null;
  planVersion: number | null;
  summary: AlignmentSummary | null;
  /** The needs the plan does not answer, or answers more weakly. */
  gaps: string[];
};

export type Form1823AlignmentRoster = {
  rows: Form1823AlignmentRosterRow[];
  counts: { residents: number; noForm1823: number; noPlan: number; withGaps: number; expiredForm1823: number };
};

export type RosterResident = { id: string; first_name: string | null; last_name: string | null };
export type RosterForm = Form1823DraftSource & { resident_id: string; expiration_date: string | null; is_current: boolean; status: string | null };
export type RosterPlan = { id: string; resident_id: string; version: number | null };
export type RosterItem = AlignmentPlanItem & { care_plan_id: string };

type QueryError = { message: string };
type QueryListResult<T> = { data: T[] | null; error: QueryError | null };

const FORM_COLUMNS =
  "id, resident_id, exam_date, expiration_date, physician_name, examiner_title, allergies, prescribed_diet, medication_assistance, elopement_risk, adl_bathing, adl_dressing, adl_eating, adl_transferring, adl_toileting, adl_grooming, adl_walking, condition_pressure_injury, physical_limitations, cognitive_behavioral_status, service_requirements, precautions, is_current, status";

function easternDateString(d = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Pure: residents × current 1823 × active plan → one roster row each. Residents with the most to fix sort first. */
export function buildForm1823AlignmentRoster(input: {
  residents: RosterResident[];
  forms: RosterForm[];
  plans: RosterPlan[];
  items: RosterItem[];
  today: string;
}): Form1823AlignmentRoster {
  const formByResident = new Map<string, RosterForm>();
  for (const form of input.forms) {
    if (!form.is_current || form.status !== "received") continue;
    const prior = formByResident.get(form.resident_id);
    if (!prior || (form.exam_date ?? "") > (prior.exam_date ?? "")) formByResident.set(form.resident_id, form);
  }
  const planByResident = new Map(input.plans.map((plan) => [plan.resident_id, plan] as const));
  const itemsByPlan = new Map<string, AlignmentPlanItem[]>();
  for (const item of input.items) {
    const list = itemsByPlan.get(item.care_plan_id) ?? [];
    list.push(item);
    itemsByPlan.set(item.care_plan_id, list);
  }

  const rows: Form1823AlignmentRosterRow[] = input.residents.map((resident) => {
    const form = formByResident.get(resident.id) ?? null;
    const plan = planByResident.get(resident.id) ?? null;
    if (!form) {
      return { residentId: resident.id, residentName: formatReviewsDueResidentLabel(resident), form1823: null, planId: plan?.id ?? null, planVersion: plan?.version ?? null, summary: null, gaps: [] };
    }
    const { rows: needs, summary } = alignForm1823WithPlan(form, plan ? itemsByPlan.get(plan.id) ?? [] : null);
    return {
      residentId: resident.id,
      residentName: formatReviewsDueResidentLabel(resident),
      form1823: {
        id: form.id,
        examDate: form.exam_date,
        ageLabel: formatForm1823AgeLabel(form.exam_date, form.expiration_date, input.today),
        expired: form1823AgeState(form.exam_date, form.expiration_date, input.today) === "expired",
      },
      planId: plan?.id ?? null,
      planVersion: plan?.version ?? null,
      summary,
      gaps: needs.filter((n) => n.state === "not_addressed" || n.state === "weaker").map((n) => n.need),
    };
  });

  const severity = (row: Form1823AlignmentRosterRow) =>
    row.form1823 === null ? 3 : row.summary?.noPlan ? 2 : row.gaps.length > 0 || row.form1823.expired ? 1 : 0;
  rows.sort((a, b) => severity(b) - severity(a) || b.gaps.length - a.gaps.length || a.residentName.localeCompare(b.residentName));

  return {
    rows,
    counts: {
      residents: rows.length,
      noForm1823: rows.filter((r) => r.form1823 === null).length,
      noPlan: rows.filter((r) => r.form1823 !== null && r.summary?.noPlan).length,
      withGaps: rows.filter((r) => r.gaps.length > 0).length,
      expiredForm1823: rows.filter((r) => r.form1823?.expired).length,
    },
  };
}

export async function fetchForm1823AlignmentRoster(
  selectedFacilityId: string | null,
  supabase: SupabaseClient<Database> = createClient(),
): Promise<Form1823AlignmentRoster> {
  const facilityScoped = isValidFacilityIdForQuery(selectedFacilityId);

  let residentsQuery = supabase
    .from("residents" as never)
    .select("id, first_name, last_name")
    .is("deleted_at", null)
    .in("status", ["active", "hospital_hold", "loa"])
    .limit(500);
  if (facilityScoped) residentsQuery = residentsQuery.eq("facility_id", selectedFacilityId);
  const residentsRes = (await residentsQuery) as unknown as QueryListResult<RosterResident>;
  if (residentsRes.error) throw residentsRes.error;
  const residents = residentsRes.data ?? [];
  if (residents.length === 0) return { rows: [], counts: { residents: 0, noForm1823: 0, noPlan: 0, withGaps: 0, expiredForm1823: 0 } };
  const residentIds = residents.map((r) => r.id);

  const [formsRes, plansRes] = (await Promise.all([
    supabase.from("form_1823_records" as never).select(FORM_COLUMNS).in("resident_id", residentIds).eq("is_current", true).is("deleted_at", null),
    supabase.from("care_plans" as never).select("id, resident_id, version").in("resident_id", residentIds).eq("status", "active").is("deleted_at", null),
  ])) as unknown as [QueryListResult<RosterForm>, QueryListResult<RosterPlan>];
  if (formsRes.error) throw formsRes.error;
  if (plansRes.error) throw plansRes.error;
  const plans = plansRes.data ?? [];

  let items: RosterItem[] = [];
  if (plans.length > 0) {
    const itemsRes = (await supabase
      .from("care_plan_items" as never)
      .select("care_plan_id, category, title, assistance_level")
      .in("care_plan_id", plans.map((p) => p.id))
      .eq("is_active", true)
      .is("deleted_at", null)) as unknown as QueryListResult<RosterItem>;
    if (itemsRes.error) throw itemsRes.error;
    items = itemsRes.data ?? [];
  }

  return buildForm1823AlignmentRoster({ residents, forms: formsRes.data ?? [], plans, items, today: easternDateString() });
}
