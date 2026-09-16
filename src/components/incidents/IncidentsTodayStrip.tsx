"use client";

import { AlertTriangle, BellRing, Clock3, ListChecks } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { formatLevelWord } from "@/lib/incidents/incidents-display-copy";
import { ackQueueLine, ahcaClockLine, loadTodayStrip, type TodayStripData } from "@/lib/incidents/today-strip";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

type StripState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: TodayStripData };

const REFRESH_MS = 60_000;

/**
 * Today at the building (spec 07A §7 Tier 1): acknowledgment queue, open AHCA
 * clocks, events today by level word. Loads on its own and never blocks the
 * Kanban below it.
 */
export function IncidentsTodayStrip({ facilityId }: { facilityId: string | null }) {
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<StripState>({ kind: "idle" });
  const [tick, setTick] = useState(0);
  const facilityReady = isValidFacilityIdForQuery(facilityId);

  useEffect(() => {
    if (!facilityReady || !facilityId) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) setState((current) => (current.kind === "ready" ? current : { kind: "loading" }));
    }, 0);
    loadTodayStrip(supabase, facilityId)
      .then((data) => {
        if (!cancelled) setState({ kind: "ready", data });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ kind: "error", message: error instanceof Error ? error.message : "Today could not be loaded." });
      });
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [facilityId, facilityReady, supabase, tick]);

  useEffect(() => {
    const id = setInterval(() => setTick((value) => value + 1), REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  if (!facilityReady) return null;

  if (state.kind === "idle" || state.kind === "loading") {
    return (
      <div className="relative z-10 grid gap-3 px-1 sm:grid-cols-3" aria-busy="true" aria-label="Loading today">
        {[0, 1, 2].map((index) => (
          <div key={index} className="h-20 animate-pulse rounded-[var(--radius)] border border-border bg-muted/40" />
        ))}
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="relative z-10 flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius)] border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-foreground">
        <span className="inline-flex items-center gap-2">
          <AlertTriangle className="size-4 text-warning" aria-hidden />
          Today could not be loaded. The board below still works.
        </span>
        <Button type="button" variant="outline" size="sm" onClick={() => setTick((value) => value + 1)}>
          Try again
        </Button>
      </div>
    );
  }

  const { ackQueue, ahcaClocks, levelCounts } = state.data;
  const ackTone = ackQueue.count > 0 ? "text-destructive" : "text-foreground";
  const ahcaTone =
    ahcaClocks.tone === "destructive" ? "text-destructive" : ahcaClocks.tone === "warning" ? "text-warning" : "text-foreground";

  return (
    <section aria-label="Today" className="relative z-10 grid gap-3 px-1 sm:grid-cols-3">
      <Tile icon={<BellRing className="size-4" aria-hidden />} label="Waiting for acknowledgment" tone={ackTone} value={String(ackQueue.count)} detail={ackQueueLine(ackQueue)} />
      <Tile icon={<Clock3 className="size-4" aria-hidden />} label="Open AHCA clocks" tone={ahcaTone} value={String(ahcaClocks.count)} detail={ahcaClockLine(ahcaClocks)} />
      <div className="rounded-[var(--radius)] border border-border bg-card p-4">
        <p className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <ListChecks className="size-4" aria-hidden />
          Events today
        </p>
        <dl className="mt-2 grid grid-cols-4 gap-2">
          {([1, 2, 3, 4] as const).map((level) => (
            <div key={level} className="min-w-0">
              <dt className="truncate text-xs text-muted-foreground">{formatLevelWord(level)}</dt>
              <dd className={cn("text-lg font-semibold tabular-nums", levelCounts[level] > 0 ? "text-foreground" : "text-muted-foreground")}>
                {levelCounts[level]}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function Tile({ icon, label, value, detail, tone }: { icon: ReactNode; label: string; value: string; detail: string; tone: string }) {
  return (
    <div className="rounded-[var(--radius)] border border-border bg-card p-4">
      <p className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className={cn("mt-1 text-2xl font-semibold tabular-nums", tone)}>{value}</p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}
