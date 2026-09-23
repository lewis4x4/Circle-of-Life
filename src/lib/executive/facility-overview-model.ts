/**
 * Display model for the executive facility drill-down.
 *
 * The page reads live facility records and must keep four things apart that a
 * bare number collapses: a recorded zero, a measure that was never recorded, a
 * read that failed, and a figure whose scope is wider than this facility. Every
 * function here returns copy that says which of those it is.
 */

import { formatInTimeZone } from "date-fns-tz";

import type { ExecKpiPayload } from "@/lib/exec-kpi-snapshot";
import { FACILITY_OPERATOR_TZ } from "@/lib/facility-wall-clock";
import { formatUsdFromCents } from "@/lib/insurance/format-money";
import type { TcorSnapshot } from "@/lib/insurance/compute-tcor";
import {
  roundingBandLabel,
  roundingLastObservedLine,
  roundingTrendCoverageLine,
} from "@/lib/resident-assurance/assurance-coverage-copy";
import type {
  ResidentAssuranceFacilityRollup,
  ResidentAssuranceFacilityTrendPoint,
  ResidentAssuranceFacilityTrendRow,
} from "@/lib/resident-assurance/command-center-brief";
import {
  complianceRate,
  formatComplianceRate,
  type ComplianceSummary,
} from "@/lib/rounding/observation-compliance-summary";

/** One independently loaded part of the page. A failed part never hides the others. */
export type SectionState<T> =
  | { status: "loaded"; data: T }
  | { status: "failed"; message: string };

export function loadedSection<T>(data: T): SectionState<T> {
  return { status: "loaded", data };
}

export function failedSection<T>(error: unknown, fallback: string): SectionState<T> {
  return { status: "failed", message: error instanceof Error && error.message ? error.message : fallback };
}

export function settledSection<T>(result: PromiseSettledResult<T>, fallback: string): SectionState<T> {
  return result.status === "fulfilled" ? loadedSection(result.value) : failedSection(result.reason, fallback);
}

export const FACILITY_ROUTES = {
  residents: "/admin/residents",
  incidentsOpen: "/admin/incidents?scope=open",
  incidents: "/admin/incidents",
  medicationErrors: "/admin/medications/errors",
  invoices: "/admin/billing/invoices",
  // No index page lives at /admin/compliance/deficiencies; the open list is on the
  // compliance hub, scoped by the facility selector this page syncs (COL-641).
  deficiencies: "/admin/compliance#open-deficiencies",
  certifications: "/admin/certifications",
  infectionControl: "/admin/infection-control",
  rounding: "/admin/rounding",
  watches: "/admin/rounding/monitoring-orders",
  escalations: "/admin/rounding?filter=escalated",
  integrity: "/admin/rounding/integrity",
  safety: "/admin/rounding/watchlist",
  insurance: "/admin/insurance",
} as const;

export function facilityCensusRoute(facilityId: string): string {
  return `/admin/facilities/${facilityId}`;
}

