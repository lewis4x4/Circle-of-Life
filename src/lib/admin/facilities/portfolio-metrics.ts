/**
 * Facilities portfolio aggregates — Quiet Operator KPI + occupancy semantics.
 */

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

/** KPI strip / summary number color (portfolio-wide %). */
export function portfolioOccupancyKpiTextClass(pct: number): string {
  if (pct <= 0) return "text-muted-foreground";
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
