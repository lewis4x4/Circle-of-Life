import { parseISO, startOfDay, differenceInCalendarDays } from "date-fns";

export type LicenseStanding = "pending" | "active" | "probation" | "suspended" | "expired";

export function ahcaExpiryYmd(row: Record<string, unknown>): string | null {
  const ahca = row.ahca_license_expiration ?? row.license_expiration;
  if (typeof ahca === "string" && /^\d{4}-\d{2}-\d{2}$/.test(ahca)) return ahca;
  return null;
}

/** Calendar-day delta from facility-local "today": positive = renewal in future, negative = past due. */
export function daysBetweenTodayAndRenewal(expiryIso: string | null | undefined): number | null {
  if (!expiryIso || !/^\d{4}-\d{2}-\d{2}$/.test(expiryIso)) return null;
  try {
    const target = startOfDay(parseISO(`${expiryIso}T12:00:00.000Z`));
    const today = startOfDay(new Date());
    return differenceInCalendarDays(target, today);
  } catch {
    return null;
  }
}

/** Maps license record + AHCA disposition onto operator-facing pillars (no fabricated DB enums). */
export function deriveLicenseStanding(args: {
  licenseNumberPresent: boolean;
  expiryIso: string | null;
  /** facilities.last_survey_result */
  lastSurveyResult: string | null | undefined;
  /** facilities.status row */
  facilityStatus: string | null | undefined;
}): LicenseStanding {
  const daysLeft = args.expiryIso ? daysBetweenTodayAndRenewal(args.expiryIso) : null;
  if (!args.licenseNumberPresent && daysLeft === null && !args.expiryIso) {
    return "pending";
  }
  if (typeof daysLeft === "number" && daysLeft < 0) return "expired";

  const r = typeof args.lastSurveyResult === "string" ? args.lastSurveyResult.trim() : "";
  if (r === "immediate_jeopardy") return "suspended";
  if (r === "conditional") return "probation";
  const st = typeof args.facilityStatus === "string" ? args.facilityStatus.trim() : "";
  if (st === "archived") return "pending";

  return "active";
}

export function licenseStandingTone(
  standing: LicenseStanding,
): "success" | "warning" | "danger" | "muted" | "info" {
  switch (standing) {
    case "active":
      return "success";
    case "probation":
      return "warning";
    case "suspended":
    case "expired":
      return "danger";
    case "pending":
      return "info";
    default:
      return "muted";
  }
}

export function licenseStandingLabel(standing: LicenseStanding): string {
  switch (standing) {
    case "active":
      return "Active";
    case "probation":
      return "Probation";
    case "suspended":
      return "Suspended";
    case "expired":
      return "Expired";
    case "pending":
      return "Pending verification";
    default:
      return "Unknown";
  }
}

export function renewalCountdownAccentClass(days: number | null): string {
  if (days === null) return "text-muted-foreground";
  if (days < 0) return "text-destructive";
  if (days < 30) return "text-destructive";
  if (days < 90) return "text-warning";
  return "text-foreground";
}
