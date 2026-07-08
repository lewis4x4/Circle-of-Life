/**
 * Form 1823 renewal helpers (Michelle BH-6).
 * Annual default = exam_date + 365 days; hospital return / significant change
 * marks renewal_due so staff capture a new physician assessment.
 */

/** Add calendar days to a YYYY-MM-DD date string (local calendar math). */
export function addCalendarDaysIso(isoDate: string, days: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

/** Default Form 1823 expiration = exam date + 365 days. */
export function defaultForm1823Expiration(examDate: string | null | undefined): string | null {
  if (!examDate) return null;
  return addCalendarDaysIso(examDate, 365);
}

export function shouldRequireForm1823RenewalOnPresenceChange(args: {
  previousDbStatus: string | null;
  nextDbStatus: string;
}): boolean {
  return args.previousDbStatus === "hospital_hold" && args.nextDbStatus === "active";
}