export function entityRoute(entityId: string): string {
  return `/admin/executive/entity/${entityId}`;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

// ── Needs attention ──────────────────────────────────────────────────────────

/**
 * A recorded item that someone should open. Severity is whatever the record
 * says; the page does not rank an open incident above an open escalation.
 */
export type FacilityAttentionItem = {
  key: string;
  label: string;
  detail: string;
  href: string;
  linkLabel: string;
};

/** A measure with nothing recorded. Work to do, but not an exception. */
export type FacilityCoverageGap = {
  key: string;
  label: string;
  detail: string;
  href: string;
  linkLabel: string;
};

/** Operator-queue rows escalated to the viewer for this facility (COL-593, COL-602). */
export type FacilityOperatorEscalations = {
  facilityId: string;
  didNotRun: number;
  uncleared: number;
};

export function buildFacilityAttentionItems(
  kpi: ExecKpiPayload | null,
  rounding: ResidentAssuranceFacilityRollup | null,
  operator: FacilityOperatorEscalations | null = null,
): FacilityAttentionItem[] {
  const items: FacilityAttentionItem[] = [];

  if (operator) {
    const href = `/admin/operations/work?facility_id=${operator.facilityId}`;
    if (operator.didNotRun > 0) {
      items.push({
        key: "operator-did-not-run",
        label: plural(operator.didNotRun, "check") + " recorded as did not run",
        detail: "Escalated to you when the building recorded it, with the operator's note.",
        href,
        linkLabel: "Open Operations",
      });
    }
    if (operator.uncleared > 0) {
      items.push({
        key: "operator-uncleared",
        label: plural(operator.uncleared, "operator row") + " not cleared by end of day",
        detail: "Still open after the building's operator day closed.",
        href,
        linkLabel: "Open Operations",
      });
    }
  }

  if (kpi) {
    if (kpi.clinical.openIncidents > 0) {
      items.push({
        key: "incidents",
        label: plural(kpi.clinical.openIncidents, "open incident"),
        detail: "Open the record for severity, owner, and next action.",
        href: FACILITY_ROUTES.incidentsOpen,
        linkLabel: kpi.clinical.openIncidents === 1 ? "View incident" : "View incidents",
      });
    }
    if (kpi.clinical.medicationErrorsMtd > 0) {
      items.push({
        key: "medication-errors",
        label: plural(kpi.clinical.medicationErrorsMtd, "medication error") + " this month",
        detail: "Recorded month to date.",
        href: FACILITY_ROUTES.medicationErrors,
        linkLabel: "View medication errors",
      });
    }
    if (kpi.infection.activeOutbreaks > 0) {
      items.push({
        key: "outbreaks",
        label: plural(kpi.infection.activeOutbreaks, "active outbreak"),
        detail: "Unresolved in infection control.",
        href: FACILITY_ROUTES.infectionControl,
        linkLabel: "View infection control",
      });
    }
    if (kpi.compliance.openSurveyDeficiencies > 0) {
      items.push({
        key: "deficiencies",
        label: plural(kpi.compliance.openSurveyDeficiencies, "open survey deficiency", "open survey deficiencies"),
        detail: "Awaiting a plan of correction or its acceptance.",
        href: FACILITY_ROUTES.deficiencies,
        linkLabel: "View deficiencies",
      });
    }
    if (kpi.workforce.certificationsExpiring30d > 0) {
      items.push({
        key: "certifications",
        label: plural(kpi.workforce.certificationsExpiring30d, "staff certification") + " expiring within 30 days",
        detail: "Active certifications with an expiration date in the next 30 days.",
        href: FACILITY_ROUTES.certifications,
        linkLabel: "View certifications",
      });
    }
  }

  if (rounding) {
    if (rounding.openEscalations > 0) {
      items.push({
        key: "escalations",
        label: plural(rounding.openEscalations, "open rounding escalation"),
        detail: "Open or in progress.",
        href: FACILITY_ROUTES.escalations,
        linkLabel: "View escalations",
      });
    }
    if (rounding.criticalSafetyResidents > 0) {
      items.push({
        key: "critical-safety",
        label: plural(rounding.criticalSafetyResidents, "resident") + " at a critical safety score",
        detail: "Latest recorded safety score per resident.",
        href: FACILITY_ROUTES.safety,
        linkLabel: "View safety scores",
      });
    }
    if (rounding.pendingWatchApprovals > 0) {
      items.push({
        key: "watch-approvals",
        label: plural(rounding.pendingWatchApprovals, "watch") + " awaiting approval",
        detail: "Proposed watches that nobody has approved yet.",
        href: FACILITY_ROUTES.watches,
        linkLabel: "View watches",
      });
    }
    if (rounding.openIntegrityFlags > 0) {
      items.push({
        key: "integrity-flags",
        label: plural(rounding.openIntegrityFlags, "open integrity flag"),
        detail: "Rounding entries flagged for review.",
        href: FACILITY_ROUTES.integrity,
        linkLabel: "View integrity review",
      });
    }
  }

  return items;
}

export function buildFacilityCoverageGaps(input: {
  facilityId: string;
  kpi: ExecKpiPayload | null;
  rounding: ResidentAssuranceFacilityRollup | null;
  insurance: TcorSnapshot | null;
}): FacilityCoverageGap[] {
  const gaps: FacilityCoverageGap[] = [];

  if (input.kpi && input.kpi.census.occupancyPct == null) {
    gaps.push({
      key: "census",
      label: "Census not posted",
      detail: "No bed census is on file, so occupancy cannot be shown. Resident presence below is counted separately.",
      href: facilityCensusRoute(input.facilityId),
      linkLabel: "Review census",
    });
  }

  if (input.rounding && !input.rounding.observed) {
    gaps.push({
      key: "rounding",
      label: "No rounding observations recorded",
      detail: "Rounding counts for this facility are absences of records, not results.",
      href: FACILITY_ROUTES.rounding,
      linkLabel: "View rounding",
    });
  }

  if (input.insurance && input.insurance.policyRows === 0 && input.insurance.claimRows === 0) {
    gaps.push({
      key: "insurance",
      label: "No insurance policies or claims on file",
      detail: "Nothing is recorded for the legal entity in this period, so no cost can be shown.",
      href: FACILITY_ROUTES.insurance,
      linkLabel: "View insurance",
    });
  }

  return gaps;
}

/** What the page says instead of "all clear" when nothing recorded needs attention. */
export function attentionEmptyCopy(gapCount: number, failedCount: number): string {
  if (failedCount > 0) {
    return "No open items in the figures that could be read. Some figures could not be read, so this is not an all-clear.";
  }
  if (gapCount > 0) {
    return `No open items recorded. ${gapCount === 1 ? "One measure is" : `${gapCount} measures are`} not recorded, so this is not an all-clear.`;
  }
  return "No open items recorded for this facility.";
}

// ── Facility snapshot ────────────────────────────────────────────────────────

export type SnapshotTileState = "recorded" | "not_recorded";

export type FacilitySnapshotTile = {
  key: "census" | "presence" | "receivables" | "safety" | "compliance" | "workforce" | "infection";
  label: string;
  /** Headline value. For a recorded zero this is a number; for an unrecorded measure it names the gap. */
  value: string;
  /** Unit, period, or basis — what the value is counted from. */
  detail: string;
  state: SnapshotTileState;
  href: string;
  linkLabel: string;
};

export function buildFacilitySnapshotTiles(kpi: ExecKpiPayload, facilityId: string): FacilitySnapshotTile[] {
  const censusLoaded = kpi.census.occupancyPct != null;
  const presence = kpi.census.presence ?? null;

  // The percentage comes from the posted bed grid (physical beds), which can be
  // smaller than the licence, so the tile names that basis instead of implying
  // "occupied of licensed".
  const censusTile: FacilitySnapshotTile = censusLoaded
    ? {
        key: "census",
        label: "Census",
        value: plural(kpi.census.occupiedResidents, "bed") + " occupied",
        detail: `${Math.round(kpi.census.occupancyPct ?? 0)}% of the posted bed grid · ${kpi.census.licensedBeds} licensed`,
        state: "recorded",
        href: facilityCensusRoute(facilityId),
        linkLabel: "View census",
      }
    : {
        key: "census",
        label: "Census",
        value: "Not posted",
        detail: `${kpi.census.licensedBeds} licensed beds · no bed census on file`,
        state: "not_recorded",
        href: facilityCensusRoute(facilityId),
        linkLabel: "Review census",
      };

  const presenceTile: FacilitySnapshotTile = presence
    ? presence.total === 0
      ? {
          key: "presence",
          label: "Resident presence",
          value: "No residents on the roster",
          detail: "Counted from resident records with an active, hospital, or leave status.",
          state: "recorded",
          href: FACILITY_ROUTES.residents,
          linkLabel: "View residents",
        }
      : {
          key: "presence",
          label: "Resident presence",
          value: `${presence.inHouse} in-house`,
          detail: `${presence.hospital} hospital · ${presence.onLeave} on leave · ${presence.total} on the roster`,
          state: "recorded",
          href: FACILITY_ROUTES.residents,
          linkLabel: "View residents",
        }
    : {
        key: "presence",
        label: "Resident presence",
        value: "Not counted",
        detail: "Resident presence was not included in this read.",
        state: "not_recorded",
        href: FACILITY_ROUTES.residents,
        linkLabel: "View residents",
      };

  const receivablesTile: FacilitySnapshotTile =
    kpi.financial.openInvoicesCount === 0
      ? {
          key: "receivables",
          label: "Open receivables",
          value: "None open",
          detail: "No invoices with a balance due.",
          state: "recorded",
          href: FACILITY_ROUTES.invoices,
          linkLabel: "View invoices",
        }
      : {
          key: "receivables",
          label: "Open receivables",
          value: formatUsdFromCents(kpi.financial.totalBalanceDueCents),
          detail: `${plural(kpi.financial.openInvoicesCount, "open invoice")} with a balance due`,
          state: "recorded",
          href: FACILITY_ROUTES.invoices,
          linkLabel: "View invoices",
        };

  // Order: the four operating measures first (census, presence, receivables,
  // workforce), then the three that also surface under Needs attention when
  // non-zero and read here as recorded zeros when not.
  return [
    censusTile,
    presenceTile,
    receivablesTile,
    {
      key: "workforce",
      label: "Workforce",
      value: plural(kpi.workforce.certificationsExpiring30d, "certification") + " expiring",
      detail: "Active staff certifications expiring in the next 30 days.",
      state: "recorded",
      href: FACILITY_ROUTES.certifications,
      linkLabel: "View certifications",
    },
    {
      key: "safety",
      label: "Safety",
      value: plural(kpi.clinical.openIncidents, "open incident"),
      detail: `${plural(kpi.clinical.medicationErrorsMtd, "medication error")} month to date`,
      state: "recorded",
      href: FACILITY_ROUTES.incidents,
      linkLabel: "View incidents",
    },
    {
      key: "compliance",
      label: "Compliance",
      value: plural(kpi.compliance.openSurveyDeficiencies, "open deficiency", "open deficiencies"),
      detail: "Survey deficiencies without an accepted correction.",
      state: "recorded",
      href: FACILITY_ROUTES.deficiencies,
      linkLabel: "View deficiencies",
    },
    {
      key: "infection",
      label: "Infection control",
      value: plural(kpi.infection.activeOutbreaks, "active outbreak"),
      detail: "Outbreaks without a resolution date.",
      state: "recorded",
      href: FACILITY_ROUTES.infectionControl,
      linkLabel: "View infection control",
    },
  ];
}

// ── Rounding ─────────────────────────────────────────────────────────────────

export type RoundingComplianceDisplay =
  | { state: "successful-empty"; from: string; to: string }
  | {
      state: "configuration-gap";
      from: string;
      to: string;
      configurationGaps: number;
    }
  | {
      state: "recorded";
      from: string;
      to: string;
      completed: number;
      missed: number;
      expected: number;
      configurationGaps: number;
      rateLabel: string;
    };

/**
 * Executive roll-up of the version-aware compliance response.
 *
 * Configuration gaps stay outside the completion denominator. A successful
 * response with no expected windows is also a named state; it must not become
 * a favorable-looking 0 missed or 100% completed.
 */
export function buildRoundingComplianceDisplay(
  summary: ComplianceSummary,
): RoundingComplianceDisplay {
  const { expected, satisfied, unconfigured } = summary.totals;
  if (expected === 0 && unconfigured === 0) {
    return { state: "successful-empty", from: summary.from, to: summary.to };
  }
  if (expected === 0) {
    return {
      state: "configuration-gap",
      from: summary.from,
      to: summary.to,
      configurationGaps: unconfigured,
    };
  }
  return {
    state: "recorded",
    from: summary.from,
    to: summary.to,
    completed: satisfied,
    missed: Math.max(0, expected - satisfied),
    expected,
    configurationGaps: unconfigured,
    rateLabel: formatComplianceRate(complianceRate(summary.totals)),
  };
}

/** Compact inclusive range label with date-only parsing, so UTC cannot move a day. */
export function roundingComplianceRangeLabel(from: string, to: string): string {
  const fromMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(from);
  const toMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(to);
  if (!fromMatch || !toMatch) return `${from}–${to} · ${FACILITY_OPERATOR_TZ}`;
  if (fromMatch[1] === toMatch[1] && fromMatch[2] === toMatch[2]) {
    return `${shortDayLabel(from)}–${Number(toMatch[3])}, ${toMatch[1]} · ${FACILITY_OPERATOR_TZ}`;
  }
  return `${shortDayLabel(from)}–${longDateLabel(to)} · ${FACILITY_OPERATOR_TZ}`;
}

export type RoundingDayCell = {
  date: string;
  /** Short operator label, e.g. "Sep 9". */
  label: string;
  observed: boolean;
  band: ResidentAssuranceFacilityTrendPoint["heatBand"];
  bandLabel: string;
  /** Only the non-zero parts, e.g. "1 escalation · 2 watch starts"; empty when nothing was open that day. */
  breakdown: string;
};

export type RoundingSummary = {
  observed: boolean;
  bandLabel: string;
  lastObservedLine: string;
  coverageLine: string;
  expectationLine: string;
  openItems: Array<{ key: string; label: string; count: number; href: string }>;
  days: RoundingDayCell[];
};

export const ROUNDING_BAND_EXPLANATION =
  "Each day's band comes from what was recorded that day: a watch start counts 1, an integrity flag 2, an escalation 3, and a resident at a critical safety score 4. Low is under 3, Watch 3 to 6, Elevated 7 to 11, Critical 12 or more.";

export const ROUNDING_FINDINGS_SCOPE_COPY =
  "Finding bands are separate from completion compliance. They summarize watches, integrity flags, escalations, and critical safety scores recorded that day.";

/** "2026-09-09" → "Sep 9" without a timezone shift. */
export function shortDayLabel(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const monthIndex = Number(match[2]) - 1;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[monthIndex] ?? match[2]} ${Number(match[3])}`;
}

export function roundingDayBreakdown(point: ResidentAssuranceFacilityTrendPoint): string {
  const parts: string[] = [];
  if (point.escalations > 0) parts.push(plural(point.escalations, "escalation"));
  if (point.criticalResidents > 0) parts.push(plural(point.criticalResidents, "critical-score resident"));
  if (point.integrityFlags > 0) parts.push(plural(point.integrityFlags, "integrity flag"));
  if (point.watchStarts > 0) parts.push(plural(point.watchStarts, "watch start"));
  return parts.join(" · ");
}

export function buildRoundingSummary(
  rollup: ResidentAssuranceFacilityRollup,
  trend: ResidentAssuranceFacilityTrendRow | null,
): RoundingSummary {
  const days: RoundingDayCell[] = (trend?.points ?? []).map((point) => ({
    date: point.date,
    label: shortDayLabel(point.date),
    observed: point.observed,
    band: point.heatBand,
    bandLabel: roundingBandLabel({ observed: point.observed, heatBand: point.heatBand }),
    breakdown: point.observed ? roundingDayBreakdown(point) : "",
  }));

  return {
    observed: rollup.observed,
    bandLabel: roundingBandLabel(rollup),
    lastObservedLine: roundingLastObservedLine(rollup.lastObservedAt),
    coverageLine: trend ? roundingTrendCoverageLine(trend) : "No days in range",
    expectationLine: ROUNDING_FINDINGS_SCOPE_COPY,
    openItems: [
      { key: "watches", label: "Active watches", count: rollup.activeWatches, href: FACILITY_ROUTES.watches },
      { key: "approvals", label: "Awaiting approval", count: rollup.pendingWatchApprovals, href: FACILITY_ROUTES.watches },
      { key: "escalations", label: "Open escalations", count: rollup.openEscalations, href: FACILITY_ROUTES.escalations },
      { key: "integrity", label: "Integrity flags", count: rollup.openIntegrityFlags, href: FACILITY_ROUTES.integrity },
      { key: "critical", label: "Critical safety scores", count: rollup.criticalSafetyResidents, href: FACILITY_ROUTES.safety },
    ],
    days,
  };
}

// ── Entity insurance costs ───────────────────────────────────────────────────

export type InsuranceCostDisplay =
  | { state: "not_on_file"; periodLine: string }
  | { state: "recorded"; periodLine: string; total: string; breakdownLine: string };

export const INSURANCE_ENTITY_SCOPE_COPY =
  "Figures belong to the legal entity. They are not allocated to this facility.";

/** "2025-09-15" → "Sep 15, 2025" without a timezone shift. */
export function longDateLabel(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  return `${shortDayLabel(isoDate)}, ${match[1]}`;
}

export function buildInsuranceCostDisplay(snapshot: TcorSnapshot): InsuranceCostDisplay {
  const periodLine = `${longDateLabel(snapshot.periodStart)} – ${longDateLabel(snapshot.periodEnd)} · rolling 12 months`;
  if (snapshot.policyRows === 0 && snapshot.claimRows === 0) {
    return { state: "not_on_file", periodLine };
  }
  return {
    state: "recorded",
    periodLine,
    total: formatUsdFromCents(snapshot.tcorCents),
    breakdownLine: `${formatUsdFromCents(snapshot.premiumsCents)} premiums across ${plural(snapshot.policyRows, "policy", "policies")} · ${formatUsdFromCents(snapshot.incurredLossesCents)} incurred losses (paid plus reserves) across ${plural(snapshot.claimRows, "claim")}`,
  };
}

// ── Freshness ────────────────────────────────────────────────────────────────

/** "Updated Sep 15, 6:52 PM ET" — the moment this page last read its records. */
export function updatedAtLine(loadedAt: Date | null): string {
  if (!loadedAt) return "Not yet loaded";
  return `Updated ${formatInTimeZone(loadedAt, FACILITY_OPERATOR_TZ, "MMM d, h:mm a")} ET`;
}
