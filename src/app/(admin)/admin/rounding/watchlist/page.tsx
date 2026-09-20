"use client";

/**
 * The Watchlist. Spec 25A section 7, tiers 1 and 2.
 *
 * Replaces the Safety Scores tab. There is no resident score here and there is
 * no AI derived number here: spec decision D6 retires the scorer from this
 * surface, and spec section 7.1 explains why a composite on a resident row was
 * both unactionable and indefensible.
 *
 * Tier 1 is the portfolio, one row per building. Tier 2 is the building the
 * operator has selected, one row per open signal, ranked by band and then age.
 * Tier 3 is a resident and lives one route down.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RefreshCw } from "lucide-react";

import { RoundingHubNav } from "../rounding-hub-nav";
import { PageHeader } from "@/design-system/components/PageHeader";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/ui/metric-card";
import { WatchlistFacilityTable } from "@/components/rounding/WatchlistFacilityTable";
import { WatchlistPortfolioTable } from "@/components/rounding/WatchlistPortfolioTable";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import {
  resolveWatchlistFacilityScope,
  watchlistPageSubtitle,
} from "@/lib/rounding/watchlist-display-copy";
import {
  fetchFacilityWatchlist,
  fetchWatchlistPortfolio,
  type WatchlistPortfolioRow,
  type WatchlistSignalRow,
} from "@/lib/rounding/watchlist-fetch";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";

type LoadState = "idle" | "loading" | "ready" | "error";

const LOAD_FAILED = "The Watchlist could not be loaded. Try again in a moment.";

export default function WatchlistPage() {
  const { selectedFacilityId } = useFacilityStore();
  return <ScopedWatchlistPage key={selectedFacilityId ?? "portfolio"} />;
}

function ScopedWatchlistPage() {
  const { selectedFacilityId, availableFacilities } = useFacilityStore();
  const selectedFacility = availableFacilities.find(
    (facility) => facility.id === selectedFacilityId,
  );
  const facilityScope = resolveWatchlistFacilityScope(selectedFacilityId, selectedFacility?.name);
  const supabase = useMemo(() => createClient() as unknown as SupabaseClient, []);

  const [portfolio, setPortfolio] = useState<WatchlistPortfolioRow[]>([]);
  const [signals, setSignals] = useState<WatchlistSignalRow[]>([]);
  const [hasData, setHasData] = useState(false);
  const generation = useRef(0);
  const [loadState, setLoadState] = useState<LoadState>("idle");

  const load = useCallback(async () => {
    const attempt = ++generation.current;
    if (!isBrowserSupabaseConfigured()) {
      setLoadState("error");
      return;
    }

    setLoadState("loading");
    try {
      const [portfolioRows, signalRows] = await Promise.all([
        fetchWatchlistPortfolio(supabase),
        selectedFacilityId
          ? fetchFacilityWatchlist(supabase, selectedFacilityId)
          : Promise.resolve([] as WatchlistSignalRow[]),
      ]);
      if (attempt !== generation.current) return;
      setHasData(true);
      setPortfolio(portfolioRows);
      setSignals(signalRows);
      setLoadState("ready");
    } catch {
      if (attempt === generation.current) setLoadState("error");
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
    // This counter invalidates requests; it is not a captured DOM ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { generation.current++; };
  }, [load]);

  const totals = useMemo(() => {
    const scoped = selectedFacilityId
      ? portfolio.filter((row) => row.facility_id === selectedFacilityId)
      : portfolio;
    return scoped.reduce(
      (acc, row) => ({
        acute: acc.acute + row.open_acute_signal_count,
        residents: acc.residents + row.residents_on_watchlist,
        documentation: acc.documentation + row.data_quality_signal_count,
      }),
      { acute: 0, residents: 0, documentation: 0 },
    );
  }, [portfolio, selectedFacilityId]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <PageHeader
        title="Watchlist"
        subtitle={watchlistPageSubtitle(facilityScope)}
        actions={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => void load()}
            aria-label="Refresh the Watchlist"
            title="Refresh"
            disabled={loadState === "loading"}
          >
            <RefreshCw className="size-4" aria-hidden />
          </Button>
        }
      />

      <RoundingHubNav />

      {loadState === "error" ? (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="text-[13px] leading-relaxed text-foreground">{LOAD_FAILED}{hasData ? " Showing the last successfully loaded records." : ""}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      ) : null}

      {loadState === "loading" || loadState === "idle" ? <p role="status">{hasData ? "Refreshing the Watchlist…" : "Loading the Watchlist…"}</p> : null}
      {hasData ? <>
      <section aria-label="Watchlist summary">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <MetricCard
            label="Open Acute signals"
            value={totals.acute}
            numericValue={totals.acute}
            thresholds={{ type: "critical-count" }}
            hint="Clinical signals on residents the band rules put in the Acute band"
          />
          <MetricCard
            label="Residents listed"
            value={totals.residents}
            numericValue={totals.residents}
            thresholds={{ type: "informational" }}
            hint="Residents carrying at least one open signal"
          />
          <MetricCard
            label="Documentation signals"
            value={totals.documentation}
            numericValue={totals.documentation}
            thresholds={{ type: "informational" }}
            hint="Checks nobody wrote down. Not a report of resident decline"
          />
        </div>
      </section>

      <section aria-label="Portfolio" className="space-y-2">
        <h2 className="text-sm font-semibold text-foreground">Across the portfolio</h2>
        <WatchlistPortfolioTable rows={portfolio} selectedFacilityId={selectedFacilityId} />
      </section>

      <section aria-label="Facility board" className="space-y-2">
        <h2 className="text-sm font-semibold text-foreground">
          {facilityScope.kind === "named" ? facilityScope.name : "Selected building"}
        </h2>
        {selectedFacilityId ? (
          <WatchlistFacilityTable rows={signals} />
        ) : (
          <div className="rounded-lg border border-border bg-card p-5">
            <p className="text-sm font-semibold text-foreground">No building is selected.</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Choose one in the top bar to see its residents, their signals and who owns each one.
            </p>
          </div>
        )}
      </section>
      </> : null}
    </div>
  );
}
