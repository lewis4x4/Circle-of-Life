import type { SupabaseClient } from "@supabase/supabase-js";

import { formatReviewsDueResidentLabel } from "@/lib/care-plans/reviews-due-display-copy";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";

import type { Form1823DraftSource } from "./draft-from-form-1823";
import {
  alignForm1823WithPlan,
  form1823AgeState,
  formatForm1823AgeLabel,
  type AlignmentPlanItem,
  type AlignmentSummary,
  type Form1823AgeState,
} from "./form-1823-alignment";

/**
 * What the comparison could conclude for one resident. Each state is a
 * different kind of fact, so the page never shows "0 gaps" for a resident
 * whose plan was never compared to anything.
 *
 * - `cannot_assess`: no current, received Form 1823 is recorded in Haven, so
 *   there is nothing to compare the plan against.
 * - `no_plan`: a 1823 is recorded but there is no active plan to compare.
 * - `gaps`: the active plan leaves one or more 1823 needs unanswered or
 *   answers them more weakly than the form says.
 * - `answered`: every need the 1823 assesses is answered by the active plan.
 */
export type Form1823RowAlignmentState = "cannot_assess" | "no_plan" | "gaps" | "answered";

export type Form1823RowForm = {
  id: string;
  examDate: string | null;
  expirationDate: string | null;
  age: Form1823AgeState;
  /** "Exam Sep 4, 2026", plus the rule breached when one is. */
  ageLabel: string;
};

export type Form1823RowAction = {
  /** Visible label; names the operation the link performs. */
  label: string;
  href: string;
};

export type Form1823AlignmentRosterRow = {
  residentId: string;
  residentName: string;
  /** null when no current, received 1823 is recorded in Haven. */
  form1823: Form1823RowForm | null;
  plan: { id: string; version: number | null } | null;
  alignment: Form1823RowAlignmentState;
  /** Per-need tallies from the comparison; null when nothing was compared. */
  summary: AlignmentSummary | null;
  /** The needs the plan does not answer, or answers more weakly. */
  gaps: string[];
  /** The most recent open admission case, if the resident has one to record a 1823 against. */
  admissionCaseId: string | null;
  action: Form1823RowAction;
};

export type Form1823AlignmentCounts = {
  /** Denominator for every other count: current residents in scope. */
  residents: number;
  /** No current, received Form 1823 recorded in Haven. */
  noForm1823: number;
  /** No active care plan, counted across every resident in scope. */
  noPlan: number;
  /** Rows whose alignment is `cannot_assess`. Equal to `noForm1823` by definition. */
  cannotAssess: number;
  /** Residents whose 1823 and active plan were actually compared (`gaps` + `answered`). */
  compared: number;
  withGaps: number;
  answered: number;
  /** Recorded 1823 whose own expiration date has passed. */
  expiredForm1823: number;
  /** Recorded 1823 whose exam is older than the three-year ceiling (and not already expired by date). */
  overAgeForm1823: number;
};

export type Form1823AlignmentRoster = {
  rows: Form1823AlignmentRosterRow[];
  counts: Form1823AlignmentCounts;
};

export type RosterResident = { id: string; first_name: string | null; last_name: string | null };
export type RosterForm = Form1823DraftSource & { resident_id: string; expiration_date: string | null; is_current: boolean; status: string | null };
export type RosterPlan = { id: string; resident_id: string; version: number | null };
export type RosterItem = AlignmentPlanItem & { care_plan_id: string };
export type RosterAdmissionCase = { id: string; resident_id: string; status: string | null; created_at: string | null };

type QueryError = { message: string };
type QueryListResult<T> = { data: T[] | null; error: QueryError | null };

const FORM_COLUMNS =
  "id, resident_id, exam_date, expiration_date, physician_name, examiner_title, allergies, prescribed_diet, medication_assistance, elopement_risk, adl_bathing, adl_dressing, adl_eating, adl_transferring, adl_toileting, adl_grooming, adl_walking, condition_pressure_injury, physical_limitations, cognitive_behavioral_status, service_requirements, precautions, is_current, status";

const EMPTY_COUNTS: Form1823AlignmentCounts = {
  residents: 0,
  noForm1823: 0,
  noPlan: 0,
  cannotAssess: 0,
  compared: 0,
  withGaps: 0,
  answered: 0,
  expiredForm1823: 0,
  overAgeForm1823: 0,
};

