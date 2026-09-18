/**
 * Copy for the facility level Monitoring Orders list.
 *
 * Operator vocabulary, per spec decision D4: it is a Monitoring Order, never a
 * watch. No raw enum value renders: `status`, `ordered_by_type`,
 * `order_received_as` and `reason_category` all arrive as codes and leave as
 * sentences, and an unrecognized code reads as a gap rather than leaking
 * itself onto the screen (defect 3).
 */

import { resolveRoundingFacilityScope } from "@/lib/rounding/rounding-scope-copy";
import type { RoundingFacilityScope } from "@/lib/rounding/rounding-scope-copy";
import type { MonitoringOrderResident } from "@/lib/rounding/monitoring-orders-list";

export { resolveRoundingFacilityScope };
export type { RoundingFacilityScope };

const STATUS_LABELS: Record<string, string> = {
  active: "In force",
  completed: "Completed",
  cancelled: "Cancelled",
  expired: "Ended",
};

export function monitoringOrderStatusLabel(status: string | null | undefined): string {
  const trimmed = status?.trim();
  if (!trimmed) return "No status posted";
  return STATUS_LABELS[trimmed] ?? "No status posted";
}

export function monitoringOrdersSubtitle(scope: RoundingFacilityScope): string {
  const base =
    "Residents on a cadence a clinician ordered, and the orders that have closed";
  if (scope.kind === "unscoped") {
    return `${base}. Orders are per building. Select a facility first.`;
  }
  if (scope.kind === "missing_name") {
    return `${base}. No facility name posted.`;
  }
  return `${base} at ${scope.name}. Entering one happens on the resident record.`;
}

export function monitoringOrderResidentName(
  resident: MonitoringOrderResident | undefined,
): string {
  const first = (resident?.preferred_name ?? resident?.first_name)?.trim() ?? "";
  const last = resident?.last_name?.trim() ?? "";
  const combined = `${first} ${last}`.trim();
  return combined || "No resident posted";
}

export function monitoringOrderRoomLabel(
  resident: MonitoringOrderResident | undefined,
): string {
  const room = resident?.beds?.rooms?.room_number?.trim();
  return room ? `Room ${room}` : "No room posted";
}

/** Who keyed it in, which is a different person from who ordered it. */
export function monitoringOrderEnteredByLabel(fullName: string | null | undefined): string {
  const trimmed = fullName?.trim();
  return trimmed ? `Entered by ${trimmed}` : "Entered by an account with no name posted";
}

export const MONITORING_ORDERS_EMPTY_ACTIVE = {
  why: "No Monitoring Order is in force at this building.",
  guidance:
    "Every resident is on the building's standard cadence. An order is entered on the resident record when a clinician asks for closer checks.",
};

export const MONITORING_ORDERS_EMPTY_CLOSED = {
  why: "No Monitoring Order has closed at this building yet.",
  guidance: "An order appears here once it ends, is cancelled, or passes its end time.",
};

export const MONITORING_ORDERS_LOAD_FAILED =
  "Monitoring Orders could not be loaded. Retry, or try again in a moment.";

/**
 * The cancel command requires a reason and only checks that it is not blank.
 * This copy says the same thing rather than inventing a character count the
 * database would not enforce.
 */
export const MONITORING_ORDER_CANCEL_REASON_PROMPT =
  "Say why the order is being stood down. It is kept with the order.";
