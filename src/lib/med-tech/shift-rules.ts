import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Med-Tech cockpit shift rules (COL-668, COL-681): what opens and closes a
 * med-tech's cockpit shift, per organization with per-facility overrides.
 * Rows are append only and effective-dated; a change is a new row.
 */
export type MedTechShiftOpenTrigger = "clock_in" | "none";
export type MedTechShiftCloseTrigger = "clock_out" | "none";

export type MedTechShiftRule = {
  id: string;
  organization_id: string;
  facility_id: string | null;
  open_trigger: MedTechShiftOpenTrigger;
  close_trigger: MedTechShiftCloseTrigger;
  effective_from: string;
  change_reason: string;
  created_at: string;
};

export const MED_TECH_SHIFT_OPEN_LABELS: Record<MedTechShiftOpenTrigger, string> = {
  clock_in: "Opens when the med-tech clocks in",
  none: "The time clock does not open it",
};

export const MED_TECH_SHIFT_CLOSE_LABELS: Record<MedTechShiftCloseTrigger, string> = {
  clock_out: "Closes when the med-tech clocks out",
  none: "The time clock does not close it",
};

/** Organization owners and admins set the default; facility admins set their building's override. */
export function canSetOrganizationShiftRule(appRole: string | null | undefined): boolean {
  return appRole === "owner" || appRole === "org_admin";
}

export function canSetFacilityShiftRule(appRole: string | null | undefined): boolean {
  return canSetOrganizationShiftRule(appRole) || appRole === "facility_admin";
}

/** The rule in force at a facility at an instant: the latest facility override, else the latest organization default. Mirrors haven.med_tech_shift_rule_at. */
export function medTechShiftRuleAt(
  rules: MedTechShiftRule[],
  facilityId: string,
  at: Date,
): MedTechShiftRule | null {
  const inForce = (scope: string | null) =>
    rules
      .filter((r) => r.facility_id === scope && Date.parse(r.effective_from) <= at.getTime())
      .sort((a, b) => Date.parse(b.effective_from) - Date.parse(a.effective_from))[0] ?? null;
  return inForce(facilityId) ?? inForce(null);
}

type RulesQuery = {
  from(table: "med_tech_shift_rules"): {
    select(columns: string): {
      eq(col: string, val: string): {
        or(filter: string): {
          order(col: string, opts: { ascending: boolean }): PromiseLike<{ data: MedTechShiftRule[] | null; error: { message: string } | null }>;
        };
      };
    };
    insert(row: Record<string, unknown>): PromiseLike<{ error: { message: string } | null }>;
  };
};

const RULE_COLUMNS = "id, organization_id, facility_id, open_trigger, close_trigger, effective_from, change_reason, created_at";

/** The organization default rows and this facility's override rows, newest first. */
export async function loadMedTechShiftRules(
  supabase: SupabaseClient,
  organizationId: string,
  facilityId: string,
): Promise<MedTechShiftRule[]> {
  const { data, error } = await (supabase as unknown as RulesQuery)
    .from("med_tech_shift_rules")
    .select(RULE_COLUMNS)
    .eq("organization_id", organizationId)
    .or(`facility_id.is.null,facility_id.eq.${facilityId}`)
    .order("effective_from", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export type NewMedTechShiftRule = {
  organizationId: string;
  facilityId: string | null;
  openTrigger: MedTechShiftOpenTrigger;
  closeTrigger: MedTechShiftCloseTrigger;
  effectiveFrom: Date;
  reason: string;
  createdBy: string;
};

export async function insertMedTechShiftRule(supabase: SupabaseClient, rule: NewMedTechShiftRule): Promise<void> {
  const reason = rule.reason.trim();
  if (!reason) throw new Error("Say why the rule is changing.");
  const { error } = await (supabase as unknown as RulesQuery).from("med_tech_shift_rules").insert({
    organization_id: rule.organizationId,
    facility_id: rule.facilityId,
    open_trigger: rule.openTrigger,
    close_trigger: rule.closeTrigger,
    effective_from: rule.effectiveFrom.toISOString(),
    change_reason: reason,
    created_by: rule.createdBy,
  });
  if (error) throw new Error(error.message);
}
