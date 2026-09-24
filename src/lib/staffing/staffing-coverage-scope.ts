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
  metricNotConfigured,
  metricUnavailable,
  metricValue,
  type MetricState,
} from "@/lib/metrics/metric-state";
import { loadCertificationRules } from "@/lib/staff/certification-policy";
import {
  summarizeCertificationScope,
  type CertificationScopeSummary,
  type ScopeCert,
  type ScopeStaff,
} from "@/lib/staff/certification-scope";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";

export type StaffingCoverageScope = {
  /** Shift assignments of any status in the same 48-hour window the gap list reads. */
  shiftsInWindow: number;
  /** Certification requirements applied to the active and on-leave staff in scope (COL-709). */
  credentials: CredentialScope;
};

export type CredentialScope = Omit<CertificationScopeSummary, "evaluations">;

type QueryError = { message: string };
type CountResult = { count: number | null; error: QueryError | null };
type ListResult<T> = { data: T[] | null; error: QueryError | null };

function requireCount(res: CountResult): number {
  if (res.error) throw res.error;
  if (typeof res.count !== "number") throw new Error("Count was not returned");
  return res.count;
}

const PAGE = 1000;

/** Every row of a list read, page by page, so a large scope is never silently cut at the API row cap. */
async function readAllPages<T>(page: (from: number, to: number) => PromiseLike<ListResult<T>>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const res = await page(from, from + PAGE - 1);
    if (res.error) throw res.error;
    const data = res.data ?? [];
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

/** Active and on-leave staff in scope with their certifications, as the requirements see them. */
export async function fetchCertificationScope(
  facilityId: string | null,
  supabase: SupabaseClient<Database>,
): Promise<{ staff: ScopeStaff[]; certs: ScopeCert[] }> {
  const [staff, certs] = await Promise.all([
    readAllPages<ScopeStaff>((from, to) => {
      let q = supabase
        .from("staff" as never)
        .select("id, staff_role, facility_id")
        .is("deleted_at", null)
        .in("employment_status", ["active", "on_leave"])
        .order("id", { ascending: true });
      if (facilityId) q = q.eq("facility_id", facilityId);
      return q.range(from, to) as unknown as PromiseLike<ListResult<ScopeStaff>>;
    }),
    readAllPages<ScopeCert>((from, to) => {
      let q = supabase
        .from("staff_certifications" as never)
        .select("id, staff_id, certification_type, status, expiration_date")
        .is("deleted_at", null)
        .order("id", { ascending: true });
      if (facilityId) q = q.eq("facility_id", facilityId);
      return q.range(from, to) as unknown as PromiseLike<ListResult<ScopeCert>>;
    }),
  ]);
  return { staff, certs };
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
  if (facilityId) shiftsQ = shiftsQ.eq("facility_id", facilityId);

  const [shiftsRes, scope, rules] = await Promise.all([
    shiftsQ as unknown as PromiseLike<CountResult>,
    fetchCertificationScope(facilityId, supabase),
    loadCertificationRules(supabase as unknown as SupabaseClient),
  ]);

  const summary = summarizeCertificationScope({ ...scope, rules, now });
  const credentials: CredentialScope = {
    requirementsSetUp: summary.requirementsSetUp,
    staffJudged: summary.staffJudged,
    requiredChecks: summary.requiredChecks,
    expiredRequired: summary.expiredRequired,
    staffMissingRequired: summary.staffMissingRequired,
    expiredRequiredCertIds: summary.expiredRequiredCertIds,
    expiredOnFile: summary.expiredOnFile,
  };
  return { shiftsInWindow: requireCount(shiftsRes), credentials };
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

function missingSentence(count: number): string {
  if (count === 0) return "";
  return ` ${count} ${count === 1 ? "staff member is" : "staff members are"} missing a required certification.`;
}

export const CERT_REQUIREMENTS_HREF = "/admin/certifications/requirements";

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
  const c = scope.credentials;
  if (!c.requirementsSetUp) {
    const lapsed =
      c.expiredOnFile > 0
        ? ` ${c.expiredOnFile} ${c.expiredOnFile === 1 ? "certification" : "certifications"} on file ${c.expiredOnFile === 1 ? "has" : "have"} lapsed.`
        : "";
    return {
      clear: false,
      emptyTitle: "Certification requirements not set up",
      emptyDescription: `No job role has a certification requirement yet, so nobody is flagged. Set them under Certification requirements.${lapsed}`,
      tile: metricNotConfigured("Requirements not set up"),
      tileCopy: `No job role has a certification requirement yet.${lapsed}`,
    };
  }
  const missing = missingSentence(c.staffMissingRequired);
  if (c.expiredRequired > 0) {
    return {
      clear: false,
      emptyTitle: "",
      emptyDescription: "",
      tile: metricValue(c.expiredRequired),
      tileCopy: `${c.expiredRequired} expired required ${c.expiredRequired === 1 ? "credential needs" : "credentials need"} review.${missing}`,
    };
  }
  if (canClaimAllClear({ scopeSize: c.requiredChecks, issueCount: c.expiredRequired + c.staffMissingRequired })) {
    return {
      clear: true,
      emptyTitle: "No credential blockers",
      emptyDescription: `All ${c.requiredChecks} required certifications in the current staffing scope are on file and in date.`,
      tile: metricValue(0),
      tileCopy: `No expired credentials among ${c.requiredChecks} required.`,
    };
  }
  if (c.requiredChecks === 0) {
    return {
      clear: false,
      emptyTitle: "No certifications required here",
      emptyDescription: "No job role in this scope needs a certification, so there is nothing to check.",
      tile: metricNoData("None required"),
      tileCopy: "No job role in this scope needs a certification.",
    };
  }
  return {
    clear: false,
    emptyTitle: "Required certifications missing",
    emptyDescription: `No required certification has expired, but some are not on file.${missing}`,
    tile: metricValue(0),
    tileCopy: `No expired required credentials.${missing}`,
  };
}
