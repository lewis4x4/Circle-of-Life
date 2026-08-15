/**
 * Quiet Operator copy for executive surfaces when KPI/board metrics are absent.
 * Copy reflects real data gaps — never fabricates occupancy, revenue, or confidence.
 */

import type { PresenceCensus } from "@/lib/executive/presence-census";
import { formatUsdFromCents } from "@/lib/insurance/format-money";

export const EXECUTIVE_NO_OCCUPANCY_POSTED_COPY = "No occupancy posted";
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

export function isFiniteExecutiveMetric(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Table occupancy — raw number when posted (0 stays 0); explicit gap copy when missing. */
export function formatExecutiveOccupancyPct(value: number | null | undefined): string {
  if (!isFiniteExecutiveMetric(value)) return EXECUTIVE_NO_OCCUPANCY_POSTED_COPY;
  return String(value);
}

/** Occupancy with % suffix — 0% when posted as zero; explicit gap copy when missing. */
export function formatExecutiveOccupancyPctWithSuffix(value: number | null | undefined): string {
  if (!isFiniteExecutiveMetric(value)) return EXECUTIVE_NO_OCCUPANCY_POSTED_COPY;
  return `${value}%`;
}

/** Bar chart occupancy — one decimal + % when posted. */
export function formatExecutiveOccupancyBarLabel(value: number | null | undefined): string {
  if (!isFiniteExecutiveMetric(value)) return EXECUTIVE_NO_OCCUPANCY_POSTED_COPY;
  return `${value.toFixed(1)}%`;
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
