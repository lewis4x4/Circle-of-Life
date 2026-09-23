/**
 * What /admin/staffing actually examined before it says "Clear" (COL-649).
 *
 * The console used to render "Clear" + "Coverage is currently sufficient for
 * the next 48 hours" and "No credential blockers" whenever the gap and
 * expired-credential lists came back empty — including when nothing was on
 * the schedule and no certification was on file for anyone. An empty list is
 * only an all-clear when there was something to check.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  facilityDateIsoDaysFromToday,
  todayFacilityDateIso,
} from "@/lib/facility-wall-clock";
import {
  canClaimAllClear,
  metricNoData,
  metricUnavailable,
  metricValue,
  type MetricState,
} from "@/lib/metrics/metric-state";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";

export type StaffingCoverageScope = {
  /** Shift assignments of any status in the same 48-hour window the gap list reads. */
  shiftsInWindow: number;
  /** Certifications on file (any status) in scope. */
  certificationsOnFile: number;
  /** Expired or revoked certifications, or past their expiration date — the true count, not the 10-row list. */
  expiredCertifications: number;
  /** Active or on-leave staff with no certification on file at all. */
  staffWithoutCertifications: number;
};

type QueryError = { message: string };
type CountResult = { count: number | null; error: QueryError | null };
type ListResult<T> = { data: T[] | null; error: QueryError | null };

function requireCount(res: CountResult): number {
  if (res.error) throw res.error;
  if (typeof res.count !== "number") throw new Error("Count was not returned");
  return res.count;
}

export async function fetchStaffingCoverageScope(
  selectedFacilityId: string | null,
  supabase: SupabaseClient<Database> = createClient(),
): Promise<StaffingCoverageScope> {
  const facilityId = isValidFacilityIdForQuery(selectedFacilityId) ? selectedFacilityId : null;
  const now = new Date();
  const todayIso = todayFacilityDateIso(now);
  const endDateIso = facilityDateIsoDaysFromToday(2, now);

  let shiftsQ = supabase
    .from("shift_assignments" as never)
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .gte("shift_date", todayIso)
    .lte("shift_date", endDateIso);
  let expiredQ = supabase
    .from("staff_certifications" as never)
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .or(`status.in.(expired,revoked),expiration_date.lt.${todayIso}`);
  let certCountQ = supabase
    .from("staff_certifications" as never)
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null);
  let certStaffQ = supabase
    .from("staff_certifications" as never)
    .select("staff_id")
    .is("deleted_at", null);
  let staffQ = supabase
    .from("staff" as never)
    .select("id")
    .is("deleted_at", null)
    .in("employment_status", ["active", "on_leave"]);

  if (facilityId) {
    shiftsQ = shiftsQ.eq("facility_id", facilityId);
    expiredQ = expiredQ.eq("facility_id", facilityId);
    certCountQ = certCountQ.eq("facility_id", facilityId);
    certStaffQ = certStaffQ.eq("facility_id", facilityId);
    staffQ = staffQ.eq("facility_id", facilityId);
  }

  const [shiftsRes, expiredRes, certCountRes, certStaffRes, staffRes] = (await Promise.all([
    shiftsQ,
    expiredQ,
    certCountQ,
    certStaffQ,
    staffQ,
  ])) as unknown as [
    CountResult,
    CountResult,
    CountResult,
    ListResult<{ staff_id: string }>,
    ListResult<{ id: string }>,
  ];

  if (certStaffRes.error) throw certStaffRes.error;
  if (staffRes.error) throw staffRes.error;
  const certRows = certStaffRes.data ?? [];
  const staffWithCerts = new Set(certRows.map((row) => row.staff_id));

  return {
    shiftsInWindow: requireCount(shiftsRes),
    certificationsOnFile: requireCount(certCountRes),
    expiredCertifications: requireCount(expiredRes),
    staffWithoutCertifications: (staffRes.data ?? []).filter((row) => !staffWithCerts.has(row.id)).length,
  };
}

