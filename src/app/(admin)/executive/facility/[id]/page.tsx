"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ExternalLink, RefreshCw, TriangleAlert } from "lucide-react";

import { ExecutiveHubNav } from "../../executive-hub-nav";
import { AdminLiveDataFallbackNotice } from "@/components/common/AdminLiveDataFallbackNotice";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { fetchExecutiveKpiSnapshot, type ExecKpiPayload } from "@/lib/exec-kpi-snapshot";
import {
  resolveExecutiveFetchErrorBannerMessage,
  resolveExecutiveOrganizationGapMessage,
} from "@/lib/executive/executive-auth-page-state";
import {
  FACILITY_ROUTES,
  INSURANCE_ENTITY_SCOPE_COPY,
  ROUNDING_BAND_EXPLANATION,
  attentionEmptyCopy,
  buildFacilityAttentionItems,
  buildFacilityCoverageGaps,
  buildFacilitySnapshotTiles,
  buildInsuranceCostDisplay,
  buildRoundingSummary,
  entityRoute,
  failedSection,
  settledSection,
  updatedAtLine,
  type RoundingDayCell,
  type SectionState,
} from "@/lib/executive/facility-overview-model";
import { syncSelectedFacilityCookie } from "@/lib/facilities/selected-facility-cookie";
import { computeTotalCostOfRisk, type TcorSnapshot } from "@/lib/insurance/compute-tcor";
import {
  fetchResidentAssuranceFacilityHeatMap,
  fetchResidentAssuranceFacilityTrendSeries,
  type ResidentAssuranceFacilityRollup,
  type ResidentAssuranceFacilityTrendRow,
} from "@/lib/resident-assurance/command-center-brief";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const FACILITY_OVERVIEW_KPI_READ_FAILED = "Facility figures could not be read.";
export const FACILITY_OVERVIEW_ROUNDING_READ_FAILED = "Rounding records could not be read.";
export const FACILITY_OVERVIEW_INSURANCE_READ_FAILED = "Insurance figures could not be read.";

type RoundingData = {
  rollup: ResidentAssuranceFacilityRollup | null;
  trend: ResidentAssuranceFacilityTrendRow | null;
};

const linkClass = "inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline";

function SectionHeading(props: { id: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 id={props.id} className="text-base font-semibold text-foreground">
        {props.children}
      </h2>
      {props.aside}
    </div>
  );
}

function FailedLine(props: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="inline-flex items-start gap-2 text-foreground">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        {props.message}
      </span>
      <Button variant="outline" size="sm" onClick={props.onRetry}>
        Retry
      </Button>
    </div>
  );
}

function bandTone(cell: RoundingDayCell): string {
  if (!cell.observed) return "border-dashed border-border bg-transparent text-muted-foreground";
  switch (cell.band) {
    case "critical":
      return "border-destructive/40 bg-destructive/10 text-foreground";
    case "elevated":
      return "border-warning/40 bg-warning/10 text-foreground";
    case "watch":
      return "border-warning/30 bg-warning/5 text-foreground";
    default:
      return "border-border bg-muted/40 text-foreground";
  }
}

export default function ExecutiveFacilityDetailPage() {
  const params = useParams();
  const rawId = typeof params.id === "string" ? params.id : "";
  const facilityId = UUID_RE.test(rawId) ? rawId : "";
  // Keyed on the facility so one facility's records never linger under
  // another facility's route: switching facilities starts from a clean state.
  return <FacilityOverview key={facilityId} facilityId={facilityId} />;
}

