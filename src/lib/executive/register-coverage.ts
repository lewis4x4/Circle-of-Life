import type { SupabaseClient } from "@supabase/supabase-js";

import {
  metricLoading,
  metricNoData,
  metricValue,
  type MetricState,
} from "@/lib/metrics/metric-state";
import type { Database } from "@/types/database";

/**
 * Whether the registers behind the officer boards' counts have ever been used
 * in scope (COL-649). "Open deficiencies 0", "Med errors 0" and "Active
 * outbreaks 0" read as facts, but on 2026-09-22 production had no survey
 * deficiency, medication error or outbreak record at all — the registers were
 * never filled in, so a zero said nothing. `null` means the check itself
 * failed; the count is then shown as read.
 */
export type ExecRegisterCoverage = {
  surveyDeficienciesRecorded: boolean | null;
  medicationErrorsRecorded: boolean | null;
  outbreaksRecorded: boolean | null;
  /** Open Smart Rounding escalations (open / in progress); null when unreadable. */
  openRoundingEscalations: number | null;
};

export const REGISTER_NEVER_USED_COPY = "Nothing recorded yet";

type HeadCount = { count: number | null; error: unknown };

export async function fetchExecRegisterCoverage(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  scope: { facilityId: string } | { facilityIds: string[] },
): Promise<ExecRegisterCoverage> {
  const head = (table: string, statuses?: string[]) => {
    let query = supabase
      .from(table as never)
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .is("deleted_at", null);
    query = "facilityId" in scope ? query.eq("facility_id", scope.facilityId) : query.in("facility_id", scope.facilityIds);
    if (statuses) query = query.in("status", statuses);
    return query.limit(1) as unknown as PromiseLike<HeadCount>;
  };
  const [deficiencies, medErrors, outbreaks, escalations] = await Promise.all([
    head("survey_deficiencies"),
    head("medication_errors"),
    head("infection_outbreaks"),
    head("resident_observation_escalations", ["open", "in_progress"]),
  ]);
  const recorded = (reply: HeadCount) =>
    reply.error || typeof reply.count !== "number" ? null : reply.count > 0;
  return {
    surveyDeficienciesRecorded: recorded(deficiencies),
    medicationErrorsRecorded: recorded(medErrors),
    outbreaksRecorded: recorded(outbreaks),
    openRoundingEscalations:
      escalations.error || typeof escalations.count !== "number" ? null : escalations.count,
  };
}

/**
 * Officer tile state for a register-backed count: a count from a register that
 * has never held a record is "Nothing recorded yet", not 0.
 */
export function registerCountState(input: {
  loading: boolean;
  count: number | undefined;
  registerRecorded: boolean | null | undefined;
}): MetricState<number> | null {
  if (input.loading) return metricLoading();
  if (input.count == null) return null;
  if (input.registerRecorded === false) return metricNoData(REGISTER_NEVER_USED_COPY);
  return metricValue(input.count);
}
