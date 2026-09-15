/**
 * Quiet Operator copy for the printed care plan
 * (`/admin/residents/[id]/care-plan/print`).
 * A printout is handed to survey and family: every gap is named, nothing is invented,
 * and a plan that is not in effect says so at the top of the page.
 */

import { formatCarePlanDateOnly } from "./care-plan-display-copy";

export const CARE_PLAN_PRINT_TITLE = "Resident Care Plan";
export const CARE_PLAN_PRINT_NO_TIMESTAMP_COPY = "No date posted";
export const CARE_PLAN_PRINT_NO_ASSISTANCE_LEVEL_COPY = "No assistance level posted";
export const CARE_PLAN_PRINT_NO_ROOM_COPY = "No bed linked";
export const CARE_PLAN_PRINT_NO_APPROVER_COPY = "No approver posted";
export const CARE_PLAN_PRINT_UNSIGNED_COPY = "Not signed";
export const CARE_PLAN_PRINT_NO_ITEMS_COPY = "No active needs or interventions on this plan.";

export const CARE_PLAN_PRINT_DRAFT_BANNER = "DRAFT — not in effect";
export const CARE_PLAN_PRINT_ARCHIVED_BANNER = "ARCHIVED — no longer in effect";

/** Button label on the care-plan page — says which kind of copy will come out. */
export function formatCarePlanPrintAction(status: string | null | undefined): string {
  switch (status) {
    case "active":
      return "Print signed plan";
    case "archived":
      return "Print archived copy";
    default:
      return "Print draft";
  }
}

/** Signed, in-effect plans carry no banner; anything else says what it is. */
export function formatCarePlanPrintBanner(
  status: string | null | undefined,
  supersededByVersion: number | null | undefined,
): string | null {
  switch (status) {
    case "active":
      return null;
    case "archived":
      return supersededByVersion != null
        ? `SUPERSEDED by v${supersededByVersion} — no longer in effect`
        : CARE_PLAN_PRINT_ARCHIVED_BANNER;
    default:
      return CARE_PLAN_PRINT_DRAFT_BANNER;
  }
}

const easternTimestamp = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  dateStyle: "medium",
  timeStyle: "short",
});

/** Instant rendered in Eastern time with an explicit zone label; missing / unparseable → explicit empty copy. */
export function formatCarePlanPrintTimestamp(iso: string | null | undefined): string {
  if (!iso || !iso.trim()) return CARE_PLAN_PRINT_NO_TIMESTAMP_COPY;
  const parsed = new Date(iso.trim());
  if (Number.isNaN(parsed.getTime())) return CARE_PLAN_PRINT_NO_TIMESTAMP_COPY;
  return `${easternTimestamp.format(parsed)} ET`;
}

export function formatCarePlanPrintDateOfBirth(iso: string | null | undefined): string {
  return formatCarePlanDateOnly(iso);
}

function titleCaseSnake(value: string): string {
  return value
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function formatCarePlanPrintAssistanceLevel(value: string | null | undefined): string {
  if (!value || !value.trim()) return CARE_PLAN_PRINT_NO_ASSISTANCE_LEVEL_COPY;
  return titleCaseSnake(value.trim());
}

export function formatCarePlanPrintCategoryLabel(category: string | null | undefined): string {
  if (!category || !category.trim()) return "Other";
  return titleCaseSnake(category.trim());
}

/** Room + bed the way the roster prints it (`10-B`); no linked bed is said plainly. */
export function formatCarePlanPrintRoom(
  roomNumber: string | null | undefined,
  bedLabel: string | null | undefined,
): string {
  const room = (roomNumber ?? "").trim();
  if (!room) return CARE_PLAN_PRINT_NO_ROOM_COPY;
  const bed = (bedLabel ?? "").trim();
  return bed ? `${room}-${bed}` : room;
}

export function formatCarePlanPrintApprover(name: string | null | undefined): string {
  if (!name || !name.trim()) return CARE_PLAN_PRINT_NO_APPROVER_COPY;
  return name.trim();
}
