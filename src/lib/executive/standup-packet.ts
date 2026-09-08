import { canCompareStandupMetrics, qualifyStandupValue, readStandupSourceQuality } from "@/lib/executive/standup-quality";
import {
  buildStandupComparison,
  hasRecordedPressure,
  buildStandupNarrative,
  STANDUP_SECTION_LABELS,
  type StandupComparison,
  type StandupMetricRow,
  type StandupSectionKey,
  type StandupSnapshotDetail,
} from "@/lib/executive/standup";

export type StandupPacketMetric = {
  key: string;
  label: string;
  description: string;
  fromValue: string;
  toValue: string;
  delta: string;
  sourceMode: string;
  confidenceBand: string;
};

export type StandupPacketSummaryCard = {
  key: string;
  label: string;
  value: string;
  delta: string;
  confidenceBand: string;
};

export type StandupPacketLegendItem = {
  label: string;
  description: string;
};

export type StandupPacketSection = {
  sectionKey: StandupSectionKey;
  sectionLabel: string;
  metrics: StandupPacketMetric[];
};

export type StandupPacketFacilitySpotlight = {
  facilityName: string;
  pressureScore: number;
  topConcern: string;
  whyRed: string[];
  varianceFlags: string[];
  interventions: string[];
};

export type StandupPacketDocument = {
  title: string;
  subtitle: string;
  weekOf: string;
  generatedAt: string;
  publishedAt: string;
  generatedBy: string;
  publishedBy: string;
  status: string;
  confidenceBand: string;
  completenessPct: number;
  version: number;
  summaryCards: StandupPacketSummaryCard[];
  legend: StandupPacketLegendItem[];
  draftNotes: string | null;
  reviewNotes: string | null;
  focusStatement: string;
  topChanges: string[];
  topActions: string[];
  qualityFlags: string[];
  spotlightFacility: StandupPacketFacilitySpotlight | null;
  narrative: ReturnType<typeof buildStandupNarrative>;
  comparison: StandupComparison | null;
  sections: StandupPacketSection[];
  appendixSections: StandupPacketSection[];
  methodology: string[];
};

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function formatMetricValue(metric: StandupMetricRow | undefined): string {
  if (!metric) return "—";
  if (metric.valueText?.trim()) return metric.valueText.trim();
  if (metric.valueNumeric == null) return "—";
  const value = metric.valueType === "currency" ? USD.format(metric.valueNumeric / 100)
    : metric.valueType === "hours" ? `${metric.valueNumeric.toFixed(2)} hrs`
    : metric.valueType === "percent" ? `${metric.valueNumeric.toFixed(1)}%` : `${metric.valueNumeric}`;
  return qualifyStandupValue(metric, value);
}

function formatMetricDelta(left: StandupMetricRow | undefined, right: StandupMetricRow | undefined): string {
  if (!left || !right || left.valueNumeric == null || right.valueNumeric == null) return "—";
  if (!canCompareStandupMetrics(left, right)) return "Comparison unavailable: source coverage, scope or calculation definitions do not support a comparison.";
  const delta = right.valueNumeric - left.valueNumeric;
  if (delta === 0) return "No change";
  if (right.valueType === "currency") return `${delta > 0 ? "+" : "-"}${USD.format(Math.abs(delta) / 100)}`;
  if (right.valueType === "hours") return `${delta > 0 ? "+" : "-"}${Math.abs(delta).toFixed(2)} hrs`;
  if (right.valueType === "percent") return `${delta > 0 ? "+" : "-"}${Math.abs(delta).toFixed(1)}%`;
  return `${delta > 0 ? "+" : "-"}${Math.abs(delta)}`;
}

function methodologyNotes(detail: StandupSnapshotDetail): string[] {
  const bases = new Set(detail.facilities.flatMap((facility) => Object.values(facility.metrics).map((metric) => readStandupSourceQuality(metric)?.basis)));
  const v2 = bases.has("haven_live_v2");
  const legacy = bases.has("haven_live_v1");
  return [
    "Haven live AR uses nonnegative balances from draft, sent, partial and overdue invoices in the selected scope; uncollected AR filters past due dates. COL worksheet mappings remain TBD.",
    "The Haven live invoice average uses the month containing the reporting week's Monday. A facility falls back to positive resident rates only with no qualifying invoices; portfolio fallback occurs only when there are no qualifying invoices across the portfolio.",
    v2 ? "V2 bed counts require available, unoccupied, unblocked and unreserved records. Missing inventory or classifications remain unknown; counts do not establish clinical suitability."
      : "Historical bed figures may include licensed-minus-census estimates. Review captured definitions; these figures do not establish usable accommodation.",
    v2 ? "V2 outlooks exclude recorded arrivals and completed tours; provider activity must be planned. Admission targets can include drafts and remain provisional, not arrival evidence."
      : "Historical expected-event fields may include completed events. Review captured definitions before using them as pending forecasts.",
    ...(v2 && legacy ? ["This report contains multiple calculation versions; different methods are not compared."] : []),
  ];
}

function legendItems(): StandupPacketLegendItem[] {
  return [
    { label: "auto", description: "Calculated from recorded system data; capture coverage may be incomplete." },
    { label: "forecast", description: "Planned expectation for the standup week." },
    { label: "manual", description: "Operator-entered value retained for trust and auditability." },
    { label: "hybrid", description: "Computed with fallback review or partial system dependency." },
    { label: "high / medium / low confidence", description: "Recorded calculation confidence, not an attestation of source coverage or approved business definitions." },
  ];
}

