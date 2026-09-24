import type { Database } from "@/types/database";
import { enumLabel } from "@/lib/display/enum-label";

/**
 * Official discharge — the one write path that ends a residency.
 *
 * "Official" means belongings are out and the resident is off census. It is the
 * billing cutoff, and it is the event that frees the bed: clearing
 * `residents.bed_id` and setting a status that no longer holds a bed lets the
 * `tr_residents_sync_bed_occupancy` trigger (migration 388) move the bed back to
 * `available`. `haven.resident_status_holds_bed()` holds a bed for `active`,
 * `hospital_hold` and `loa`, and releases it for `discharged` and `deceased`.
 *
 * This module exists because that action used to live only inside the discharge
 * medication-reconciliation screen, which is hidden from staff menus for the
 * first rollout (COL-418). Reconciling medications is a clinical task that
 * follows a discharge; it is not the way a bed becomes available. Both surfaces
 * now build the same patch here so they cannot drift.
 *
 * Presence is deliberately not part of this: `ResidentPresenceControl` moves a
 * resident between the three in-census states and cannot end a residency.
 */

export type DischargeReason = Database["public"]["Enums"]["discharge_reason"];
export type DischargeLifecycleStatus = Extract<
  Database["public"]["Enums"]["resident_status"],
  "discharged" | "deceased"
>;

export const DISCHARGE_REASONS: DischargeReason[] = [
  "resident_voluntary",
  "facility_with_cause",
  "facility_immediate",
  "medicaid_relocation",
  "higher_level_of_care",
  "hospital_permanent",
  "another_alf",
  "home",
  "death",
  "non_payment",
  "behavioral",
  "other",
];

/** Operator wording for a reason; the enum value is never shown raw. */
export function dischargeReasonLabel(reason: DischargeReason): string {
  return enumLabel(reason);
}

/**
 * A death is recorded as `deceased`, not `discharged`. Both release the bed,
 * but the record has to say which one happened.
 */
export function dischargeStatusForReason(reason: DischargeReason): DischargeLifecycleStatus {
  return reason === "death" ? "deceased" : "discharged";
}

/** A residency that has already ended cannot be ended again. */
export function isAlreadyDischarged(status: string | null | undefined): boolean {
  return status === "discharged" || status === "deceased";
}

/**
 * What the operator still has to supply. The date is not defaulted anywhere:
 * it is a billing cutoff, and a pre-filled today is a decision the form would be
 * making on the administrator's behalf.
 */
export function validateOfficialDischarge(input: { date: string; reason: DischargeReason | "" }): string[] {
  const problems: string[] = [];
  if (!input.date.trim()) problems.push("Choose the date belongings were removed.");
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date.trim())) problems.push("Enter the discharge date as a calendar date.");
  if (!input.reason) problems.push("Choose the discharge reason.");
  return problems;
}

/**
 * The residents patch. `bed_id: null` and the released status are the two
 * halves of freeing the bed; neither is optional, and the database trigger does
 * the rest rather than any caller remembering to update `beds`.
 */
export function officialDischargePatch(input: {
  reason: DischargeReason;
  date: string;
  destination?: string | null;
  actorId: string | null;
  now?: Date;
}): Record<string, unknown> {
  return {
    status: dischargeStatusForReason(input.reason),
    discharge_date: input.date,
    discharge_reason: input.reason,
    discharge_destination: input.destination?.trim() ? input.destination.trim() : null,
    bed_id: null,
    updated_at: (input.now ?? new Date()).toISOString(),
    updated_by: input.actorId,
  };
}

/** Confirmation wording, so both surfaces say the same thing about what happened. */
export function officialDischargeReceipt(reason: DischargeReason): string {
  return dischargeStatusForReason(reason) === "deceased"
    ? "Recorded. The resident is off census and the bed is released."
    : "Discharge recorded. The resident is off census, the bed is released, and billing stops on this date.";
}
