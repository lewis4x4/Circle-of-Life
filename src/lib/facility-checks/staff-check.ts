/**
 * Staff Check — resolving every identity with live access to a facility
 * (COL-361).
 *
 * Three outcomes and no fourth: keep, deactivate, or duplicate of another
 * identity. A duplicate is deactivated through the same COL-349 offboard flow
 * as anyone else and its facility grants are listed for the administrator to
 * reassign in the grant UI. Nothing here moves a record between identities.
 * A merge would rewrite history that audit and licensure rely on.
 *
 * Duplicate candidates are suggestions. The database finds them by normalized
 * email, by one auth user id carrying more than one staff row, and by
 * normalized name inside one organization. A suggestion is a reason to look.
 */

export const STAFF_CHECK_RESULTS = ["keep", "deactivate", "duplicate_of"] as const;

export type StaffCheckResult = (typeof STAFF_CHECK_RESULTS)[number];

export function isStaffCheckResult(value: string): value is StaffCheckResult {
  return (STAFF_CHECK_RESULTS as readonly string[]).includes(value);
}

const RESULT_LABELS: Record<StaffCheckResult, string> = {
  keep: "Keep",
  deactivate: "Deactivate",
  duplicate_of: "Duplicate of…",
};

export function staffCheckResultLabel(result: StaffCheckResult): string {
  return RESULT_LABELS[result];
}

export const DUPLICATE_BADGE_TEXT = "Possible duplicate";

export type StaffCheckStateRow = {
  subject_user_profile_id: string | null;
  subject_staff_id: string | null;
  display_name: string | null;
  role_label: string | null;
  facility_grant_count: number;
  last_sign_in_at: string | null;
  is_active: boolean;
  duplicate_candidate_user_profile_ids: string[];
  duplicate_candidate_staff_ids: string[];
  duplicate_candidate_count: number;
  latest_result: string | null;
  duplicate_of_user_profile_id: string | null;
  duplicate_of_staff_id: string | null;
  unmarked: boolean;
  fix_open: boolean;
};

export type StaffCheckProgress = {
  total: number;
  checked: number;
  deactivationsPending: number;
  canClose: boolean;
};

export function staffCheckProgress(rows: readonly StaffCheckStateRow[]): StaffCheckProgress {
  const total = rows.length;
  const checked = rows.filter((row) => !row.unmarked).length;
  const deactivationsPending = rows.filter((row) => row.fix_open).length;
  return {
    total,
    checked,
    deactivationsPending,
    canClose: total > 0 && checked === total && deactivationsPending === 0,
  };
}

export function staffCheckProgressLine(progress: StaffCheckProgress): string {
  const identities = `${progress.checked} of ${progress.total} identities checked`;
  const pending =
    progress.deactivationsPending === 1
      ? "1 deactivation pending"
      : `${progress.deactivationsPending} deactivations pending`;
  return `${identities} · ${pending}`;
}

export function staffCloseRefusalMessage(progress: StaffCheckProgress): string {
  const parts: string[] = [];
  const unresolved = progress.total - progress.checked;
  if (unresolved > 0) {
    parts.push(
      unresolved === 1 ? "1 identity is still unresolved" : `${unresolved} identities are still unresolved`,
    );
  }
  if (progress.deactivationsPending > 0) {
    parts.push(
      progress.deactivationsPending === 1
        ? "1 deactivation has not gone through yet"
        : `${progress.deactivationsPending} deactivations have not gone through yet`,
    );
  }
  if (parts.length === 0) return "This check is ready to close.";
  return `${parts.join(" and ")}. Finish those before closing the check.`;
}

/** A stable key for a subject, so a staff row and a bare profile never collide. */
export function staffCheckSubjectKey(row: Pick<StaffCheckStateRow, "subject_user_profile_id" | "subject_staff_id">): string {
  return `${row.subject_staff_id ?? ""}:${row.subject_user_profile_id ?? ""}`;
}

export function hasDuplicateCandidates(row: StaffCheckStateRow): boolean {
  return row.duplicate_candidate_count > 0;
}

/**
 * What is still outstanding for an identity, in the administrator's terms. A
 * deactivation is two halves -- employment ends and the Haven login is revoked
 * -- and the item stays open until both are done, which is what "still active"
 * means here.
 */
export function staffCheckFixDetail(row: StaffCheckStateRow): string | null {
  if (!row.fix_open || !row.latest_result || !isStaffCheckResult(row.latest_result)) return null;
  if (row.latest_result === "duplicate_of") {
    return "This identity is still active. Offboard it, then reassign its facility grants to the identity you are keeping. Nothing is merged.";
  }
  if (row.latest_result === "deactivate") {
    return "This identity can still sign in. Offboard ends employment and revokes the Haven login; both have to go through.";
  }
  return null;
}

