/**
 * Canonical semantics for facility operational thresholds (Quiet Operator).
 * Direction + domains live in code; org-level defaults are materialized in Postgres (see migration).
 */

import type { ThresholdType } from "@/lib/admin/facilities/facility-constants";

export type ThresholdDirection = "lower_is_worse" | "higher_is_worse";

export type ThresholdDomain =
  | "occupancy_census"
  | "compliance_expirations"
  | "workforce_compliance"
  | "safety_incidents";

export const THRESHOLD_DOMAIN_ORDER: ThresholdDomain[] = [
  "occupancy_census",
  "compliance_expirations",
  "workforce_compliance",
  "safety_incidents",
];

export const THRESHOLD_DOMAIN_LABELS: Record<ThresholdDomain, string> = {
  occupancy_census: "Occupancy & census",
  compliance_expirations: "Compliance expirations",
  workforce_compliance: "Workforce compliance",
  safety_incidents: "Safety drills & incidents",
};

export type AlertFrequencyUi = "once_on_breach" | "daily_until_resolved" | "hourly" | "custom";

export type OperationalThresholdTypeMeta = {
  direction: ThresholdDirection;
  domain: ThresholdDomain;
  /** Short copy for tooltips / expanders */
  description: string;
  /** Default dedupe / digest posture (engine deferred). */
  alertFrequency: AlertFrequencyUi;
};

export const OPERATIONAL_THRESHOLD_CATALOG: Record<ThresholdType, OperationalThresholdTypeMeta> = {
  occupancy_low_pct: {
    direction: "lower_is_worse",
    domain: "occupancy_census",
    description: "Triggers when licensed-bed occupancy falls below the percentage for extended periods.",
    alertFrequency: "daily_until_resolved",
  },
  occupancy_high_pct: {
    direction: "higher_is_worse",
    domain: "occupancy_census",
    description: "Triggers when occupancy exceeds the percentage (over census / crowding risk).",
    alertFrequency: "daily_until_resolved",
  },
  staffing_ratio_violation: {
    direction: "higher_is_worse",
    domain: "workforce_compliance",
    description: "Triggers when scheduled staffing falls below licensed ratio requirements.",
    alertFrequency: "daily_until_resolved",
  },
  license_expiry_days: {
    direction: "lower_is_worse",
    domain: "compliance_expirations",
    description: "Triggers when the facility license is within the configured number of calendar days from expiration.",
    alertFrequency: "daily_until_resolved",
  },
  insurance_expiry_days: {
    direction: "lower_is_worse",
    domain: "compliance_expirations",
    description: "Triggers when a material insurance policy is within the configured days of expiration.",
    alertFrequency: "daily_until_resolved",
  },
  document_expiry_days: {
    direction: "lower_is_worse",
    domain: "compliance_expirations",
    description: "Triggers when a vault document with an expiration date crosses the yellow or red window.",
    alertFrequency: "daily_until_resolved",
  },
  background_check_expiry_days: {
    direction: "lower_is_worse",
    domain: "workforce_compliance",
    description:
      "Triggers when any active staff member's Level 2 screening is within N calendar days of expiration (allow lead time for FDLE renewal).",
    alertFrequency: "daily_until_resolved",
  },
  training_overdue_days: {
    direction: "higher_is_worse",
    domain: "workforce_compliance",
    description: "Triggers when required training is overdue by the configured number of calendar days.",
    alertFrequency: "daily_until_resolved",
  },
  fire_drill_overdue_days: {
    direction: "higher_is_worse",
    domain: "safety_incidents",
    description:
      "Triggers when the facility is beyond the maximum interval since the last documented fire drill (FL 59A-36 quarterly expectation).",
    alertFrequency: "daily_until_resolved",
  },
  elopement_drill_overdue_days: {
    direction: "higher_is_worse",
    domain: "safety_incidents",
    description: "Triggers when elopement / missing-resident drill cadence exceeds the configured interval.",
    alertFrequency: "daily_until_resolved",
  },
  incident_spike_count: {
    direction: "higher_is_worse",
    domain: "safety_incidents",
    description: "Triggers when raw incident volume in a rolling week crosses the yellow or red count.",
    alertFrequency: "once_on_breach",
  },
  census_change_alert: {
    direction: "higher_is_worse",
    domain: "occupancy_census",
    description:
      "Net daily change in licensed bed occupancy. Positive (admissions exceed discharges) or negative (departures exceed arrivals) deltas above the threshold trigger an alert.",
    alertFrequency: "once_on_breach",
  },
};

export function getThresholdMeta(thresholdType: string): OperationalThresholdTypeMeta | null {
  return OPERATIONAL_THRESHOLD_CATALOG[thresholdType as ThresholdType] ?? null;
}

/** Human-facing direction hint between Yellow and Enabled columns. */
export function thresholdDirectionLabel(thresholdType: string): string {
  const m = getThresholdMeta(thresholdType);
  if (!m) return "Verify threshold direction";
  switch (m.direction) {
    case "lower_is_worse":
      if (thresholdType === "occupancy_low_pct") return "Lower % = more urgent";
      return "Fewer days = more urgent";
    case "higher_is_worse":
      if (thresholdType === "occupancy_high_pct") return "Higher % = more urgent";
      if (thresholdType === "incident_spike_count") return "Higher count = more urgent";
      if (thresholdType === "census_change_alert") return "Higher delta = more urgent";
      return "More days = more urgent";
    default:
      return "";
  }
}

export function thresholdPairError(thresholdType: string, yellow: number, red: number): string | null {
  const m = getThresholdMeta(thresholdType);
  if (!m) return null;
  if (!Number.isFinite(yellow) || !Number.isFinite(red)) return "Enter valid numbers";
  if (yellow === red) return "Yellow and red must differ";
  if (m.direction === "lower_is_worse") {
    if (yellow <= red) return "For this type, yellow must be greater than red (tighter red boundary).";
  } else {
    if (red <= yellow) return "For this type, red must be greater than yellow (red is more severe).";
  }
  return null;
}

export function groupThresholdTypesByDomain(types: readonly string[]): Record<ThresholdDomain, string[]> {
  const acc: Record<ThresholdDomain, string[]> = {
    occupancy_census: [],
    compliance_expirations: [],
    workforce_compliance: [],
    safety_incidents: [],
  };
  for (const t of types) {
    const m = getThresholdMeta(t);
    if (!m) continue;
    acc[m.domain].push(t);
  }
  return acc;
}
