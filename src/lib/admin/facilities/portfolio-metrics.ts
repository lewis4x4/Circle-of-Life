/**
 * Facilities portfolio aggregates — Quiet Operator KPI + occupancy semantics.
 */

/** Survey readiness % from `risk_score_snapshots.summary_json` (0–100 when present). */
export function pickSurveyReadinessPct(summaryJson: unknown): number | null {
  if (!summaryJson || typeof summaryJson !== "object") return null;
  const raw = (summaryJson as Record<string, unknown>).survey_readiness_pct;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(0, Math.min(100, raw));
  }
  if (typeof raw === "string") {
    const n = Number(raw);
    if (Number.isFinite(n)) return Math.max(0, Math.min(100, n));
  }
  return null;
}

export function occupancyDenominator(phyBedsTracked: number, licensedBeds: number): number {
  if (typeof phyBedsTracked === "number" && phyBedsTracked > 0) return phyBedsTracked;
  if (typeof licensedBeds === "number" && licensedBeds > 0) return licensedBeds;
  return 0;
}

export function portfolioOccupancyPercent(occupied: number, phyBeds: number, licensedBeds: number): number {
  const d = occupancyDenominator(phyBeds, licensedBeds);
  if (d <= 0 || occupied <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((occupied / d) * 100)));
}

/** KPI strip — 0 muted, &lt;60 warning, 60–89 success, ≥90 info. */
export function portfolioOccupancyKpiTextClass(pct: number): string {
  if (pct <= 0) return "text-muted-foreground";
  if (pct < 60) return "text-warning";
  if (pct < 90) return "text-success";
  return "text-info";
}

/** SVG donut arc stroke (currentColor tokens). Mirrors KPI breakpoints. */
export function portfolioOccupancyRingStrokeClass(pct: number): string {
  if (pct <= 0) return "text-muted-foreground/35";
  if (pct < 60) return "text-warning";
  if (pct < 90) return "text-success";
  return "text-info";
}

/** Horizontal bar fill (portfolio cards + comparison). */
export function portfolioOccupancyBarClass(pct: number): string {
  if (pct <= 0) return "bg-muted-foreground/25";
  if (pct < 60) return "bg-warning";
  if (pct < 90) return "bg-success";
  return "bg-info";
}

export function portfolioLaborCostTextClass(pct: number): string {
  if (pct > 35) return "text-destructive";
  if (pct >= 30) return "text-warning";
  return "text-muted-foreground";
}
