import { TARDIES_PER_ABSENCE, TARDY_THRESHOLD_MINUTES } from './employment-rules';

/** Packet thresholds are historical proposals, not approved employment rules. */
export const ATTENDANCE_POLICY_STATUS = 'draft_source_unapproved' as const;

export interface AttendanceOccurrence {
  id: string;
  /** Facility calendar date (YYYY-MM-DD), not a UTC date inferred from a timestamp. */
  date: string;
  kind: 'absence' | 'tardy' | 'left_early' | 'no_call_no_show';
  minutesLate?: number;
  minutesEarly?: number;
  review: 'pending' | 'counted' | 'excluded';
  /** Required to recognize a reviewed count or exclusion. Avoid medical details. */
  reviewReason?: string;
}

export interface AttendanceCreditReview {
  requested: boolean;
  meetingCompleted: boolean;
  approved: boolean;
}

export interface AttendanceReviewInput {
  asOf: string | Date;
  occurrences: readonly AttendanceOccurrence[];
  employmentStartDate?: string;
  creditReview?: AttendanceCreditReview;
}

export interface AttendanceCandidateNotice {
  kind: 'absence_threshold' | 'tardy_threshold' | 'no_call_no_show_review';
  threshold: number;
  message: string;
  requiresHumanReview: true;
}

export interface AttendanceReviewAssessment {
  policyStatus: typeof ATTENDANCE_POLICY_STATUS;
  automaticEmploymentAction: false;
  window: { startDate: string; endDate: string; boundary: 'inclusive' };
  occurrences: Array<AttendanceOccurrence & {
    disposition: 'outside_window' | 'excluded' | 'pending_review' | 'counted' | 'below_tardy_threshold';
  }>;
  countedAbsences: number;
  /** Combined reviewed late arrivals and early departures under the draft deviation ladder. */
  countedTardies: number;
  countedEarlyDepartures: number;
  pendingReviewIds: string[];
  /** Informational only: never added to countedAbsences while overlap is unresolved. */
  proposedTardyAbsenceEquivalent: number;
  candidateNotices: AttendanceCandidateNotice[];
  cleanPeriodCredit: {
    cleanCalendarDays: number | null;
    candidate: boolean;
    prerequisitesSatisfied: boolean;
    applied: false;
    historyReset: false;
    missingRequirements: string[];
  };
}

function parseCalendarDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Expected a YYYY-MM-DD calendar date.');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error('Invalid calendar date.');
  }
  return date;
}

/** Explicit America/New_York conversion makes assessment independent of host timezone. */
export function attendanceCalendarDate(value: string | Date): string {
  if (typeof value === 'string') {
    parseCalendarDate(value);
    return value;
  }
  if (!Number.isFinite(value.getTime())) throw new Error('Invalid assessment timestamp.');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  return ['year', 'month', 'day'].map((type) => parts.find((part) => part.type === type)!.value).join('-');
}