export function staffGrantReassignmentNote(row: StaffCheckStateRow): string | null {
  if (row.latest_result !== "duplicate_of") return null;
  if (row.facility_grant_count === 0) return "No facility grants to reassign.";
  return row.facility_grant_count === 1
    ? "1 facility grant to reassign in the grant screen."
    : `${row.facility_grant_count} facility grants to reassign in the grant screen.`;
}

export function lastSignInLabel(
  iso: string | null,
  formatDateTime: (value: string) => string,
): string {
  if (!iso) return "Never signed in";
  return formatDateTime(iso);
}

/**
 * The insert for one decision. A staff subject carries both its staff id and
 * its linked profile id, so the latest-result lookup keys on the same pair the
 * read model produces.
 */
export function staffCheckResultInsert(input: {
  organizationId: string;
  sessionId: string;
  row: StaffCheckStateRow;
  result: StaffCheckResult;
  duplicateOf?: Pick<StaffCheckStateRow, "subject_user_profile_id" | "subject_staff_id"> | null;
  recordedBy: string;
}): {
  organization_id: string;
  session_id: string;
  subject_user_profile_id: string | null;
  subject_staff_id: string | null;
  result: StaffCheckResult;
  duplicate_of_user_profile_id: string | null;
  duplicate_of_staff_id: string | null;
  recorded_by: string;
} {
  const duplicate = input.result === "duplicate_of" ? (input.duplicateOf ?? null) : null;
  return {
    organization_id: input.organizationId,
    session_id: input.sessionId,
    subject_user_profile_id: input.row.subject_user_profile_id,
    subject_staff_id: input.row.subject_staff_id,
    result: input.result,
    duplicate_of_user_profile_id: duplicate?.subject_user_profile_id ?? null,
    duplicate_of_staff_id: duplicate?.subject_staff_id ?? null,
    recorded_by: input.recordedBy,
  };
}

/** The database refuses a duplicate_of with no target; refuse it here too, before the round trip. */
export function duplicateTargetRequired(
  result: StaffCheckResult,
  duplicateOf: Pick<StaffCheckStateRow, "subject_user_profile_id" | "subject_staff_id"> | null,
): boolean {
  if (result !== "duplicate_of") return false;
  return !duplicateOf || (!duplicateOf.subject_user_profile_id && !duplicateOf.subject_staff_id);
}

/**
 * The picker is limited to the suggested candidates plus a search inside the
 * organization. Suggestions first, because they are the ones the database
 * already has a reason for.
 */
export function duplicateTargetChoices(
  subject: StaffCheckStateRow,
  rows: readonly StaffCheckStateRow[],
  search: string,
): StaffCheckStateRow[] {
  const subjectKey = staffCheckSubjectKey(subject);
  const suggested = new Set([
    ...subject.duplicate_candidate_user_profile_ids,
    ...subject.duplicate_candidate_staff_ids,
  ]);
  const query = search.trim().toLowerCase();

  const isSuggested = (row: StaffCheckStateRow) =>
    (row.subject_user_profile_id != null && suggested.has(row.subject_user_profile_id)) ||
    (row.subject_staff_id != null && suggested.has(row.subject_staff_id));

  return rows
    .filter((row) => staffCheckSubjectKey(row) !== subjectKey)
    .filter((row) => {
      if (isSuggested(row)) return true;
      if (query.length === 0) return false;
      return (row.display_name ?? "").toLowerCase().includes(query);
    })
    .sort((left, right) => {
      const bySuggestion = Number(isSuggested(right)) - Number(isSuggested(left));
      if (bySuggestion !== 0) return bySuggestion;
      return (left.display_name ?? "").localeCompare(right.display_name ?? "");
    });
}

/** Roles that can deactivate staff, which is what a staff check resolves into. */
export function canRunStaffCheck(appRole: string): boolean {
  return appRole === "owner" || appRole === "org_admin" || appRole === "facility_admin";
}

export function staffCheckClosedSummary(input: {
  closedAt: string;
  closedByName: string | null;
  total: number;
  formatDateTime: (iso: string) => string;
}): string {
  const who = input.closedByName ? ` by ${input.closedByName}` : "";
  return `Closed ${input.formatDateTime(input.closedAt)}${who} · ${input.total} of ${input.total} resolved`;
}
