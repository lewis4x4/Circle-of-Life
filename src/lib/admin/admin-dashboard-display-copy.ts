/**
 * Quiet Operator copy for admin dashboard resident census cards.
 * Missing DOB names a real gap — never fabricate dates or show a silent em dash.
 */

export const ADMIN_DASHBOARD_NO_DATE_COPY = "No date posted";

const EM_DASH = "—";

function isAdminDashboardDateGap(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed === EM_DASH) return true;
  return trimmed.toLowerCase() === "unknown";
}

/**
 * Date of birth on admin dashboard resident cards (UTC MM/DD/YYYY).
 * Names a missing DOB gap — never invent or assume a date.
 */
export function formatAdminDashboardResidentDobDisplay(
  value: string | null | undefined,
): string {
  if (value == null) return ADMIN_DASHBOARD_NO_DATE_COPY;
  const trimmed = value.trim();
  if (isAdminDashboardDateGap(trimmed)) return ADMIN_DASHBOARD_NO_DATE_COPY;

  const [y, m, d] = trimmed.split("-").map(Number);
  if (!y || !m || !d) return ADMIN_DASHBOARD_NO_DATE_COPY;

  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    Number.isNaN(dt.getTime()) ||
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return ADMIN_DASHBOARD_NO_DATE_COPY;
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  }).format(dt);
}
