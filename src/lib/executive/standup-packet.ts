import {
  buildStandupComparison,
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
  if (metric.valueType === "currency") return USD.format(metric.valueNumeric / 100);
  if (metric.valueType === "hours") return `${metric.valueNumeric.toFixed(2)} hrs`;
  if (metric.valueType === "percent") return `${metric.valueNumeric.toFixed(1)}%`;
  return `${metric.valueNumeric}`;
}

function formatMetricDelta(left: StandupMetricRow | undefined, right: StandupMetricRow | undefined): string {
  if (!left || !right || left.valueNumeric == null || right.valueNumeric == null) return "—";
  const delta = right.valueNumeric - left.valueNumeric;
  if (delta === 0) return "No change";
  if (right.valueType === "currency") return `${delta > 0 ? "+" : "-"}${USD.format(Math.abs(delta) / 100)}`;
  if (right.valueType === "hours") return `${delta > 0 ? "+" : "-"}${Math.abs(delta).toFixed(2)} hrs`;
  if (right.valueType === "percent") return `${delta > 0 ? "+" : "-"}${Math.abs(delta).toFixed(1)}%`;
  return `${delta > 0 ? "+" : "-"}${Math.abs(delta)}`;
}

function methodologyNotes(): string[] {
  return [
    "Current AR and uncollected AR totals come from open invoice balances in the selected organization scope.",
    "Average rent is derived from current-month invoices, with resident monthly rate fallback when invoice coverage is incomplete.",
    "Bed availability uses standup bed classifications plus temporary block status so open-bed math reflects real placement constraints.",
    "Forecast rows represent planned commitments for the week and should not be read as live census or discharge facts.",
    "Low-confidence or manual values are intentionally labeled to preserve packet trust when upstream system data is incomplete.",
  ];
}

function legendItems(): StandupPacketLegendItem[] {
  return [
    { label: "auto", description: "Live system fact from structured source data." },
    { label: "forecast", description: "Planned expectation for the standup week." },
    { label: "manual", description: "Operator-entered value retained for trust and auditability." },
    { label: "hybrid", description: "Computed with fallback review or partial system dependency." },
    { label: "high / medium / low confidence", description: "Trust signal for the displayed metric." },
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
  return "Portfolio stable; continue using the packet to monitor change, trust, and intervention priority.";
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

  const spotlightFacility = narrative.facilityActions[0]
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
    methodology: methodologyNotes(),
  };
}
