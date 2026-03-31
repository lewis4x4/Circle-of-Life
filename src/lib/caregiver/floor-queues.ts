/** When `resident_medications.prn_effectiveness_check_minutes` is null or invalid. */
export const DEFAULT_PRN_REASSESS_MINUTES = 60;

export function prnReassessmentDueAt(actualTimeIso: string, checkMinutes: number | null): Date {
  const m =
    checkMinutes != null && Number.isFinite(checkMinutes) && checkMinutes > 0
      ? checkMinutes
      : DEFAULT_PRN_REASSESS_MINUTES;
  return new Date(new Date(actualTimeIso).getTime() + m * 60_000);
}

export function conditionChangeTypeLabel(value: string): string {
  const map: Record<string, string> = {
    vitals: "Vitals / measurements",
    pain: "Pain",
    respiratory: "Respiratory",
    skin_wound: "Skin / wound",
    mental_status: "Mental status / cognition",
    gi: "GI / appetite",
    urinary: "Urinary",
    neurologic: "Neurologic",
    other: "Other",
  };
  return map[value] ?? value.replace(/_/g, " ");
}

/** Roles that may update any eMAR row per RLS (administered_by not required). */
export function canUpdateAnyEmarRecord(appRole: string | null | undefined): boolean {
  if (!appRole) return false;
  return ["owner", "org_admin", "facility_admin", "nurse"].includes(appRole);
}
