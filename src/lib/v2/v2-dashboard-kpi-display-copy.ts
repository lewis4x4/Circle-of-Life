/**
 * Quiet Operator copy for W1 dashboard KPI shells (`/admin`, `/admin/executive`,
 * `/admin/quality`, `/admin/rounding`).
 *
 * Live KPI values are populated by snapshot jobs — until then each tile names its
 * gap instead of showing a silent em dash. Real posted zeros stay numeric when wired.
 */

export const V2_DASHBOARD_FAMILY_PORTAL_NOTES_LABEL = "Family portal notes";

export const V2_DASHBOARD_FAMILY_BULLETIN_NOTES_GAP_COPY = "No bulletin notes posted yet";

/** Per-tile shell gap values in canonical KPI order for each W1 dashboard. */
export const V2_DASHBOARD_KPI_GAP_VALUES = {
  "command-center": [
    "No open alerts posted",
    "No eMAR variance posted",
    "No falls posted",
    "No survey window posted",
    "No active admits posted",
    V2_DASHBOARD_FAMILY_BULLETIN_NOTES_GAP_COPY,
  ],
  "executive-intelligence": [
    "No occupancy posted",
    "No labor cost posted",
    "No revenue posted",
    "No margin posted",
    "No NPS posted",
    "No risk score posted",
  ],
  "clinical-quality": [
    "No eMAR variance posted",
    "No falls posted",
    "No pressure injuries posted",
    "No readmissions posted",
    "No care plans posted",
    "No infection rate posted",
  ],
  "rounding-operations": [
    "No rounds posted",
    "No overdue rounds posted",
    "No active watches posted",
    "No open escalations posted",
    "No plan changes posted",
    "No integrity score posted",
  ],
} as const satisfies Record<
  "command-center" | "executive-intelligence" | "clinical-quality" | "rounding-operations",
  readonly [string, string, string, string, string, string]
>;

const ALL_V2_DASHBOARD_SHELL_KPI_GAP_VALUES = new Set<string>(
  Object.values(V2_DASHBOARD_KPI_GAP_VALUES).flat(),
);

/** True when a KPI tile still carries shell gap copy (not a wired numeric metric). */
export function isV2DashboardShellKpiGapValue(value: string | number | null | undefined): boolean {
  if (value == null || value === "") return true;
  if (typeof value === "number") return false;
  return ALL_V2_DASHBOARD_SHELL_KPI_GAP_VALUES.has(value);
}