function previousCalendarYear(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year - 1, month, 0)).getUTCDate();
  return `${String(year - 1).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

/** Decision support only. Never modifies records, applies discipline, or retracts history. */
export function assessAttendanceReview(input: AttendanceReviewInput): AttendanceReviewAssessment {
  const endDate = attendanceCalendarDate(input.asOf);
  const startDate = previousCalendarYear(endDate);
  const ids = new Set<string>();
  const employmentStart = input.employmentStartDate ? attendanceCalendarDate(input.employmentStartDate) : null;
  if (employmentStart && employmentStart > endDate) throw new Error('Employment start cannot follow assessment date.');
  const occurrences: AttendanceReviewAssessment['occurrences'] = input.occurrences.map((row) => {
    attendanceCalendarDate(row.date);
    if (!row.id.trim() || ids.has(row.id)) throw new Error('Occurrence IDs must be nonempty and unique.');
    ids.add(row.id);
    for (const minutes of [row.minutesLate, row.minutesEarly]) {
      if (minutes !== undefined && (!Number.isFinite(minutes) || minutes < 0)) {
        throw new Error('Deviation minutes must be a finite nonnegative number.');
      }
    }
    const deviation = row.kind === 'tardy' || row.kind === 'left_early';
    const minutes = row.kind === 'left_early' ? row.minutesEarly : row.minutesLate;
    let disposition: AttendanceReviewAssessment['occurrences'][number]['disposition'];
    if (row.date < startDate || row.date > endDate) disposition = 'outside_window';
    else if (row.review === 'pending' || !row.reviewReason?.trim()) disposition = 'pending_review';
    else if (row.review === 'excluded') disposition = 'excluded';
    else if (deviation && minutes === undefined) disposition = 'pending_review';
    else if (deviation && minutes! < TARDY_THRESHOLD_MINUTES) disposition = 'below_tardy_threshold';
    else disposition = 'counted';
    return { ...row, disposition };
  });
  const countedAbsences = occurrences.filter((row) => row.disposition === 'counted' && row.kind === 'absence').length;
  const countedTardies = occurrences.filter((row) => row.disposition === 'counted' && (row.kind === 'tardy' || row.kind === 'left_early')).length;
  const countedEarlyDepartures = occurrences.filter((row) => row.disposition === 'counted' && row.kind === 'left_early').length;
  const candidateNotices: AttendanceCandidateNotice[] = [];
  const absenceThreshold = [6, 5, 4, 3].find((threshold) => countedAbsences >= threshold);
  if (absenceThreshold) candidateNotices.push({
    kind: 'absence_threshold', threshold: absenceThreshold, requiresHumanReview: true,
    message: `${absenceThreshold}-absence threshold in the draft source reached. Review exceptions and approved policy before any corrective action.`,
  });
  const tardyThreshold = [12, 8, 4].find((threshold) => countedTardies >= threshold);
  if (tardyThreshold) candidateNotices.push({
    kind: 'tardy_threshold', threshold: tardyThreshold, requiresHumanReview: true,
    message: `${tardyThreshold}-tardy/early-departure threshold in the draft source reached. Tardy equivalents are not added to absences while the overlap rule is unapproved.`,
  });
  if (occurrences.some((row) => row.kind === 'no_call_no_show' && ['counted', 'pending_review'].includes(row.disposition))) {
    candidateNotices.push({ kind: 'no_call_no_show_review', threshold: 1, requiresHumanReview: true,
      message: 'Review reported no-call/no-show circumstances. No resignation or termination is inferred.' });
  }
  // Assess the full supplied history, including incidents older than the rolling window.
  const dirtyDates = occurrences.filter((row) => row.date <= endDate &&
    !(row.review === 'excluded' && row.reviewReason?.trim()) &&
    !((row.kind === 'tardy' || row.kind === 'left_early') && row.review === 'counted' && row.reviewReason?.trim() &&
      (row.kind === 'left_early' ? row.minutesEarly : row.minutesLate) !== undefined &&
      (row.kind === 'left_early' ? row.minutesEarly! : row.minutesLate!) < TARDY_THRESHOLD_MINUTES)).map((row) => row.date);
  const baseline = [employmentStart, ...dirtyDates].filter((date): date is string => date !== null).sort().at(-1);
  const cleanCalendarDays = baseline ? Math.floor((parseCalendarDate(endDate).getTime() - parseCalendarDate(baseline).getTime()) / 86_400_000) : null;
  const candidate = cleanCalendarDays !== null && cleanCalendarDays >= 90;
  const missingRequirements: string[] = [];
  if (!candidate) missingRequirements.push('90 documented clean calendar days');
  if (!input.creditReview?.requested) missingRequirements.push('Employee request');
  if (!input.creditReview?.meetingCompleted) missingRequirements.push('Review meeting');
  if (!input.creditReview?.approved) missingRequirements.push('Authorized reviewer approval');
  const prerequisitesSatisfied = missingRequirements.length === 0;
  missingRequirements.push('Approved policy version and recorded corrective-action retraction');
  return {
    policyStatus: ATTENDANCE_POLICY_STATUS, automaticEmploymentAction: false,
    window: { startDate, endDate, boundary: 'inclusive' }, occurrences,
    countedAbsences, countedTardies, countedEarlyDepartures,
    pendingReviewIds: occurrences.filter((row) => row.disposition === 'pending_review').map((row) => row.id),
    proposedTardyAbsenceEquivalent: Math.floor(countedTardies / TARDIES_PER_ABSENCE), candidateNotices,
    cleanPeriodCredit: { cleanCalendarDays, candidate, prerequisitesSatisfied, applied: false, historyReset: false, missingRequirements },
  };
}
