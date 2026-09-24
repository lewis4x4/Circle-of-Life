"use client";

/**
 * Below-the-fold sections of the executive overview (COL-703): the facility
 * comparison, the portfolio figures with their calculations, rounding
 * assurance, resident presence and the supporting links. The overview loads
 * this module with next/dynamic so it is not part of /admin/executive's
 * first-load JavaScript.
 */

import type { ResidentDayWindow } from "@/lib/executive/resident-days";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  ChevronDown,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { cn } from "@/lib/utils";

import {
  type ExecutiveOverviewFacility,
} from "@/lib/executive/overview-model";
import {
  type ResidentAssuranceFacilityTrendRow,
  type ResidentAssuranceFacilityRollup,
} from "@/lib/resident-assurance/command-center-brief";
import {
  ROUNDING_EXPECTATION_NOT_RECORDED_COPY,
  roundingBandLabel,
  roundingCountsMeaningLine,
  roundingLastObservedLine,
  roundingTrendCoverageLine,
} from "@/lib/resident-assurance/assurance-coverage-copy";
import {
  type PresenceCensus,
} from "@/lib/executive/presence-census";
import {
  formatExecutiveOccPtPctWithSuffix,
} from "@/lib/executive/executive-display-copy";
import {
  occupancyCalculationLine,
  occupancyContextOccPtFraction,
  occupancyCoverageHeading,
  executiveKpiEmptyCopy,
  occupancyLoadedFootnote,
  type ExecutiveKpiMetricKey,
  type OccupancyContext,
} from "@/lib/executive/kpi-tile-copy";
import {
  OCCUPANCY_CHANGE_UNAVAILABLE_COPY,
  metricChangeLine,
  type MetricChange,
} from "@/lib/executive/metric-change";
import {
  BILLED_REVENUE_SCOPE_LINE,
  billedRevenuePeriodLine,
  facilityTodayIsoDate,
  incidentRateBasis,
  metricFreshness,
  metricRecordedLine,
  type ExecutiveSnapshotState,
} from "@/lib/executive/snapshot-evidence";
import { presenceLabel, presenceTone, type ResidencyStatus } from "@/lib/residents/presence";
import type { StatusPillTone } from "@/components/ui/status-pill";

// View helpers shared by the header, tiles and tables.
function hasMetric(val: number | null | undefined): val is number {
  return typeof val === "number" && Number.isFinite(val);
}
function formatPct(val?: number | null) {
  return hasMetric(val) ? `${(val * 100).toFixed(1)}%` : null;
}
function formatNum(val?: number | null) {
  return hasMetric(val) ? Math.round(val).toLocaleString() : null;
}
function formatCur(val?: number | null) {
  return hasMetric(val) ? `$${(val / 100).toLocaleString()}` : null;
}

const PRESENCE_TONE_DOT: Record<StatusPillTone, string> = {
  muted: "bg-muted-foreground/60",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  info: "bg-info",
};

/**
 * Resident presence band — the in-house vs on-hold split of the occupied
 * population. Additive only: it reuses the occupancy denominator (held beds
 * still count as occupied) and never introduces a second occupancy number.
 * Labels/tones come from the shared presence vocabulary so Command and the
 * resident record read identically.
 */
export function ResidentPresenceBand({ census }: { census: PresenceCensus }) {
  if (census.total <= 0) return null;
  const stats: Array<{ status: ResidencyStatus; value: number }> = [
    { status: "active", value: census.inHouse },
    { status: "hospital", value: census.hospital },
    { status: "loa", value: census.onLeave },
  ];
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Resident presence — all facilities
        </span>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {census.total} in census · {census.onHold} on hold
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {stats.map((stat) => (
          <div key={stat.status} className="flex items-center gap-2">
            <span
              className={cn("size-2 shrink-0 rounded-full", PRESENCE_TONE_DOT[presenceTone(stat.status)])}
              aria-hidden
            />
            <span className="text-[13px] text-muted-foreground">{presenceLabel(stat.status)}</span>
            <span className="text-[15px] font-semibold tabular-nums text-foreground">{stat.value}</span>
          </div>
        ))}
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Counted across every facility, not the one chosen in the top bar. Held beds (hospital &amp;
        leave) stay counted as occupied in occupancy above — this is the in-house vs on-hold split,
        not a second occupancy figure.
      </p>
    </div>
  );
}

