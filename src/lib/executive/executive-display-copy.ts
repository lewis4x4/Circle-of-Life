/**
 * Quiet Operator copy for executive surfaces when KPI/board metrics are absent.
 * Copy reflects real data gaps — never fabricates occupancy, revenue, or confidence.
 */

import { portfolioStripKpiEmptyCopy } from "@/lib/admin/facilities/portfolio-hub-kpi-copy";
import type { PresenceCensus } from "@/lib/executive/presence-census";
import type { StandupMetricRow } from "@/lib/executive/standup";
import { formatUsdFromCents } from "@/lib/insurance/format-money";
import {
  PORTFOLIO_OCCUPANCY_NO_POSTED_COPY,
  formatPortfolioOccupancyPctDisplay,
  formatPortfolioOccupancyPctValue,
  portfolioOccupancyScopeFootnote,
  resolvePortfolioOccupancyHeadlineLabel,
  type PortfolioOccupancyScope,
} from "@/lib/occupancy/portfolio-occupancy-display";

export const EXECUTIVE_NO_OCCUPANCY_POSTED_COPY = PORTFOLIO_OCCUPANCY_NO_POSTED_COPY;
export const EXECUTIVE_NO_IN_HOUSE_COUNT_POSTED_COPY = "No in-house count posted";
export const EXECUTIVE_NO_HOSPITAL_COUNT_POSTED_COPY = "No hospital count posted";
export const EXECUTIVE_NO_LEAVE_COUNT_POSTED_COPY = "No leave count posted";
export const EXECUTIVE_NO_GENERATE_TIME_POSTED_COPY = "No generate time posted";
export const EXECUTIVE_NO_PACKET_STATUS_POSTED_COPY = "No packet status posted";
export const EXECUTIVE_NO_CONFIDENCE_POSTED_COPY = "No confidence posted";
export const EXECUTIVE_NO_LEAGUE_SCORE_POSTED_COPY = "No league score posted";
export const EXECUTIVE_NO_RISK_SCORE_POSTED_COPY = "No risk score posted";
export const EXECUTIVE_NO_COMPLETENESS_POSTED_COPY = "No completeness posted";
export const EXECUTIVE_NO_LAST_SAVED_COPY = "No save recorded";
export const EXECUTIVE_NO_PACKET_DATE_POSTED_COPY = "No packet date posted";
export const EXECUTIVE_NO_DEFICIENCY_COUNT_POSTED_COPY = "No deficiency count posted";
export const EXECUTIVE_NO_INCIDENT_COUNT_POSTED_COPY = "No incident count posted";
export const EXECUTIVE_NO_INVOICE_COUNT_POSTED_COPY = "No invoice count posted";
export const EXECUTIVE_NO_CERT_COUNT_POSTED_COPY = "No cert count posted";
export const EXECUTIVE_NO_DATE_POSTED_COPY = "No date posted";
export const EXECUTIVE_STANDUP_MANUAL_OR_FUTURE_FEED_COPY = "Manual / future feed";
export const EXECUTIVE_STANDUP_NO_DELTA_COPY = "No comparison posted";
export const EXECUTIVE_STANDUP_NO_METRIC_POSTED_COPY = "No metric posted";