export type ShiftGapPanelCopy = {
  badge: "gaps" | "clear" | "none_scheduled" | "unknown";
  badgeLabel: string;
  emptyTitle: string;
  emptyDescription: string;
  /** Open shifts (48h) tile. */
  tile: MetricState<number>;
  tileCopy: string;
};

/** `scope` null = the scope read failed or has not run. */
export function describeShiftGapPanel(input: {
  scope: StaffingCoverageScope | null;
  openShiftShortage: number;
  gapRows: number;
}): ShiftGapPanelCopy {
  const { scope, openShiftShortage, gapRows } = input;
  if (gapRows > 0) {
    return {
      badge: "gaps",
      badgeLabel: "Priority dispatch",
      emptyTitle: "",
      emptyDescription: "",
      tile: metricValue(openShiftShortage),
      tileCopy: `${openShiftShortage} unfilled ${openShiftShortage === 1 ? "role" : "roles"} in the next 48 hours.`,
    };
  }
  if (scope === null) {
    return {
      badge: "unknown",
      badgeLabel: "Not checked",
      emptyTitle: "Coverage could not be checked",
      emptyDescription: "The schedule for the next 48 hours could not be read, so this is not an all-clear.",
      tile: metricUnavailable(),
      tileCopy: "The schedule for the next 48 hours could not be read.",
    };
  }
  if (canClaimAllClear({ scopeSize: scope.shiftsInWindow, issueCount: gapRows })) {
    return {
      badge: "clear",
      badgeLabel: "Clear",
      emptyTitle: "No open shift assignment gaps",
      emptyDescription: "Coverage is currently sufficient for the next 48 hours in this scope.",
      tile: metricValue(0),
      tileCopy: `No open shift gaps across ${scope.shiftsInWindow} scheduled ${scope.shiftsInWindow === 1 ? "shift" : "shifts"} in the next 48 hours.`,
    };
  }
  return {
    badge: "none_scheduled",
    badgeLabel: "Nothing scheduled",
    emptyTitle: "No shifts scheduled in the next 48 hours",
    emptyDescription:
      "There is nothing on the schedule to check, so this is not an all-clear. Publish a schedule week to see coverage.",
    tile: metricNoData("No shifts scheduled"),
    tileCopy: "No shifts are scheduled in the next 48 hours.",
  };
}

export type CredentialPanelCopy = {
  clear: boolean;
  emptyTitle: string;
  emptyDescription: string;
  /** Expired credentials tile. */
  tile: MetricState<number>;
  tileCopy: string;
};

function withoutCertsSentence(count: number): string {
  if (count === 0) return "";
  return ` ${count} active ${count === 1 ? "staff member has" : "staff members have"} no certification on file.`;
}

export function describeCredentialPanel(scope: StaffingCoverageScope | null): CredentialPanelCopy {
  if (scope === null) {
    return {
      clear: false,
      emptyTitle: "Credentials could not be checked",
      emptyDescription: "Certifications could not be read, so this is not an all-clear.",
      tile: metricUnavailable(),
      tileCopy: "Certifications could not be read.",
    };
  }
  const expired = scope.expiredCertifications;
  const missing = withoutCertsSentence(scope.staffWithoutCertifications);
  if (expired > 0) {
    return {
      clear: false,
      emptyTitle: "",
      emptyDescription: "",
      tile: metricValue(expired),
      tileCopy: `${expired} expired ${expired === 1 ? "credential" : "credentials"} require review.${missing}`,
    };
  }
  if (canClaimAllClear({ scopeSize: scope.certificationsOnFile, issueCount: expired })) {
    return {
      clear: true,
      emptyTitle: "No credential blockers",
      emptyDescription: `There are no expired credentials among ${scope.certificationsOnFile} on file in the current staffing scope.${missing}`,
      tile: metricValue(0),
      tileCopy: `No expired credentials among ${scope.certificationsOnFile} on file.${missing}`,
    };
  }
  return {
    clear: false,
    emptyTitle: "No certifications on file",
    emptyDescription: `No credentials are recorded in this scope, so none can be checked. This is not an all-clear.${missing}`,
    tile: metricNoData("No certs on file"),
    tileCopy: `No certifications are on file in this scope.${missing}`,
  };
}
