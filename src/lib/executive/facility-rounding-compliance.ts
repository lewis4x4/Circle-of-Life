import type { ComplianceSummary } from "@/lib/rounding/observation-compliance-summary";
import {
  addFacilityCalendarDays,
  todayFacilityDateIso,
} from "@/lib/facility-wall-clock";
import type { RoundingReportDateRange } from "@/lib/rounding/rounding-reports-date-range";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const READ_FAILED = "Seven-day rounding compliance could not be read.";

/**
 * Seven fully elapsed America/New_York service dates.
 *
 * Today is deliberately excluded: the historical projector includes every
 * window on a requested service date, so later windows today would otherwise
 * read as missed before their staff had a chance to complete them.
 */
export function lastSevenCompletedFacilityDays(
  now: Date = new Date(),
): RoundingReportDateRange {
  const todayIso = todayFacilityDateIso(now);
  return {
    from: addFacilityCalendarDays(todayIso, -7),
    to: addFacilityCalendarDays(todayIso, -1),
  };
}

function isComplianceSummary(value: unknown): value is ComplianceSummary {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ComplianceSummary>;
  return (
    typeof candidate.from === "string" &&
    typeof candidate.to === "string" &&
    Boolean(candidate.totals) &&
    typeof candidate.totals?.expected === "number" &&
    typeof candidate.totals?.satisfied === "number" &&
    typeof candidate.totals?.unconfigured === "number" &&
    Array.isArray(candidate.byShift) &&
    Array.isArray(candidate.byHall) &&
    Array.isArray(candidate.byStaff)
  );
}

/**
 * Read the same version-stamped compliance contract used by Integrity.
 *
 * The API route executes `observation_compliance_for_range` on the signed-in
 * actor's authority and verifies facility access. The executive page reuses
 * it so it cannot drift into task-row counting or a service-role read.
 */
export async function fetchExecutiveFacilityCompliance(
  facilityId: string,
  now: Date = new Date(),
  fetcher: FetchLike = fetch,
): Promise<ComplianceSummary> {
  const { from, to } = lastSevenCompletedFacilityDays(now);
  const response = await fetcher(
    `/api/rounding/compliance?facilityId=${encodeURIComponent(facilityId)}&from=${from}&to=${to}`,
    { cache: "no-store" },
  );
  const payload = (await response.json().catch(() => null)) as
    | (ComplianceSummary & { error?: string })
    | null;
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error || READ_FAILED);
  }
  if (!isComplianceSummary(payload)) {
    throw new Error(READ_FAILED);
  }
  return payload;
}
