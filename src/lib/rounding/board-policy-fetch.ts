import type { SupabaseClient } from "@supabase/supabase-js";

import type { EscalationRungOffset, ObservationBoardPolicy } from "@/lib/rounding/update-task-status";

/**
 * The two configuration reads the board needs to say what a check reads as.
 *
 * Both run on the caller's authority. `facility_observation_thresholds` and
 * `facility_escalation_rungs` each carry a facility scoped SELECT policy, so a
 * reader who can reach one building gets one building's answer.
 *
 * This file exists so that no surface holds a display band. Decision D2 put
 * every observation time, grace value, escalation offset and threshold in a
 * row; a board that reads a status band from a constant is the same defect one
 * layer up, and it was a live one until Part 8: the board recomputed
 * `critically_overdue` from `120` while the engine wrote it from whatever
 * offset the escalation version in force carried.
 */

type ThresholdRow = { task_upcoming_lead_minutes: number };

type RungRow = {
  offset_minutes: number;
  is_terminal: boolean;
  assigned_staff_only: boolean;
};

export class ObservationBoardPolicyMissing extends Error {
  constructor(
    readonly facilityId: string,
    readonly reason: "no_thresholds" | "no_escalation_version",
    readonly postgrestCode: string | null,
  ) {
    super(
      reason === "no_thresholds"
        ? `facility ${facilityId} has no observation thresholds row`
        : `facility ${facilityId} has no escalation version in force`,
    );
    this.name = "ObservationBoardPolicyMissing";
  }
}

/**
 * Reads the board policy for one facility at one instant.
 *
 * Raises rather than substituting a default. A building with no thresholds row
 * or no escalation version in force is a configuration gap, and a board that
 * quietly invents bands for it is how the retired constants survived a
 * migration that was supposed to remove them. The caller renders the gap.
 */
export async function fetchObservationBoardPolicy(
  supabase: SupabaseClient,
  facilityId: string,
  at: Date = new Date(),
): Promise<ObservationBoardPolicy> {
  const thresholds = await supabase
    .from("facility_observation_thresholds")
    .select("task_upcoming_lead_minutes")
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .maybeSingle<ThresholdRow>();
  if (thresholds.error || !thresholds.data) {
    throw new ObservationBoardPolicyMissing(facilityId, "no_thresholds", thresholds.error?.code ?? null);
  }

  // The same resolver the escalation engine uses, so the board cannot answer
  // from a version the engine is not firing.
  const version = await supabase.rpc("facility_escalation_in_force", {
    p_facility_id: facilityId,
    p_at: at.toISOString(),
  });
  const versionId = typeof version.data === "string" ? version.data : null;
  if (version.error || !versionId) {
    throw new ObservationBoardPolicyMissing(facilityId, "no_escalation_version", version.error?.code ?? null);
  }

  const rungs = await supabase
    .from("facility_escalation_rungs")
    .select("offset_minutes, is_terminal, assigned_staff_only")
    .eq("escalation_version_id", versionId)
    .eq("enabled", true)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .returns<RungRow[]>();
  if (rungs.error) {
    throw new ObservationBoardPolicyMissing(facilityId, "no_escalation_version", rungs.error.code ?? null);
  }

  const offsets: EscalationRungOffset[] = (rungs.data ?? []).map((row) => ({
    offsetMinutes: row.offset_minutes,
    isTerminal: row.is_terminal,
    assignedStaffOnly: row.assigned_staff_only,
  }));

  return {
    upcomingLeadMinutes: thresholds.data.task_upcoming_lead_minutes,
    rungs: offsets,
  };
}

/**
 * How concerning a documentation lag is at this building, in minutes.
 *
 * Separate from the board policy because the Integrity surface needs only
 * these two and must not fail its whole tab over an escalation version. Spec
 * 25A section 6.2, `facility_observation_thresholds`.
 */
export type DocumentationLagThresholds = {
  notableMinutes: number;
  seriousMinutes: number;
};

type LagRow = {
  documentation_lag_notable_minutes: number;
  documentation_lag_serious_minutes: number;
};

/**
 * Reads the documentation lag thresholds, or answers null when the building has
 * no row.
 *
 * Null rather than a fallback pair, deliberately. There is no defensible
 * default for "how late is concerning at this building", and the surface that
 * calls this renders an unconfigured lag in a neutral tone and names the gap.
 * A hardcoded pair here would put the numbers back where Part 8 took them out
 * of, one layer down.
 */
export async function fetchDocumentationLagThresholds(
  supabase: SupabaseClient,
  facilityId: string,
): Promise<DocumentationLagThresholds | null> {
  const { data, error } = await supabase
    .from("facility_observation_thresholds")
    .select("documentation_lag_notable_minutes, documentation_lag_serious_minutes")
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .maybeSingle<LagRow>();
  if (error || !data) return null;
  return {
    notableMinutes: data.documentation_lag_notable_minutes,
    seriousMinutes: data.documentation_lag_serious_minutes,
  };
}
