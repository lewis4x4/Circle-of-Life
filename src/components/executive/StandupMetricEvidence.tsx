import type { StandupMetricRow } from "@/lib/executive/standup";
import { readStandupSourceQuality, standupCoverageLabel } from "@/lib/executive/standup-quality";

function timeLabel(value: string | null | undefined) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return "Unconfirmed";
  return `${new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }).format(new Date(value))} ET`;
}

export function StandupReportingNotice() {
  return <p role="note" className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground">
    Financial worksheet definitions remain TBD with Jessica. These are recorded Haven values, not confirmed equivalents of COL worksheet terms. Recording coverage is unconfirmed; populated fields and confidence labels do not prove complete source coverage. Times are shown in Eastern Time.
  </p>;
}

export function StandupMetricEvidence({ metric, calculatedAt }: { metric: StandupMetricRow | undefined; calculatedAt?: string | null }) {
  const quality = readStandupSourceQuality(metric);
  const method = quality?.basis === "haven_live_v2" ? "Recorded Haven calculation v2"
    : quality?.basis === "haven_live_v1" ? "Recorded Haven calculation v1"
    : quality?.basis === "manual" ? "Operator entry"
    : quality?.basis === "mixed" ? "Mixed calculation sources" : "Unconfirmed";
  return <details className="mt-2 max-w-xs text-xs text-muted-foreground">
    <summary aria-label={`Source details: ${metric?.label ?? "metric"}`} className="cursor-pointer text-foreground">Source details</summary>
    <dl className="mt-2 space-y-1">
      <div><dt className="inline font-medium">Method: </dt><dd className="inline">{method}</dd></div>
      <div><dt className="inline font-medium">Coverage: </dt><dd className="inline">{standupCoverageLabel(metric)}</dd></div>
      <div><dt className="inline font-medium">Source as of: </dt><dd className="inline">{timeLabel(quality?.source_as_of)}</dd></div>
      <div><dt className="inline font-medium">{quality ? "Calculated: " : "Report generated: "}</dt><dd className="inline">{timeLabel(quality?.calculated_at ?? calculatedAt)}</dd></div>
      {quality?.received_at && <div><dt className="inline font-medium">Entry received: </dt><dd className="inline">{timeLabel(quality.received_at)}</dd></div>}
      <div><dt className="inline font-medium">Record retrieval: </dt><dd className="inline">{quality?.query_complete ? "Completed; recording coverage remains unconfirmed" : "Completeness not recorded"}</dd></div>
      {!quality && metric?.freshnessAt && <div>Previously recorded timestamp: {timeLabel(metric.freshnessAt)}. Source provenance is unconfirmed.</div>}
    </dl>
  </details>;
}