function isMeaningfulPacketMetric(metric: StandupPacketMetric): boolean {
  return metric.toValue !== "—" || metric.fromValue !== "—";
}

function summarizeFocusStatement(
  narrative: ReturnType<typeof buildStandupNarrative>,
): string {
  if (narrative.actions.length > 0) return narrative.actions[0];
  if (narrative.bullets.length > 0) return narrative.bullets[0];
  return "Source review is required before drawing operating conclusions.";
}

export function buildStandupPacketDocument(
  detail: StandupSnapshotDetail,
  previous: StandupSnapshotDetail | null,
): StandupPacketDocument {
  const narrative = buildStandupNarrative(detail, previous);
  const comparison = previous ? buildStandupComparison(previous, detail) : null;
  const currentTotals = detail.facilities.find((facility) => facility.facilityId == null) ?? null;
  const previousTotals = previous?.facilities.find((facility) => facility.facilityId == null) ?? null;

  const appendixSections = (Object.entries(STANDUP_SECTION_LABELS) as Array<[StandupSectionKey, string]>).map(([sectionKey, sectionLabel]) => {
    const metricKeys = Array.from(
      new Set(
        detail.facilities.flatMap((facility) =>
          Object.keys(facility.metrics).filter((metricKey) => facility.metrics[metricKey].sectionKey === sectionKey),
        ),
      ),
    );

    const metrics = metricKeys.map((metricKey) => {
      const currentMetric = currentTotals?.metrics[metricKey];
      const previousMetric = previousTotals?.metrics[metricKey];
      const sample = currentMetric ?? previousMetric;
      return {
        key: metricKey,
        label: sample?.label ?? metricKey,
        description: sample?.description ?? "",
        fromValue: formatMetricValue(previousMetric),
        toValue: formatMetricValue(currentMetric),
        delta: formatMetricDelta(previousMetric, currentMetric),
        sourceMode: currentMetric?.sourceMode ?? sample?.sourceMode ?? "manual",
        confidenceBand: currentMetric?.confidenceBand ?? sample?.confidenceBand ?? "low",
      };
    });

    return {
      sectionKey,
      sectionLabel,
      metrics,
    };
  });

  const sections = appendixSections
    .map((section) => ({
      ...section,
      metrics: section.metrics.filter(isMeaningfulPacketMetric),
    }))
    .filter((section) => section.metrics.length > 0);

  const summaryMetricKeys = [
    "current_ar_cents",
    "current_total_census",
    "total_beds_open",
    "hospital_and_rehab_total",
    "callouts_last_week",
    "current_open_positions",
  ];
  const summaryCards = summaryMetricKeys.map((metricKey) => {
    const currentMetric = currentTotals?.metrics[metricKey];
    const previousMetric = previousTotals?.metrics[metricKey];
    const sample = currentMetric ?? previousMetric;
    return {
      key: metricKey,
      label: sample?.label ?? metricKey,
      value: formatMetricValue(currentMetric),
      delta: formatMetricDelta(previousMetric, currentMetric),
      confidenceBand: currentMetric?.confidenceBand ?? sample?.confidenceBand ?? "low",
    };
  });

  const spotlightFacility = detail.facilities.filter((facility) => facility.facilityId != null).every(hasRecordedPressure) && narrative.facilityActions[0] && detail.facilities.some((facility) => facility.facilityId === narrative.facilityActions[0].facilityId && hasRecordedPressure(facility))
    ? {
        facilityName: narrative.facilityActions[0].facilityName,
        pressureScore: narrative.facilityActions[0].pressureScore,
        topConcern: narrative.facilityActions[0].topConcern,
        whyRed: narrative.facilityActions[0].whyRed,
        varianceFlags: narrative.facilityActions[0].varianceFlags,
        interventions: narrative.facilityActions[0].interventions,
      }
    : null;

  return {
    title: "Executive Standup Pack",
    subtitle: "Owner and board operating packet",
    weekOf: detail.snapshot.weekOf,
    generatedAt: detail.snapshot.generatedAt,
    publishedAt: detail.snapshot.publishedAt ?? "Not yet",
    generatedBy: detail.snapshot.generatedByName ?? detail.snapshot.generatedById ?? "System",
    publishedBy: detail.snapshot.publishedByName ?? detail.snapshot.publishedById ?? "Not published",
    status: detail.snapshot.status,
    confidenceBand: detail.snapshot.confidenceBand,
    completenessPct: detail.snapshot.completenessPct,
    version: detail.snapshot.publishedVersion,
    summaryCards,
    legend: legendItems(),
    draftNotes: detail.snapshot.draftNotes,
    reviewNotes: detail.snapshot.reviewNotes,
    focusStatement: summarizeFocusStatement(narrative),
    topChanges: narrative.changes.slice(0, 3),
    topActions: narrative.actions.slice(0, 3),
    qualityFlags: narrative.dataQuality.slice(0, 3),
    spotlightFacility,
    narrative,
    comparison,
    sections,
    appendixSections,
    methodology: ["Financial worksheet definitions remain TBD. Recorded Haven values are not certified as equivalent to COL worksheets.", "Calculation time is not source-as-of time. Recording coverage is unconfirmed unless supported by explicit source evidence; fields populated is not operational completeness.", ...methodologyNotes(detail)],
  };
}
