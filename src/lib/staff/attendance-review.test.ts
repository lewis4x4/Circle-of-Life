import { describe, expect, it } from 'vitest';
import { assessAttendanceReview, attendanceCalendarDate, type AttendanceOccurrence } from './attendance-review';

const absence = (id: string, date: string, extra: Partial<AttendanceOccurrence> = {}): AttendanceOccurrence => ({
  id, date, kind: 'absence', review: 'counted', reviewReason: 'Reviewed occurrence', ...extra,
});
const assess = (occurrences: AttendanceOccurrence[], asOf: string | Date = '2026-09-08') => assessAttendanceReview({ asOf, occurrences });

describe('attendance decision support', () => {
  it('uses a twelve-calendar-month inclusive window, preserving excluded, expired, and future history', () => {
    const rows = [absence('old', '2025-09-07'), absence('boundary', '2025-09-08'), absence('today', '2026-09-08'),
      absence('future', '2026-09-09'), absence('protected', '2026-09-01', { review: 'excluded', reviewReason: 'Authorized protected leave exclusion' })];
    const before = JSON.stringify(rows);
    const result = assess(rows);
    expect(result.window).toEqual({ startDate: '2025-09-08', endDate: '2026-09-08', boundary: 'inclusive' });
    expect(result.countedAbsences).toBe(2);
    expect(result.occurrences.map((row) => row.disposition)).toEqual(['outside_window', 'counted', 'counted', 'outside_window', 'excluded']);
    expect(JSON.stringify(rows)).toBe(before);
  });

  it('clamps leap-day anniversary and spans a year boundary', () => {
    expect(assess([absence('boundary', '2023-02-28'), absence('old', '2023-02-27')], '2024-02-29').countedAbsences).toBe(1);
    expect(assess([], '2026-01-01').window.startDate).toBe('2025-01-01');
  });

  it('interprets timestamps in New York across midnight and DST', () => {
    expect(attendanceCalendarDate(new Date('2026-09-09T03:59:59Z'))).toBe('2026-09-08');
    expect(attendanceCalendarDate(new Date('2026-01-01T04:59:59Z'))).toBe('2025-12-31');
    expect(attendanceCalendarDate(new Date('2026-03-08T07:00:00Z'))).toBe('2026-03-08');
  });

  it('does not count pending reviews or exclusions without documented review', () => {
    const result = assess([absence('pending', '2026-09-01', { review: 'pending' }),
      absence('unexplained-exclusion', '2026-09-02', { review: 'excluded', reviewReason: '' }),
      absence('unexplained-count', '2026-09-03', { reviewReason: undefined })]);
    expect(result.countedAbsences).toBe(0);
    expect(result.pendingReviewIds).toEqual(['pending', 'unexplained-exclusion', 'unexplained-count']);
  });

  it.each([3, 4, 5, 6, 8])('reports %i absences as a human-review candidate only', (count) => {
    const result = assess(Array.from({ length: count }, (_, index) => absence(String(index), `2026-09-0${index + 1}`)));
    expect(result.candidateNotices[0]).toMatchObject({ kind: 'absence_threshold', threshold: Math.min(count, 6), requiresHumanReview: true });
    expect(result.automaticEmploymentAction).toBe(false);
    expect(result.policyStatus).toBe('draft_source_unapproved');
  });

  it.each([4, 8, 12])('keeps %i tardies out of the absence ladder while overlap is unresolved', (count) => {
    const rows = Array.from({ length: count }, (_, i) => absence(String(i), '2026-09-01', { kind: 'tardy', minutesLate: 7 }));
    const result = assess([absence('absence', '2026-09-02'), ...rows]);
    expect(result.countedAbsences).toBe(1);
    expect(result.countedTardies).toBe(count);
    expect(result.proposedTardyAbsenceEquivalent).toBe(count / 4);
    expect(result.candidateNotices).toEqual([expect.objectContaining({ kind: 'tardy_threshold', threshold: count })]);
  });

  it('distinguishes below-threshold lateness from unmeasured tardies', () => {
    const result = assess([absence('six', '2026-09-01', { kind: 'tardy', minutesLate: 6 }),
      absence('unknown', '2026-09-02', { kind: 'tardy' }), absence('seven', '2026-09-03', { kind: 'tardy', minutesLate: 7 })]);
    expect(result.countedTardies).toBe(1);
    expect(result.pendingReviewIds).toEqual(['unknown']);
    expect(result.occurrences[0].disposition).toBe('below_tardy_threshold');
  });

  it('routes no-call/no-show to review without inferring resignation or counting an extra absence', () => {
    const result = assess([absence('ncns', '2026-09-01', { kind: 'no_call_no_show', review: 'pending' })]);
    expect(result.countedAbsences).toBe(0);
    expect(result.candidateNotices[0].kind).toBe('no_call_no_show_review');
    expect(result.automaticEmploymentAction).toBe(false);
  });

  it('requires 90 calendar days, employee request, meeting, approval, and approved policy; never resets history', () => {
    const occurrences = [absence('original', '2026-03-01')];
    const pending = assessAttendanceReview({ asOf: '2026-05-30', occurrences });
    expect(pending.cleanPeriodCredit).toMatchObject({ cleanCalendarDays: 90, candidate: true, prerequisitesSatisfied: false, applied: false, historyReset: false });
    expect(assess(occurrences, '2026-05-29').cleanPeriodCredit.candidate).toBe(false);
    const reviewed = assessAttendanceReview({ asOf: '2026-05-30', occurrences,
      creditReview: { requested: true, meetingCompleted: true, approved: true } });
    expect(reviewed.cleanPeriodCredit.prerequisitesSatisfied).toBe(true);
    expect(reviewed.cleanPeriodCredit.applied).toBe(false);
    expect(reviewed.countedAbsences).toBe(1);
    expect(reviewed.occurrences).toHaveLength(1);
    expect(reviewed.cleanPeriodCredit.missingRequirements).toEqual(['Approved policy version and recorded corrective-action retraction']);
  });

  it('does not invent clean days without a baseline and includes pending incidents in the baseline', () => {
    expect(assess([]).cleanPeriodCredit.cleanCalendarDays).toBeNull();
    expect(assessAttendanceReview({ asOf: '2026-05-30', employmentStartDate: '2026-03-01', occurrences: [] }).cleanPeriodCredit.cleanCalendarDays).toBe(90);
    expect(assessAttendanceReview({ asOf: '2026-05-30', employmentStartDate: '2026-03-01', occurrences: [absence('pending', '2026-05-29', { review: 'pending' })] }).cleanPeriodCredit.cleanCalendarDays).toBe(1);
  });

  it('rejects invalid dates, duplicate records and invalid lateness rather than silently miscounting', () => {
    expect(() => assess([], '2026-02-30')).toThrow('Invalid calendar date');
    expect(() => assess([], new Date('invalid'))).toThrow('Invalid assessment timestamp');
    expect(() => assess([absence('same', '2026-09-01'), absence('same', '2026-09-01')])).toThrow('unique');
    expect(() => assess([absence('bad', '2026-09-01', { kind: 'tardy', minutesLate: NaN })])).toThrow('finite');
  });
});

it('combines reviewed early departures with tardies without also counting absences', () => {
  const result = assess([
    absence('late', '2026-09-01', { kind: 'tardy', minutesLate: 7 }),
    ...[1, 2, 3].map((n) => absence(`early-${n}`, '2026-09-01', { kind: 'left_early', minutesEarly: 7 })),
    absence('below', '2026-09-01', { kind: 'left_early', minutesEarly: 6 }),
    absence('unknown', '2026-09-01', { kind: 'left_early' }),
  ]);
  expect(result.countedTardies).toBe(4);
  expect(result.countedEarlyDepartures).toBe(3);
  expect(result.countedAbsences).toBe(0);
  expect(result.pendingReviewIds).toEqual(['unknown']);
  expect(result.candidateNotices[0]).toMatchObject({ kind: 'tardy_threshold', threshold: 4 });
});