function FacilityOverview({ facilityId }: { facilityId: string }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { organizationId, loading: authLoading } = useHavenAuth();
  const selectedFacilityId = useFacilityStore((state) => state.selectedFacilityId);
  const availableFacilities = useFacilityStore((state) => state.availableFacilities);

  const [fetching, setFetching] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [facilityName, setFacilityName] = useState<string | null>(null);
  const [entityId, setEntityId] = useState<string | null>(null);
  const [entityName, setEntityName] = useState<string | null>(null);
  const [kpi, setKpi] = useState<SectionState<ExecKpiPayload> | null>(null);
  const [rounding, setRounding] = useState<SectionState<RoundingData> | null>(null);
  const [insurance, setInsurance] = useState<SectionState<TcorSnapshot> | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [selectorHeld, setSelectorHeld] = useState(false);
  /** Facility this page last aligned the global selector to. */
  const syncedFacilityIdRef = useRef<string | null>(null);

  const invalidFacilityId = facilityId === "";
  const hasOrgScopedData = Boolean(facilityName || kpi);
  const organizationGapMessage = resolveExecutiveOrganizationGapMessage({
    authLoading,
    organizationId,
    hasOrgScopedData,
  });
  const fetchErrorBannerMessage = resolveExecutiveFetchErrorBannerMessage({
    authLoading,
    fetchError: invalidFacilityId ? "Invalid facility id." : fetchError,
  });
  const loading = authLoading || (!invalidFacilityId && Boolean(organizationId) && fetching);

  // Aligns the global facility selector to the facility being viewed, so every
  // record opened from this page opens under the same facility. A form guard
  // elsewhere may hold the selector; the page then says so instead of pretending.
  const alignSelector = useCallback(() => {
    const store = useFacilityStore.getState();
    if (store.selectedFacilityId === facilityId || store.setSelectedFacility(facilityId)) {
      syncSelectedFacilityCookie(facilityId);
      syncedFacilityIdRef.current = facilityId;
      setSelectorHeld(false);
    } else {
      setSelectorHeld(true);
    }
  }, [facilityId]);

  const load = useCallback(async () => {
    if (authLoading || invalidFacilityId || !organizationId) return;

    try {
      const { data: fac, error: fErr } = await supabase
        .from("facilities")
        .select("id, name, entity_id, organization_id")
        .eq("id", facilityId)
        .is("deleted_at", null)
        .maybeSingle();

      if (fErr) throw fErr;
      if (!fac || fac.organization_id !== organizationId) {
        setFetchError("Facility not found or not in your organization.");
        setFacilityName(null);
        setEntityId(null);
        setEntityName(null);
        setKpi(null);
        setRounding(null);
        setInsurance(null);
        return;
      }

      setFacilityName(fac.name);
      setEntityId(fac.entity_id);
      alignSelector();

      const { data: ent } = await supabase.from("entities").select("name").eq("id", fac.entity_id).maybeSingle();
      setEntityName((ent as { name: string } | null)?.name ?? null);

      // Every part loads on its own. A failed read shows as failed in its own
      // section instead of blanking the parts that did load.
      const [kpiResult, heatMapResult, trendResult, tcorResult] = await Promise.allSettled([
        fetchExecutiveKpiSnapshot(supabase, organizationId, facilityId),
        fetchResidentAssuranceFacilityHeatMap(supabase, organizationId),
        fetchResidentAssuranceFacilityTrendSeries(supabase, organizationId, 7),
        computeTotalCostOfRisk(supabase, { organizationId, entityId: fac.entity_id }),
      ]);

      setKpi(settledSection(kpiResult, FACILITY_OVERVIEW_KPI_READ_FAILED));

      if (heatMapResult.status === "fulfilled" && trendResult.status === "fulfilled") {
        setRounding({
          status: "loaded",
          data: {
            rollup: heatMapResult.value.find((row) => row.facilityId === facilityId) ?? null,
            trend: trendResult.value.find((row) => row.facilityId === facilityId) ?? null,
          },
        });
      } else {
        const reason = heatMapResult.status === "rejected" ? heatMapResult.reason : (trendResult as PromiseRejectedResult).reason;
        setRounding(failedSection(reason, FACILITY_OVERVIEW_ROUNDING_READ_FAILED));
      }

      if (tcorResult.status === "fulfilled") {
        setInsurance(
          tcorResult.value.ok
            ? { status: "loaded", data: tcorResult.value.snapshot }
            : { status: "failed", message: tcorResult.value.error || FACILITY_OVERVIEW_INSURANCE_READ_FAILED },
        );
      } else {
        setInsurance(failedSection(tcorResult.reason, FACILITY_OVERVIEW_INSURANCE_READ_FAILED));
      }

      setLoadedAt(new Date());
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Unable to load facility.");
      setFacilityName(null);
      setKpi(null);
      setRounding(null);
      setInsurance(null);
    } finally {
      setFetching(false);
    }
  }, [alignSelector, authLoading, invalidFacilityId, supabase, facilityId, organizationId]);

  useEffect(() => {
    // Kick the read off after the effect's own synchronous phase, and cancel it
    // if the facility or organization changes before it starts.
    const pending = setTimeout(() => void load(), 0);
    return () => clearTimeout(pending);
  }, [load]);

  const refresh = useCallback(() => {
    setFetching(true);
    setFetchError(null);
    void load();
  }, [load]);

  // Once this page has claimed the selector, the selector leads: moving it to
  // another facility opens that facility's overview, and "All facilities"
  // returns to the portfolio. The page never shows one facility under another.
  useEffect(() => {
    return useFacilityStore.subscribe((state, previous) => {
      if (state.selectedFacilityId === previous.selectedFacilityId) return;
      if (syncedFacilityIdRef.current !== facilityId) return;
      if (state.selectedFacilityId === facilityId) return;
      syncedFacilityIdRef.current = null;
      router.push(
        state.selectedFacilityId ? `/admin/executive/facility/${state.selectedFacilityId}` : "/admin/executive",
      );
    });
  }, [facilityId, router]);

  const selectorFacilityName =
    availableFacilities.find((facility) => facility.id === selectedFacilityId)?.name ?? null;
  const facilityNotInSelector =
    Boolean(facilityName) && availableFacilities.length > 0 && !availableFacilities.some((f) => f.id === facilityId);

  const kpiData = kpi?.status === "loaded" ? kpi.data : null;
  const roundingRollup = rounding?.status === "loaded" ? rounding.data.rollup : null;
  const insuranceData = insurance?.status === "loaded" ? insurance.data : null;

  const attentionItems = buildFacilityAttentionItems(kpiData, roundingRollup);
  const coverageGaps = buildFacilityCoverageGaps({
    facilityId,
    kpi: kpiData,
    rounding: roundingRollup,
    insurance: insuranceData,
  });
  const failedCount = [kpi, rounding, insurance].filter((section) => section?.status === "failed").length;
  const snapshotTiles = kpiData ? buildFacilitySnapshotTiles(kpiData, facilityId) : [];
  const roundingSummary = roundingRollup
    ? buildRoundingSummary(roundingRollup, rounding?.status === "loaded" ? rounding.data.trend : null)
    : null;
  const insuranceDisplay = insuranceData ? buildInsuranceCostDisplay(insuranceData) : null;

  const ready = !loading && !fetchErrorBannerMessage && !organizationGapMessage && Boolean(facilityName);
  const headingName = facilityName ?? "Facility";

  return (
    <div className="space-y-5">
      <ExecutiveHubNav />

      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/admin/executive" className="text-primary underline-offset-4 hover:underline">
              Executive overview
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li aria-current="page" className="text-foreground">
            {loading && !facilityName ? "…" : headingName}
          </li>
        </ol>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-foreground">
            {loading && !facilityName ? <Skeleton className="inline-block h-8 w-56" /> : headingName}
          </h1>
          <p className="text-sm text-muted-foreground">Facility overview</p>
          {entityName && entityId ? (
            <p className="mt-1 text-sm text-foreground">
              Legal entity:{" "}
              <Link href={entityRoute(entityId)} className={linkClass}>
                {entityName}
                <ExternalLink className="size-3.5" aria-hidden />
                <span className="sr-only">(entity overview)</span>
              </Link>
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {fetching ? "Refreshing…" : updatedAtLine(loadedAt)}
          </span>
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
            <RefreshCw className={cn("size-4", fetching && "animate-spin")} aria-hidden />
            Refresh
          </Button>
        </div>
      </header>

      {ready && facilityNotInSelector ? (
        <AdminLiveDataFallbackNotice
          message={`${headingName} is not in your facility selector. Records opened from this page follow the selector, not this facility.`}
          onRetry={refresh}
        />
      ) : null}

      {ready && !facilityNotInSelector && selectorHeld ? (
        <AdminLiveDataFallbackNotice
          message={`The facility selector is being held on ${selectorFacilityName ?? "another facility"} by unsaved work elsewhere. Records opened from this page will follow the selector until it changes.`}
          onRetry={refresh}
        />
      ) : null}

      {organizationGapMessage ? (
        <Card className="rounded-lg border border-dashed border-muted-foreground/35 bg-muted/30 shadow-sm">
          <CardContent className="p-4 text-sm text-muted-foreground">{organizationGapMessage}</CardContent>
        </Card>
      ) : null}

      {fetchErrorBannerMessage ? (
        <AdminLiveDataFallbackNotice message={fetchErrorBannerMessage} onRetry={refresh} />
      ) : null}

      {loading && !facilityName && !fetchErrorBannerMessage && !organizationGapMessage ? (
        <div className="space-y-3" role="status" aria-live="polite" aria-label="Loading facility overview">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : null}

      {ready ? (
        <>
          <section aria-labelledby="facility-attention" className="space-y-2">
            <SectionHeading id="facility-attention">Needs attention</SectionHeading>
            <Card>
              <CardContent className="divide-y divide-border p-0">
                {kpi?.status === "failed" ? (
                  <div className="p-4">
                    <FailedLine message={kpi.message} onRetry={refresh} />
                  </div>
                ) : null}
                {rounding?.status === "failed" ? (
                  <div className="p-4">
                    <FailedLine message={rounding.message} onRetry={refresh} />
                  </div>
                ) : null}
                {attentionItems.map((item) => (
                  <div key={item.key} className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">{item.label}</p>
                      <p className="text-sm text-muted-foreground">{item.detail}</p>
                    </div>
                    <Link href={item.href} className={linkClass}>
                      {item.linkLabel}
                      <ArrowRight className="size-4" aria-hidden />
                    </Link>
                  </div>
                ))}
                {attentionItems.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">
                    {attentionEmptyCopy(coverageGaps.length, failedCount)}
                  </p>
                ) : null}
                {coverageGaps.length > 0 ? (
                  <div className="space-y-2 bg-muted/30 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Not yet recorded</p>
                    {coverageGaps.map((gap) => (
                      <div key={gap.key} className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">{gap.label}</p>
                          <p className="text-sm text-muted-foreground">{gap.detail}</p>
                        </div>
                        <Link href={gap.href} className={linkClass}>
                          {gap.linkLabel}
                          <ArrowRight className="size-4" aria-hidden />
                        </Link>
                      </div>
                    ))}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </section>

          <section aria-labelledby="facility-snapshot" className="space-y-2">
            <SectionHeading
              id="facility-snapshot"
              aside={<span className="text-xs text-muted-foreground">Counted live from this facility&apos;s records</span>}
            >
              Facility snapshot
            </SectionHeading>
            {kpi?.status === "failed" ? (
              <Card>
                <CardContent className="p-4">
                  <FailedLine message={kpi.message} onRetry={refresh} />
                </CardContent>
              </Card>
            ) : (
              <Card className="py-0 lg:py-0">
                {/* One card, hairline-divided cells flush to its edge: a labelled
                    grid rather than a card per measure. The 1px gap over the border
                    colour draws the dividers; the trailing filler keeps the last
                    row's slot from showing as a bare divider block. */}
                <CardContent className="p-0">
                  <ul className="grid list-none gap-px bg-border p-0 sm:grid-cols-2 xl:grid-cols-4">
                    {snapshotTiles.map((tile) => (
                      <li
                        key={tile.key}
                        className={cn(
                          "flex min-w-0 flex-col gap-0.5 bg-card p-3",
                          // Unrecorded reads as a gap (dashed edge, muted value),
                          // the same cue the rounding strip uses for missing days.
                          tile.state === "not_recorded" && "border-l-2 border-dashed border-muted-foreground/50",
                        )}
                      >
                        <h3 className="text-xs font-medium text-muted-foreground">{tile.label}</h3>
                        <p
                          className={cn(
                            "text-base font-semibold tabular-nums",
                            tile.state === "not_recorded" ? "text-muted-foreground" : "text-foreground",
                          )}
                        >
                          {tile.value}
                        </p>
                        <p className="text-xs text-muted-foreground">{tile.detail}</p>
                        <p className="mt-auto pt-1.5">
                          <Link href={tile.href} className={linkClass}>
                            {tile.linkLabel}
                            <ArrowRight className="size-4" aria-hidden />
                          </Link>
                        </p>
                      </li>
                    ))}
                    {snapshotTiles.length % 2 === 1 ? (
                      <li aria-hidden className="hidden bg-card sm:block" />
                    ) : null}
                  </ul>
                </CardContent>
              </Card>
            )}
          </section>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <section aria-labelledby="facility-rounding" className="space-y-2">
              <SectionHeading
                id="facility-rounding"
                aside={
                  <Link href={FACILITY_ROUTES.rounding} className={linkClass}>
                    View rounding
                    <ArrowRight className="size-4" aria-hidden />
                  </Link>
                }
              >
                Rounding assurance
              </SectionHeading>
              <Card>
                <CardContent className="space-y-4 p-4">
                  {rounding?.status === "failed" ? (
                    <FailedLine message={rounding.message} onRetry={refresh} />
                  ) : null}
                  {rounding?.status === "loaded" && !roundingSummary ? (
                    <p className="text-sm text-muted-foreground">
                      This facility is not in the rounding roll-up, so nothing can be shown for it.
                    </p>
                  ) : null}
                  {roundingSummary ? (
                    <>
                      <dl className="grid gap-3 sm:grid-cols-3">
                        <div>
                          <dt className="text-xs font-medium text-muted-foreground">Current band</dt>
                          <dd className="text-sm font-semibold text-foreground">{roundingSummary.bandLabel}</dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium text-muted-foreground">Last recorded observation</dt>
                          <dd className="text-sm font-semibold text-foreground">{roundingSummary.lastObservedLine}</dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium text-muted-foreground">Seven-day coverage</dt>
                          <dd className="text-sm font-semibold tabular-nums text-foreground">{roundingSummary.coverageLine}</dd>
                        </div>
                      </dl>
                      <p className="text-xs text-muted-foreground">{roundingSummary.expectationLine}</p>

                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Open items</p>
                        <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                          {roundingSummary.openItems.map((item) => (
                            <li key={item.key}>
                              <Link
                                href={item.href}
                                className={cn(
                                  "underline-offset-4 hover:underline",
                                  item.count > 0 ? "font-semibold text-foreground" : "text-muted-foreground",
                                )}
                              >
                                <span className="tabular-nums">{item.count}</span> {item.label.toLowerCase()}
                              </Link>
                            </li>
                          ))}
                        </ul>
                        {!roundingSummary.observed ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Nothing has been recorded for this facility, so these counts are absences of records, not results.
                          </p>
                        ) : null}
                      </div>

                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Last seven days</p>
                        <ol className="mt-1 grid grid-cols-7 gap-1.5" aria-label="Rounding band by day">
                          {roundingSummary.days.map((cell) => (
                            <li
                              key={cell.date}
                              className={cn("rounded-md border px-1 py-1.5 text-center", bandTone(cell))}
                              title={cell.observed ? cell.breakdown || "Nothing open recorded" : "Not recorded"}
                            >
                              <p className="text-[11px] text-muted-foreground">{cell.label}</p>
                              <p className="text-xs font-semibold">{cell.observed ? cell.bandLabel : "—"}</p>
                              <p className="sr-only">
                                {cell.observed ? cell.breakdown || "Nothing open recorded" : "Not recorded"}
                              </p>
                            </li>
                          ))}
                        </ol>
                        <p className="mt-2 text-xs text-muted-foreground">
                          Dashed days have no record. {ROUNDING_BAND_EXPLANATION}
                        </p>
                      </div>
                    </>
                  ) : null}
                </CardContent>
              </Card>
            </section>

            <section aria-labelledby="facility-insurance" className="space-y-2">
              <SectionHeading
                id="facility-insurance"
                aside={
                  <Link href={FACILITY_ROUTES.insurance} className={linkClass}>
                    View insurance
                    <ArrowRight className="size-4" aria-hidden />
                  </Link>
                }
              >
                Entity insurance costs
              </SectionHeading>
              <Card className={cn(insuranceDisplay?.state === "not_on_file" && "border-dashed")}>
                <CardContent className="space-y-3 p-4">
                  <div>
                    <p className="text-sm font-medium text-foreground">{entityName ?? "Legal entity"}</p>
                    {insuranceDisplay ? (
                      <p className="text-xs text-muted-foreground">{insuranceDisplay.periodLine}</p>
                    ) : null}
                  </div>
                  {insurance?.status === "failed" ? (
                    <FailedLine message={insurance.message} onRetry={refresh} />
                  ) : null}
                  {insuranceDisplay?.state === "not_on_file" ? (
                    <p className="text-sm text-muted-foreground">
                      No policies or claims on file for this period, so there is no cost to show.
                    </p>
                  ) : null}
                  {insuranceDisplay?.state === "recorded" ? (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Total cost of risk</p>
                      <p className="text-lg font-semibold tabular-nums text-foreground">{insuranceDisplay.total}</p>
                      <p className="text-xs text-muted-foreground">{insuranceDisplay.breakdownLine}</p>
                    </div>
                  ) : null}
                  <p className="text-xs text-muted-foreground">{INSURANCE_ENTITY_SCOPE_COPY}</p>
                </CardContent>
              </Card>
            </section>
          </div>

          <section aria-labelledby="facility-records" className="space-y-2">
            <SectionHeading
              id="facility-records"
              aside={<span className="text-xs text-muted-foreground">Open under {headingName}</span>}
            >
              Facility records
            </SectionHeading>
            <Card>
              <CardContent className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-4">
                <Link href={FACILITY_ROUTES.residents} className={linkClass}>
                  Residents
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
                <Link href={FACILITY_ROUTES.incidents} className={linkClass}>
                  Incidents
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
                <Link href={FACILITY_ROUTES.invoices} className={linkClass}>
                  Invoices
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
                <Link href={FACILITY_ROUTES.infectionControl} className={linkClass}>
                  Infection control
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              </CardContent>
            </Card>
          </section>
        </>
      ) : null}
    </div>
  );
}