function easternDateString(d = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Where the row's action goes and what it is called. The label names the
 * operation the destination actually supports; nothing is promised that the
 * destination cannot do.
 */
export function resolveForm1823RowAction(input: {
  residentId: string;
  hasForm: boolean;
  hasPlan: boolean;
  admissionCaseId: string | null;
}): Form1823RowAction {
  if (input.hasForm) {
    return {
      label: input.hasPlan ? "Review alignment" : "Open care plan",
      href: `/admin/residents/${input.residentId}/care-plan`,
    };
  }
  if (input.admissionCaseId) {
    return { label: "Record Form 1823", href: `/admin/admissions/${input.admissionCaseId}` };
  }
  return { label: "Open resident", href: `/admin/residents/${input.residentId}` };
}

/** The most recent case that is still open; failing that, the most recent of any status. */
function pickAdmissionCase(cases: RosterAdmissionCase[]): RosterAdmissionCase | null {
  if (cases.length === 0) return null;
  const sorted = [...cases].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  return sorted.find((c) => c.status !== "cancelled") ?? sorted[0];
}

/** Pure: residents × current 1823 × active plan → one roster row each. Residents with the most to fix sort first. */
export function buildForm1823AlignmentRoster(input: {
  residents: RosterResident[];
  forms: RosterForm[];
  plans: RosterPlan[];
  items: RosterItem[];
  admissionCases?: RosterAdmissionCase[];
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
  const casesByResident = new Map<string, RosterAdmissionCase[]>();
  for (const admissionCase of input.admissionCases ?? []) {
    const list = casesByResident.get(admissionCase.resident_id) ?? [];
    list.push(admissionCase);
    casesByResident.set(admissionCase.resident_id, list);
  }

  const rows: Form1823AlignmentRosterRow[] = input.residents.map((resident) => {
    const form = formByResident.get(resident.id) ?? null;
    const planRow = planByResident.get(resident.id) ?? null;
    const plan = planRow ? { id: planRow.id, version: planRow.version } : null;
    const admissionCaseId = pickAdmissionCase(casesByResident.get(resident.id) ?? [])?.id ?? null;
    const action = resolveForm1823RowAction({ residentId: resident.id, hasForm: form !== null, hasPlan: plan !== null, admissionCaseId });
    const base = { residentId: resident.id, residentName: formatReviewsDueResidentLabel(resident), plan, admissionCaseId, action };

    if (!form) {
      return { ...base, form1823: null, alignment: "cannot_assess", summary: null, gaps: [] };
    }
    const form1823: Form1823RowForm = {
      id: form.id,
      examDate: form.exam_date,
      expirationDate: form.expiration_date,
      age: form1823AgeState(form.exam_date, form.expiration_date, input.today),
      ageLabel: formatForm1823AgeLabel(form.exam_date, form.expiration_date, input.today),
    };
    if (!plan) {
      return { ...base, form1823, alignment: "no_plan", summary: null, gaps: [] };
    }
    const { rows: needs, summary } = alignForm1823WithPlan(form, itemsByPlan.get(plan.id) ?? []);
    const gaps = needs.filter((n) => n.state === "not_addressed" || n.state === "weaker").map((n) => n.need);
    return { ...base, form1823, alignment: gaps.length > 0 ? "gaps" : "answered", summary, gaps };
  });

  const formStale = (row: Form1823AlignmentRosterRow) => row.form1823 !== null && (row.form1823.age === "expired" || row.form1823.age === "over_age");
  const severity = (row: Form1823AlignmentRosterRow) =>
    row.alignment === "cannot_assess" ? 3 : row.alignment === "no_plan" ? 2 : row.alignment === "gaps" || formStale(row) ? 1 : 0;
  rows.sort((a, b) => severity(b) - severity(a) || b.gaps.length - a.gaps.length || a.residentName.localeCompare(b.residentName));

  return {
    rows,
    counts: {
      residents: rows.length,
      noForm1823: rows.filter((r) => r.form1823 === null).length,
      noPlan: rows.filter((r) => r.plan === null).length,
      cannotAssess: rows.filter((r) => r.alignment === "cannot_assess").length,
      compared: rows.filter((r) => r.alignment === "gaps" || r.alignment === "answered").length,
      withGaps: rows.filter((r) => r.alignment === "gaps").length,
      answered: rows.filter((r) => r.alignment === "answered").length,
      expiredForm1823: rows.filter((r) => r.form1823?.age === "expired").length,
      overAgeForm1823: rows.filter((r) => r.form1823?.age === "over_age").length,
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
  if (residents.length === 0) return { rows: [], counts: { ...EMPTY_COUNTS } };
  const residentIds = residents.map((r) => r.id);

  const [formsRes, plansRes, casesRes] = (await Promise.all([
    supabase.from("form_1823_records" as never).select(FORM_COLUMNS).in("resident_id", residentIds).eq("is_current", true).is("deleted_at", null),
    supabase.from("care_plans" as never).select("id, resident_id, version").in("resident_id", residentIds).eq("status", "active").is("deleted_at", null),
    supabase.from("admission_cases" as never).select("id, resident_id, status, created_at").in("resident_id", residentIds).is("deleted_at", null),
  ])) as unknown as [QueryListResult<RosterForm>, QueryListResult<RosterPlan>, QueryListResult<RosterAdmissionCase>];
  if (formsRes.error) throw formsRes.error;
  if (plansRes.error) throw plansRes.error;
  if (casesRes.error) throw casesRes.error;
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

  return buildForm1823AlignmentRoster({
    residents,
    forms: formsRes.data ?? [],
    plans,
    items,
    admissionCases: casesRes.data ?? [],
    today: easternDateString(),
  });
}