const STANDUP_USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function isFiniteExecutiveMetric(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Table occupancy — one decimal when posted (0 stays 0); explicit gap copy when missing. */
export function formatExecutiveOccupancyPct(value: number | null | undefined): string {
  return formatPortfolioOccupancyPctValue(value);
}

/** Occupancy with % suffix — shared portfolio formatter (Executive + Facilities parity). */
export function formatExecutiveOccupancyPctWithSuffix(value: number | null | undefined): string {
  return formatPortfolioOccupancyPctDisplay(value);
}

/**
 * Officer KPI strip occupancy label — must match header facility scope and census scope.
 */
export function resolveOfficerOccupancyTileLabel(
  facilityScoped: boolean,
  occupancyScope?: PortfolioOccupancyScope | null,
): string {
  return resolvePortfolioOccupancyHeadlineLabel({
    facilityScoped,
    allFacilitiesPosted: occupancyScope?.allFacilitiesPosted ?? true,
  });
}

export function resolveExecutiveOccupancyTileLabel(
  occupancyScope?: PortfolioOccupancyScope | null,
): string {
  return resolvePortfolioOccupancyHeadlineLabel({
    allFacilitiesPosted: occupancyScope?.allFacilitiesPosted ?? true,
  });
}

export function executivePortfolioOccupancyFootnote(
  occupancyScope?: PortfolioOccupancyScope | null,
): string | null {
  if (!occupancyScope) return null;
  return portfolioOccupancyScopeFootnote(occupancyScope);
}

/** Bar chart occupancy — same display rule as portfolio KPI strip. */
export function formatExecutiveOccupancyBarLabel(value: number | null | undefined): string {
  return formatPortfolioOccupancyPctDisplay(value);
}

/** Executive overview `occ_pt` snapshot metric (0–1 fraction) → portfolio % display. */
export function formatExecutiveOccPtPctWithSuffix(occPt: number): string {
  return formatPortfolioOccupancyPctDisplay(occPt * 100);
}

export type ExecutiveFacilityCensusStripInput = {
  occupiedResidents: number;
  licensedBeds: number;
  occupancyPct: number | null;
};

/** Facility drill-down Live KPI census line — portfolio loaded vs unloaded semantics. */
export function formatExecutiveFacilityCensusStripLine(census: ExecutiveFacilityCensusStripInput): string {
  if (census.occupancyPct == null) {
    return portfolioStripKpiEmptyCopy("occupied_beds");
  }
  return `${census.occupiedResidents}/${census.licensedBeds} beds · ${formatPortfolioOccupancyPctDisplay(census.occupancyPct)}`;
}

export function formatExecutivePacketStatus(value: string | null | undefined): string {
  if (value == null || value.trim() === "") return EXECUTIVE_NO_PACKET_STATUS_POSTED_COPY;
  return value;
}

export function formatExecutiveConfidenceBand(value: string | null | undefined): string {
  if (value == null || value.trim() === "") return EXECUTIVE_NO_CONFIDENCE_POSTED_COPY;
  return value;
}

export function formatExecutiveLeagueScore(value: number | null | undefined): string {
  if (!isFiniteExecutiveMetric(value)) return EXECUTIVE_NO_LEAGUE_SCORE_POSTED_COPY;
  return `${value}/100`;
}

export function formatExecutiveRiskScore(value: number | null | undefined): string {
  if (!isFiniteExecutiveMetric(value)) return EXECUTIVE_NO_RISK_SCORE_POSTED_COPY;
  return `${value}/100`;
}

export function formatExecutiveCompletenessPct(value: number | null | undefined): string {
  if (!isFiniteExecutiveMetric(value)) return EXECUTIVE_NO_COMPLETENESS_POSTED_COPY;
  return `${Math.round(value)}%`;
}

export function formatExecutiveLastSavedAt(value: string | null | undefined): string {
  if (value == null || value.trim() === "") return EXECUTIVE_NO_LAST_SAVED_COPY;
  return new Date(value).toLocaleString();
}

export function formatExecutivePacketDate(value: string | null | undefined): string {
  if (value == null || value.trim() === "") return EXECUTIVE_NO_PACKET_DATE_POSTED_COPY;
  return new Date(value).toLocaleDateString();
}

/** Executive snapshot revenue (integer cents) — real zero stays formatted; missing gets explicit copy. */
export function formatExecutiveRevenueMtdCents(value: number | null | undefined): string {
  return formatUsdFromCents(value);
}

/** Total AR outstanding (integer cents) — real $0.00 stays formatted; missing gets explicit copy. */
export function formatExecutiveArOutstandingCents(value: number | null | undefined): string {
  return formatUsdFromCents(value);
}

/** Open survey deficiency count — real zero stays 0; missing names the gap. */
export function formatExecutiveSurveyDeficiencyCount(value: number | null | undefined): string {
  if (value == null) return EXECUTIVE_NO_DEFICIENCY_COUNT_POSTED_COPY;
  return String(value);
}

/** Open incident count — real zero stays 0; missing names the gap. */
export function formatExecutiveOpenIncidentCount(value: number | null | undefined): string {
  if (value == null) return EXECUTIVE_NO_INCIDENT_COUNT_POSTED_COPY;
  return String(value);
}

/** Open invoice count — real zero stays 0; missing names the gap. */
export function formatExecutiveOpenInvoiceCount(value: number | null | undefined): string {
  if (value == null) return EXECUTIVE_NO_INVOICE_COUNT_POSTED_COPY;
  return String(value);
}

/** Certifications expiring count — real zero stays 0; missing names the gap. */
export function formatExecutiveCertsExpiringCount(value: number | null | undefined): string {
  if (value == null) return EXECUTIVE_NO_CERT_COUNT_POSTED_COPY;
  return String(value);
}

/** In-house presence count — real zero stays 0; missing names the gap. */
export function formatExecutiveInHouseCount(presence: PresenceCensus | null | undefined): string {
  if (presence == null) return EXECUTIVE_NO_IN_HOUSE_COUNT_POSTED_COPY;
  return String(presence.inHouse);
}

/** Hospital hold presence count — real zero stays 0; missing names the gap. */
export function formatExecutiveHospitalCount(presence: PresenceCensus | null | undefined): string {
  if (presence == null) return EXECUTIVE_NO_HOSPITAL_COUNT_POSTED_COPY;
  return String(presence.hospital);
}

/** On-leave presence count — real zero stays 0; missing names the gap. */
export function formatExecutiveOnLeaveCount(presence: PresenceCensus | null | undefined): string {
  if (presence == null) return EXECUTIVE_NO_LEAVE_COUNT_POSTED_COPY;
  return String(presence.onLeave);
}

/** Saved report last-generated timestamp — posted datetimes stay formatted. */
export function formatExecutiveLastGeneratedAt(value: string | null | undefined): string {
  if (value == null || value.trim() === "") return EXECUTIVE_NO_GENERATE_TIME_POSTED_COPY;
  return new Date(value).toLocaleString();
}

/** Generic Quiet Operator gap copy — lowercases the metric label for readability. */
export function formatExecutiveNoMetricPostedCopy(metricLabel: string): string {
  const trimmed = metricLabel.trim();
  if (!trimmed) return EXECUTIVE_STANDUP_NO_METRIC_POSTED_COPY;
  return `No ${trimmed.charAt(0).toLowerCase()}${trimmed.slice(1)} posted`;
}

/** Alert / event relative age — missing or invalid ISO dates name the gap. */
export function formatExecutiveRelativeAge(iso: string | null | undefined): string {
  if (!iso) return EXECUTIVE_NO_DATE_POSTED_COPY;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return EXECUTIVE_NO_DATE_POSTED_COPY;
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/** Officer KPI tile value — loading stays …; real zero stays 0; missing names the gap. */
export function formatExecutiveOfficerKpiValue(
  value: number | undefined,
  loading: boolean,
  metricLabel: string,
): string {
  if (loading) return "…";
  if (value == null) return formatExecutiveNoMetricPostedCopy(metricLabel);
  return String(value);
}

/** Officer lane stat line — e.g. "3 overdue" or "No overdue posted". */
export function formatExecutiveOfficerCountLabel(value: number | undefined, noun: string): string {
  if (value == null) return formatExecutiveNoMetricPostedCopy(noun);
  return `${value} ${noun}`;
}

/** Standup metric display — real zero stays formatted; missing names the gap. */
export function formatStandupMetricValue(metric: StandupMetricRow | undefined, fallbackLabel?: string): string {
  if (!metric) {
    return fallbackLabel ? formatExecutiveNoMetricPostedCopy(fallbackLabel) : EXECUTIVE_STANDUP_NO_METRIC_POSTED_COPY;
  }
  if (metric.valueText?.trim()) return metric.valueText.trim();
  if (metric.valueNumeric == null) {
    if (metric.sourceMode === "manual" || metric.sourceMode === "forecast" || metric.sourceMode === "hybrid") {
      return EXECUTIVE_STANDUP_MANUAL_OR_FUTURE_FEED_COPY;
    }
    return formatExecutiveNoMetricPostedCopy(metric.label);
  }
  if (metric.valueType === "currency") return STANDUP_USD.format(metric.valueNumeric / 100);
  if (metric.valueType === "hours") return `${metric.valueNumeric.toFixed(2)} hrs`;
  if (metric.valueType === "percent") return `${metric.valueNumeric.toFixed(1)}%`;
  return `${metric.valueNumeric}`;
}

/** Week-over-week standup delta — missing either side names the gap. */
export function formatStandupMetricDelta(
  metricLeft: StandupMetricRow | undefined,
  metricRight: StandupMetricRow | undefined,
): string {
  if (!metricLeft || !metricRight || metricLeft.valueNumeric == null || metricRight.valueNumeric == null) {
    return EXECUTIVE_STANDUP_NO_DELTA_COPY;
  }
  const delta = metricRight.valueNumeric - metricLeft.valueNumeric;
  if (delta === 0) return "No change";
  if (metricRight.valueType === "currency") {
    return `${delta > 0 ? "+" : "-"}${STANDUP_USD.format(Math.abs(delta) / 100)}`;
  }
  if (metricRight.valueType === "hours") return `${delta > 0 ? "+" : "-"}${Math.abs(delta).toFixed(2)} hrs`;
  if (metricRight.valueType === "percent") return `${delta > 0 ? "+" : "-"}${Math.abs(delta).toFixed(1)}%`;
  return `${delta > 0 ? "+" : "-"}${Math.abs(delta)}`;
}
