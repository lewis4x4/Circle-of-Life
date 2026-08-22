/**
 * Quiet Operator copy and defaults for the facility detail timeline tab.
 * New-event dates anchor to Eastern calendar today — not a UTC ISO slice.
 */

import type { TimelineEventInput } from "@/lib/validation/facility-admin";
import { todayFacilityDateIso } from "@/lib/facility-wall-clock";

export const TIMELINE_TAB_NO_EVENTS_COPY =
  "No timeline events recorded yet. Add an event to capture ownership changes, renovations, surveys, and other facility milestones.";

/** Default new-event form — Eastern calendar today, not UTC ISO slice. */
export function createDefaultTimelineEventForm(
  now: Date = new Date(),
): TimelineEventInput {
  return {
    event_date: todayFacilityDateIso(now),
    event_type: "other",
    title: "",
    description: "",
  };
}
