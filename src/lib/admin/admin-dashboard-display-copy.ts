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

/**
 * Relative posted-time label for admin dashboard census and activity feeds.
 * Names a missing timestamp gap — never show a silent em dash.
 */
export function formatAdminDashboardRelativeShort(
  iso: string | null | undefined,
): string {
  if (iso == null) return ADMIN_DASHBOARD_NO_DATE_COPY;
  const trimmed = iso.trim();
  if (!trimmed || isAdminDashboardDateGap(trimmed)) return ADMIN_DASHBOARD_NO_DATE_COPY;

  const t = new Date(trimmed).getTime();
  if (Number.isNaN(t)) return ADMIN_DASHBOARD_NO_DATE_COPY;

  const diffMin = Math.round((Date.now() - t) / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 48) return `${diffHr} hr ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(
    new Date(trimmed),
  );
}