type KpiTile = {
  key: ExecutiveKpiMetricKey;
  label: string;
  format: "pct" | "num" | "cur";
};

const KPI_TILES: readonly KpiTile[] = [
  { key: "occ_pt", label: "Occupancy", format: "pct" },
  { key: "rev_mtd", label: "Billed month to date", format: "cur" },
  { key: "labor_pct", label: "Labor cost % of billed revenue", format: "pct" },
  { key: "inc_rate", label: "Incidents per 1,000 resident-days", format: "num" },
  { key: "survey_rd", label: "Survey readiness", format: "pct" },
] as const;

function formatMetricValue(value: number, format: "pct" | "num" | "cur"): string {
  if (format === "pct") return formatPct(value) ?? "";
  if (format === "cur") return formatCur(value) ?? "";
  return formatNum(value) ?? "";
}

/**
 * One tile per portfolio figure. Every tile states the period or basis it was
 * computed on, and change is only drawn against a dated earlier recording.
 */
export function PortfolioFiguresStrip({
  metrics,
  occupancyContext,
  snapshot,
  residentDayWindow,
  metricChanges,
  metricDates,
}: {
  metrics: Record<string, number>;
  occupancyContext: OccupancyContext | null;
  snapshot: ExecutiveSnapshotState;
  residentDayWindow: ResidentDayWindow | null;
  metricChanges: Record<string, MetricChange>;
  metricDates: Record<string, string>;
}) {
  const incidentBasis = incidentRateBasis(snapshot, residentDayWindow);
  const todayIsoDate = facilityTodayIsoDate();
  const portfolioOcc = occupancyContextOccPtFraction(occupancyContext);

  return (
    <section className="flex flex-col gap-2" aria-labelledby="figures-heading">
      <h2 id="figures-heading" className="text-[14px] font-semibold tracking-tight text-foreground">
        Portfolio figures
      </h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {KPI_TILES.map((tile) => {
          const change = metricChanges[tile.key];
          const rawValue = metrics[tile.key];

          // The tile and the comparison footer describe the same figure, so they
          // carry the same coverage wording.
          const label =
            tile.key === "occ_pt" ? occupancyCoverageHeading(occupancyContext) : tile.label;

          // Occupancy reads live from the bed grid; every other figure comes
          // from the recorded run and may only be shown with its basis.
          const value =
            tile.key === "occ_pt"
              ? portfolioOcc !== undefined
                ? formatExecutiveOccPtPctWithSuffix(portfolioOcc)
                : hasMetric(rawValue)
                  ? formatExecutiveOccPtPctWithSuffix(rawValue)
                  : null
              : tile.key === "inc_rate"
                ? hasMetric(rawValue) && incidentBasis.usable
                  ? formatMetricValue(rawValue, tile.format)
                  : null
                : hasMetric(rawValue)
                  ? formatMetricValue(rawValue, tile.format)
                  : null;

          const missingCopy =
            tile.key === "inc_rate" && hasMetric(rawValue) && !incidentBasis.usable
              ? incidentBasis.line
              : executiveKpiEmptyCopy(tile.key);

          const changeLine = metricChangeLine(change, tile.format);

          // Occupancy is read live from the bed grid, so it has no recorded day
          // of its own; every other figure is aged against the operating day
          // rather than against the run, which may have skipped it.
          const recordedLine =
            tile.key === "occ_pt"
              ? null
              : metricRecordedLine(metricFreshness(metricDates[tile.key], todayIsoDate));

          // One qualifier stays visible — the one that changes how the figure
          // is read. A figure describing an earlier day outranks its basis,
          // which moves into the disclosure with the rest.
          const basisLine =
            tile.key === "occ_pt"
              ? occupancyCalculationLine(occupancyContext)
              : tile.key === "rev_mtd"
                ? billedRevenuePeriodLine(snapshot)
                : tile.key === "inc_rate"
                  ? incidentBasis.line
                  : changeLine;
          const summaryLine = recordedLine ?? basisLine;

          const detailLines = [
            // Displaced by a recorded-day line above; it still belongs to the figure.
            recordedLine ? basisLine : null,
            ...(tile.key === "occ_pt"
              ? [
                  occupancyContext ? occupancyLoadedFootnote(occupancyContext) : null,
                  OCCUPANCY_CHANGE_UNAVAILABLE_COPY,
                ]
              : tile.key === "rev_mtd"
                ? [BILLED_REVENUE_SCOPE_LINE, changeLine]
                : tile.key === "labor_pct"
                  ? ["Payroll cost for the period divided by billed revenue for the same period."]
                  : tile.key === "inc_rate"
                    ? [incidentBasis.detail, changeLine]
                    : ["Most recent recorded readiness review per facility, averaged.", changeLine]),
          ];

          const details = (value != null ? detailLines : []).filter(
            (line): line is string => Boolean(line),
          );

          return (
            <div
              key={tile.key}
              className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-4"
            >
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {label}
              </span>
              <div className="flex items-baseline gap-2">
                {value != null ? (
                  <span className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">
                    {value}
                  </span>
                ) : (
                  <span className="text-[13px] font-medium leading-snug text-muted-foreground">
                    {missingCopy}
                  </span>
                )}
                {/* Direction is only drawn against a dated earlier recording,
                    never against a target — the label says which. */}
                {value != null && changeLine && change && change.direction !== "flat" ? (
                  change.direction === "up" ? (
                    <TrendingUp className="size-3.5 text-muted-foreground" aria-label={changeLine} />
                  ) : (
                    <TrendingDown className="size-3.5 text-muted-foreground" aria-label={changeLine} />
                  )
                ) : null}
              </div>
              {/* Basis belongs to a figure. When there is no figure, the line
                  in its place already says why. */}
              {value != null && summaryLine ? (
                <p className="text-[11px] leading-relaxed text-muted-foreground">{summaryLine}</p>
              ) : null}
              {details.length > 0 ? (
                <details className="group/calc mt-auto pt-0.5">
                  <summary
                    className={cn(
                      "inline-flex cursor-pointer list-none items-center gap-1 text-[11px] font-medium text-muted-foreground",
                      "transition-colors hover:text-foreground",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      "[&::-webkit-details-marker]:hidden",
                    )}
                  >
                    How this is calculated
                    <ChevronDown
                      className="size-3 transition-transform group-open/calc:rotate-180"
                      aria-hidden
                    />
                  </summary>
                  {details.map((line) => (
                    <p key={line} className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                      {line}
                    </p>
                  ))}
                </details>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

const PORTFOLIO_MEASURES: ReadonlyArray<{ key: ExecutiveKpiMetricKey; label: string; format: "pct" | "num" | "cur" }> = [
  { key: "occ_pt", label: "Occupancy", format: "pct" },
  { key: "labor_pct", label: "Labor %", format: "pct" },
  { key: "inc_rate", label: "Incidents / 1k", format: "num" },
  { key: "survey_rd", label: "Survey %", format: "pct" },
];

/** Facility comparison — each cell either a reported figure or a named gap. */
export function PortfolioComparisonTable({
  facilities,
  metrics,
  occupancyContext,
}: {
  facilities: ExecutiveOverviewFacility[];
  metrics: Record<string, number>;
  occupancyContext: OccupancyContext | null;
}) {
  const portfolioOcc = occupancyContextOccPtFraction(occupancyContext);

  return (
    <section className="flex flex-col gap-3" aria-labelledby="comparison-heading">
      <div className="flex items-center justify-between">
        <h2
          id="comparison-heading"
          className="inline-flex items-center gap-2 text-[14px] font-semibold tracking-tight text-foreground"
        >
          <Activity className="size-4 text-info" aria-hidden /> Portfolio comparison
        </h2>
        <Link
          href="/admin/reports"
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-md border border-border bg-card px-2.5 text-[12px] font-medium",
            "text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          Open reports <ArrowRight className="size-3" aria-hidden />
        </Link>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {/* The table scrolls inside the card, so the region needs to be reachable
            by keyboard on narrow viewports. */}
        <div
          className="max-h-[480px] overflow-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          tabIndex={0}
          role="region"
          aria-label="Portfolio comparison by facility"
        >
          <table className="w-full text-[13px]">
            <caption className="sr-only">
              Reported measures by facility. Cells without a figure say why the measure is missing.
            </caption>
            <thead className="sticky top-0 z-10 bg-background/95">
              <tr className="border-b border-border">
                <th scope="col" className="h-9 px-3 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Facility
                </th>
                {PORTFOLIO_MEASURES.map((measure) => (
                  <th
                    key={measure.key}
                    scope="col"
                    className="h-9 px-3 text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
                  >
                    {measure.label}
                  </th>
                ))}
                <th scope="col" className="h-9 px-3 text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Coverage
                </th>
              </tr>
            </thead>
            <tbody>
              {facilities.length === 0 ? (
                <tr>
                  <td colSpan={PORTFOLIO_MEASURES.length + 2} className="px-3 py-8">
                    <div className="text-[13px] font-medium text-foreground">No facilities in scope.</div>
                    <div className="mt-0.5 text-[12px] text-muted-foreground">
                      Confirm facility access for this account, or wait for the next recorded run.
                    </div>
                  </td>
                </tr>
              ) : (
                facilities.map((facility) => {
                  const facilityMetrics = facility.metrics ?? {};
                  const reported = PORTFOLIO_MEASURES.filter((measure) =>
                    hasMetric(facilityMetrics[measure.key]),
                  ).length;
                  return (
                    <tr
                      key={facility.id}
                      className="border-b border-border/60 transition-colors even:bg-muted/30 hover:bg-muted/50"
                    >
                      <th scope="row" className="h-9 px-3 text-left font-medium text-foreground">
                        {facility.name}
                      </th>
                      {PORTFOLIO_MEASURES.map((measure) => {
                        const value = facilityMetrics[measure.key];
                        return (
                          <td key={measure.key} className="h-9 px-3 text-right">
                            {hasMetric(value) ? (
                              <span
                                className={cn(
                                  "tabular-nums",
                                  facilityMeasureToneClass(measure.key, value),
                                )}
                              >
                                {measure.key === "occ_pt"
                                  ? formatExecutiveOccPtPctWithSuffix(value)
                                  : formatMetricValue(value, measure.format)}
                              </span>
                            ) : (
                              <span className="text-[12px] leading-snug text-muted-foreground">
                                {executiveKpiEmptyCopy(measure.key)}
                              </span>
                            )}
                          </td>
                        );
                      })}
                      <td className="h-9 px-3 text-right text-[12px] tabular-nums text-muted-foreground">
                        {reported} of {PORTFOLIO_MEASURES.length}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {facilities.length > 0 && (
              <tfoot>
                <tr className="border-t border-border bg-secondary/40">
                  <th scope="row" className="h-9 px-3 text-left text-[12px] font-semibold text-muted-foreground">
                    {occupancyCoverageHeading(occupancyContext)}
                  </th>
                  <td className="h-9 px-3 text-right text-[13px] font-semibold tabular-nums text-foreground">
                    {portfolioOcc !== undefined
                      ? formatExecutiveOccPtPctWithSuffix(portfolioOcc)
                      : hasMetric(metrics.occ_pt)
                        ? formatExecutiveOccPtPctWithSuffix(metrics.occ_pt)
                        : (
                          <span className="text-[12px] font-normal text-muted-foreground">
                            {executiveKpiEmptyCopy("occ_pt")}
                          </span>
                        )}
                  </td>
                  {PORTFOLIO_MEASURES.slice(1).map((measure) => (
                    <td
                      key={measure.key}
                      className="h-9 px-3 text-right text-[13px] font-semibold tabular-nums text-foreground"
                    >
                      {hasMetric(metrics[measure.key]) ? (
                        formatMetricValue(metrics[measure.key], measure.format)
                      ) : (
                        <span className="text-[12px] font-normal text-muted-foreground">
                          {executiveKpiEmptyCopy(measure.key)}
                        </span>
                      )}
                    </td>
                  ))}
                  <td className="h-9 px-3" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
      {occupancyCalculationLine(occupancyContext) ? (
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          {occupancyCalculationLine(occupancyContext)} Facility percentages below that figure are
          weighted by bed count, so the portfolio percentage can sit below a facility&rsquo;s own.
        </p>
      ) : null}
    </section>
  );
}

/** Colour follows the value, not the column — and only where a threshold is defined. */
function facilityMeasureToneClass(key: ExecutiveKpiMetricKey, value: number): string {
  if (key === "occ_pt") return value > 0.9 ? "text-success" : "text-warning";
  if (key === "labor_pct") return value < 0.55 ? "text-success" : "text-destructive";
  return "text-foreground";
}

/**
 * Rounding assurance — one row per facility: whether anything was recorded,
 * when, what is open, and the day-by-day record with its gaps left visible.
 */
export function RoundingAssuranceTable({
  heatMap,
  trends,
}: {
  heatMap: ResidentAssuranceFacilityRollup[];
  trends: ResidentAssuranceFacilityTrendRow[];
}) {
  const trendByFacility = new Map(trends.map((row) => [row.facilityId, row]));

  return (
    <section className="flex flex-col gap-3" aria-labelledby="rounding-heading">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <h2
            id="rounding-heading"
            className="inline-flex items-center gap-2 text-[14px] font-semibold tracking-tight text-foreground"
          >
            <Activity className="size-4 text-info" aria-hidden /> Rounding assurance
          </h2>
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
            {ROUNDING_EXPECTATION_NOT_RECORDED_COPY}
          </p>
        </div>
        <Link
          href="/admin/rounding"
          className={cn(
            "inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border bg-card px-2.5 text-[12px] font-medium",
            "text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          Open Smart Rounding <ArrowRight className="size-3" aria-hidden />
        </Link>
      </div>

      {heatMap.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-4 py-6">
          <p className="text-[13px] font-medium text-foreground">No rounding records in scope.</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Nothing has been recorded for the facilities this account can see.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div
            className="overflow-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            tabIndex={0}
            role="region"
            aria-label="Rounding findings by facility"
          >
            <table className="w-full text-[13px]">
              <caption className="sr-only">
                Recorded rounding findings by facility, with the days that carry no record shown as gaps.
              </caption>
              <thead className="bg-background/95">
                <tr className="border-b border-border">
                  <th scope="col" className="h-9 px-3 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Facility
                  </th>
                  <th scope="col" className="h-9 px-3 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Recorded
                  </th>
                  <th scope="col" className="h-9 px-3 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Last entry
                  </th>
                  <th scope="col" className="h-9 px-3 text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Open watches
                  </th>
                  <th scope="col" className="h-9 px-3 text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Awaiting approval
                  </th>
                  <th scope="col" className="h-9 px-3 text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Escalations
                  </th>
                  <th scope="col" className="h-9 px-3 text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Data checks
                  </th>
                  <th scope="col" className="h-9 px-3 text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Critical residents
                  </th>
                  <th scope="col" className="h-9 px-3 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Last 7 days
                  </th>
                </tr>
              </thead>
              <tbody>
                {heatMap.map((row) => {
                  const trend = trendByFacility.get(row.facilityId);
                  return (
                    <tr
                      key={row.facilityId}
                      className="border-b border-border/60 transition-colors even:bg-muted/30 hover:bg-muted/50"
                    >
                      <th scope="row" className="h-10 px-3 text-left font-medium text-foreground">
                        <Link
                          href={`/admin/executive/facility/${row.facilityId}`}
                          className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {row.facilityName}
                        </Link>
                      </th>
                      <td className="h-10 px-3">
                        <span
                          className={cn(
                            "inline-flex h-5 items-center whitespace-nowrap rounded border px-1.5 text-[10px] font-medium uppercase tracking-wider",
                            row.observed ? "border-border text-muted-foreground" : "border-warning/40 text-warning",
                          )}
                          title={roundingCountsMeaningLine(row.observed)}
                        >
                          {roundingBandLabel(row)}
                        </span>
                      </td>
                      <td className="h-10 px-3 text-[12px] text-muted-foreground">
                        {roundingLastObservedLine(row.lastObservedAt)}
                      </td>
                      <RoundingCountCell observed={row.observed} value={row.activeWatches} />
                      <RoundingCountCell observed={row.observed} value={row.pendingWatchApprovals} />
                      <RoundingCountCell observed={row.observed} value={row.openEscalations} danger />
                      <RoundingCountCell observed={row.observed} value={row.openIntegrityFlags} danger />
                      <RoundingCountCell observed={row.observed} value={row.criticalSafetyResidents} danger />
                      <td className="h-10 px-3">
                        {trend ? (
                          <div className="flex items-center gap-2">
                            <SevenDayRecord row={trend} />
                            <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                              {roundingTrendCoverageLine(trend)}
                            </span>
                          </div>
                        ) : (
                          <span className="text-[12px] text-muted-foreground">No day series recorded</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Bar height is the pressure recorded that day. A hatched slot means nothing was recorded for
        that facility that day — it is a gap, not a clear day.
      </p>
    </section>
  );
}

function RoundingCountCell({
  observed,
  value,
  danger = false,
}: {
  observed: boolean;
  value: number;
  danger?: boolean;
}) {
  if (!observed) {
    return (
      <td className="h-10 px-3 text-right text-[12px] text-muted-foreground" title="Nothing recorded">
        —
      </td>
    );
  }
  return (
    <td
      className={cn(
        "h-10 px-3 text-right text-[14px] font-semibold tabular-nums",
        danger && value > 0 ? "text-destructive" : "text-foreground",
      )}
    >
      {value}
    </td>
  );
}

/** Seven slots, one per day. Unrecorded days render as gaps rather than as zero. */
function SevenDayRecord({ row }: { row: ResidentAssuranceFacilityTrendRow }) {
  return (
    <div className="flex items-end gap-1" role="img" aria-label={sevenDayLabel(row)}>
      {row.points.map((point) => (
        <div key={`${row.facilityId}:${point.date}`} className="flex h-8 w-3 items-end" title={pointTitle(point)}>
          {point.observed ? (
            <div
              className={cn(
                "w-full rounded-t-sm",
                point.heatBand === "critical"
                  ? "bg-destructive"
                  : point.heatBand === "elevated"
                    ? "bg-warning"
                    : point.heatBand === "watch"
                      ? "bg-warning/60"
                      : "bg-success",
              )}
              style={{ height: `${Math.max(12, Math.min(100, point.heatScore * 7))}%` }}
            />
          ) : (
            // A gap reads as a low, hatched baseline — visibly not a bar.
            <div className="h-1.5 w-full rounded-sm border border-dashed border-border" />
          )}
        </div>
      ))}
    </div>
  );
}

function pointTitle(point: ResidentAssuranceFacilityTrendPointLike): string {
  if (!point.observed) return `${point.date}: nothing recorded`;
  return `${point.date}: recorded pressure ${point.heatScore}`;
}

type ResidentAssuranceFacilityTrendPointLike = ResidentAssuranceFacilityTrendRow["points"][number];

function sevenDayLabel(row: ResidentAssuranceFacilityTrendRow): string {
  return `${row.facilityName}: ${roundingTrendCoverageLine(row)} in the last ${row.days} days.`;
}

const SUPPORTING_LINKS = [
  {
    title: "Executive alerts",
    description: "Every recorded portfolio exception, not just the latest five.",
    href: "/admin/executive/alerts",
  },
  {
    title: "Financial overview",
    description: "Billed revenue, labor cost, and monthly financial statements.",
    href: "/admin/finance",
  },
  {
    title: "Insurance and risk",
    description: "Claims, renewals, and portfolio risk posture.",
    href: "/admin/insurance",
  },
  {
    title: "Open incidents",
    description: "Incident records still open at level 4.",
    href: "/admin/incidents?scope=open&severity=level_4",
  },
] as const;

export function SupportingDestinations() {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="destinations-heading">
      <div>
        <h2 id="destinations-heading" className="text-[14px] font-semibold tracking-tight text-foreground">
          Where to go next
        </h2>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          Destinations, not outstanding work. Anything needing a decision appears above.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {SUPPORTING_LINKS.map((link) => (
          <Link
            key={link.title}
            href={link.href}
            className={cn(
              "group flex flex-col gap-1.5 rounded-lg border border-border bg-card p-4",
              "transition-colors hover:bg-secondary/40",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <h3 className="text-[14px] font-semibold tracking-tight text-foreground">{link.title}</h3>
            <p className="text-[12px] leading-relaxed text-muted-foreground">{link.description}</p>
            <span className="mt-auto inline-flex items-center gap-1 pt-1 text-[12px] font-medium text-foreground">
              Open <ArrowRight className="size-3" aria-hidden />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
