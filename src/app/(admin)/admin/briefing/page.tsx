"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ClipboardList,
  Pill,
  Printer,
  ShieldAlert,
  Sunrise,
  Users,
} from "lucide-react";

import {
  AdminEmptyState,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Button } from "@/components/ui/button";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";
import { MotionItem, MotionList } from "@/components/ui/motion-list";
import { StatusPill } from "@/components/ui/status-pill";
import { V2Card } from "@/components/ui/v2-card";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import {
  fetchMorningHuddleData,
  huddleTodayEtIso,
  type MorningHuddleData,
} from "@/lib/office/morning-huddle";
import { buildMorningHuddlePrintHtml } from "@/lib/office/morning-huddle-print";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

function humanize(value: string): string {
  return value.replace(/_/g, " ");
}

function formatEtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

const MOVE_LABEL: Record<string, string> = {
  move_in: "Move-in today",
  move_out: "Move-out today",
  planned_move_out: "Planned move-out",
};

export default function AdminMorningBriefingPage() {
  const supabase = createClient();
  const { selectedFacilityId, availableFacilities } = useFacilityStore();

  const [data, setData] = useState<MorningHuddleData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const facilityReady = isValidFacilityIdForQuery(selectedFacilityId);
  const todayIso = useMemo(() => huddleTodayEtIso(), []);
  const facilityName = useMemo(() => {
    const match = availableFacilities.find((f) => f.id === selectedFacilityId);
    return match?.name ?? "Selected facility";
  }, [availableFacilities, selectedFacilityId]);

  const load = useCallback(async () => {
    if (!facilityReady) {
      setData(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    try {
      const result = await fetchMorningHuddleData(
        supabase,
        selectedFacilityId as string,
        todayIso,
      );
      setData(result);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load briefing data.");
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [supabase, selectedFacilityId, facilityReady, todayIso]);

  useEffect(() => {
    void load();
  }, [load]);

  const printBriefing = useCallback(() => {
    if (!data) return;
    const html = buildMorningHuddlePrintHtml(data, facilityName);
    const win = window.open("", "_blank", "noopener,width=900,height=1100");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  }, [data, facilityName]);

  const rosterByShift = useMemo(() => {
    const map = new Map<string, NonNullable<typeof data>["shiftRoster"]>();
    if (!data) return map;
    for (const row of data.shiftRoster) {
      const list = map.get(row.shiftType) ?? [];
      list.push(row);
      map.set(row.shiftType, list);
    }
    return map;
  }, [data]);

  const summary = useMemo(
    () =>
      data
        ? [
            { label: "Current census", value: data.census, icon: Users },
            { label: "Incidents (24h)", value: data.overnightIncidents.length, icon: ShieldAlert },
            { label: "Open ops tasks", value: data.openOceTasks.length, icon: ClipboardList },
            { label: "Med flags (24h)", value: data.medFlags.length, icon: Pill },
            { label: "Overdue doses", value: data.overdueScheduledDoses, icon: Pill },
          ]
        : [],
    [data],
  );

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6">
        <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-3">
              <Sunrise className="h-8 w-8 text-warning shrink-0" aria-hidden />
              Morning huddle
            </h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              Per-facility daily briefing: overnight incidents, census moves, today&apos;s shift
              roster, open operations tasks, and medication flags — printable as a one-pager for
              the stand-up meeting. Data is live and RLS-scoped; times are America/New_York.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="shrink-0 gap-2 font-medium text-[10px] uppercase tracking-wider"
            disabled={!data}
            onClick={printBriefing}
          >
            <Printer className="h-4 w-4" aria-hidden />
            Print one-pager
          </Button>
        </header>

        {!facilityReady ? (
          <p className="rounded-[var(--radius)] border border-warning/30 bg-warning/10 px-6 py-4 text-sm text-warning">
            Select a facility first — the morning huddle is a per-facility briefing.
          </p>
        ) : null}

        {facilityReady && isLoading ? <AdminTableLoadingState /> : null}
        {facilityReady && !isLoading && loadError ? (
          <AdminLiveDataFallbackNotice message={loadError} onRetry={() => void load()} />
        ) : null}

        {facilityReady && !isLoading && !loadError && data ? (
          <>
            <KineticGrid className="grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-2" staggerMs={60}>
              {summary.map((card) => {
                const Icon = card.icon;
                return (
                  <div key={card.label} className="h-[120px]">
                    <V2Card hoverColor="blue" className="p-5">
                      <MonolithicWatermark
                        value={card.value}
                        className="text-muted-foreground/10 opacity-50"
                      />
                      <div className="relative z-10 flex h-full flex-col justify-center gap-1">
                        <h3 className="text-[10px] font-medium tracking-wider uppercase text-muted-foreground flex items-center gap-2">
                          <Icon className="h-3.5 w-3.5" aria-hidden /> {card.label}
                        </h3>
                        <p className="text-3xl font-mono tracking-tighter text-foreground tabular-nums">
                          {card.value}
                        </p>
                      </div>
                    </V2Card>
                  </div>
                );
              })}
            </KineticGrid>

            <section aria-labelledby="huddle-incidents-heading" className="space-y-3">
              <div className="flex items-center justify-between gap-3 px-[13px] py-2 rounded-[var(--radius)] border border-border bg-card/60">
                <h3 id="huddle-incidents-heading" className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-destructive" aria-hidden />
                  Overnight incidents
                  <span className="text-sm font-normal text-muted-foreground tabular-nums">
                    {data.overnightIncidents.length}
                  </span>
                </h3>
                <Link href="/admin/incidents" className="text-xs font-medium text-info hover:text-info/80">
                  Open incident queue
                </Link>
              </div>
              {data.overnightIncidents.length === 0 ? (
                <p className="text-sm text-muted-foreground pl-2">
                  No incidents recorded in the last 24 hours.
                </p>
              ) : (
                <MotionList className="space-y-3">
                  {data.overnightIncidents.map((row) => (
                    <MotionItem key={row.id}>
                      <Link
                        href={`/admin/incidents/${row.id}`}
                        className="flex flex-col gap-2 min-h-[36px] px-[13px] py-2 rounded-[9px] border border-border bg-card hover:bg-muted/40 hover:-translate-y-px transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] lg:flex-row lg:items-center lg:justify-between w-full"
                      >
                        <div className="flex flex-col gap-1 min-w-0 flex-1">
                          <span className="font-semibold text-foreground truncate">
                            {row.incidentNumber} · {humanize(row.category)}
                            {row.residentName ? (
                              <span className="text-muted-foreground font-normal"> — {row.residentName}</span>
                            ) : null}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatEtTime(row.occurredAt)} ET · severity {humanize(row.severity)}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          {row.ahcaReportable ? <StatusPill tone="danger">AHCA reportable</StatusPill> : null}
                          <StatusPill tone={row.status === "open" ? "warning" : "muted"}>
                            {humanize(row.status)}
                          </StatusPill>
                        </div>
                      </Link>
                    </MotionItem>
                  ))}
                </MotionList>
              )}
            </section>

            <section aria-labelledby="huddle-moves-heading" className="space-y-3">
              <div className="flex items-center justify-between gap-3 px-[13px] py-2 rounded-[var(--radius)] border border-border bg-card/60">
                <h3 id="huddle-moves-heading" className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <Users className="h-4 w-4 text-info" aria-hidden />
                  Census moves today
                  <span className="text-sm font-normal text-muted-foreground tabular-nums">
                    {data.residentMoves.length}
                  </span>
                </h3>
                <Link href="/admin/residents" className="text-xs font-medium text-info hover:text-info/80">
                  Open resident roster
                </Link>
              </div>
              {data.residentMoves.length === 0 ? (
                <p className="text-sm text-muted-foreground pl-2">No move-ins or move-outs today.</p>
              ) : (
                <MotionList className="space-y-3">
                  {data.residentMoves.map((row) => (
                    <MotionItem key={row.id}>
                      <div className="flex items-center justify-between gap-3 min-h-[36px] px-[13px] py-2 rounded-[9px] border border-border bg-card">
                        <span className="font-semibold text-foreground truncate">{row.residentName}</span>
                        <StatusPill tone={row.kind === "move_in" ? "info" : "warning"}>
                          {MOVE_LABEL[row.kind] ?? humanize(row.kind)}
                        </StatusPill>
                      </div>
                    </MotionItem>
                  ))}
                </MotionList>
              )}
            </section>

            <section aria-labelledby="huddle-roster-heading" className="space-y-3">
              <div className="flex items-center justify-between gap-3 px-[13px] py-2 rounded-[var(--radius)] border border-border bg-card/60">
                <h3 id="huddle-roster-heading" className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-info" aria-hidden />
                  Today&apos;s shift roster
                  <span className="text-sm font-normal text-muted-foreground tabular-nums">
                    {data.shiftRoster.length}
                  </span>
                </h3>
                <Link href="/admin/schedules" className="text-xs font-medium text-info hover:text-info/80">
                  Open schedules
                </Link>
              </div>
              {data.shiftRoster.length === 0 ? (
                <p className="text-sm text-muted-foreground pl-2">
                  No shift assignments scheduled for today.
                </p>
              ) : (
                <div className="grid gap-4 md:grid-cols-3">
                  {[...rosterByShift.entries()].map(([shiftType, rows]) => (
                    <div key={shiftType} className="rounded-[var(--radius)] border border-border bg-card p-4 space-y-2">
                      <h4 className="text-sm font-semibold text-foreground capitalize">
                        {humanize(shiftType)} shift{" "}
                        <span className="text-muted-foreground font-normal tabular-nums">({rows.length})</span>
                      </h4>
                      <ul className="space-y-1">
                        {rows.map((r) => (
                          <li key={r.id} className="flex items-center justify-between gap-2 text-sm text-foreground">
                            <span className="truncate">{r.staffName}</span>
                            {r.status === "called_out" || r.status === "no_show" ? (
                              <StatusPill tone="danger">{humanize(r.status)}</StatusPill>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section aria-labelledby="huddle-oce-heading" className="space-y-3">
              <div className="flex items-center justify-between gap-3 px-[13px] py-2 rounded-[var(--radius)] border border-border bg-card/60">
                <h3 id="huddle-oce-heading" className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <ClipboardList className="h-4 w-4 text-warning" aria-hidden />
                  Open operations tasks
                  <span className="text-sm font-normal text-muted-foreground tabular-nums">
                    {data.openOceTasks.length}
                  </span>
                </h3>
                <Link href="/admin/operations" className="text-xs font-medium text-info hover:text-info/80">
                  Open operations hub
                </Link>
              </div>
              {data.openOceTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground pl-2">
                  No pending, in-progress, or missed operations tasks due through today.
                </p>
              ) : (
                <MotionList className="space-y-3">
                  {data.openOceTasks.map((row) => (
                    <MotionItem key={row.id}>
                      <div className="flex flex-col gap-2 min-h-[36px] px-[13px] py-2 rounded-[9px] border border-border bg-card lg:flex-row lg:items-center lg:justify-between w-full">
                        <div className="flex flex-col gap-1 min-w-0 flex-1">
                          <span className="font-semibold text-foreground truncate">{row.templateName}</span>
                          <span className="text-xs text-muted-foreground">
                            {humanize(row.templateCategory)} · {row.assignedShiftDate}
                            {row.assignedShift ? ` · ${humanize(row.assignedShift)} shift` : ""}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          {row.licenseThreatening ? <StatusPill tone="danger">License</StatusPill> : null}
                          {row.priority === "critical" || row.priority === "high" ? (
                            <StatusPill tone="warning">{row.priority}</StatusPill>
                          ) : null}
                          <StatusPill tone={row.status === "missed" ? "danger" : "info"}>
                            {humanize(row.status)}
                          </StatusPill>
                        </div>
                      </div>
                    </MotionItem>
                  ))}
                </MotionList>
              )}
            </section>

            <section aria-labelledby="huddle-meds-heading" className="space-y-3">
              <div className="flex items-center justify-between gap-3 px-[13px] py-2 rounded-[var(--radius)] border border-border bg-card/60">
                <h3 id="huddle-meds-heading" className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <Pill className="h-4 w-4 text-destructive" aria-hidden />
                  Medication flags
                  <span className="text-sm font-normal text-muted-foreground tabular-nums">
                    {data.medFlags.length}
                  </span>
                </h3>
                <Link href="/admin/medications" className="text-xs font-medium text-info hover:text-info/80">
                  Open medications hub
                </Link>
              </div>
              {data.overdueScheduledDoses > 0 ? (
                <p className="text-sm text-warning rounded-[var(--radius)] border border-warning/30 bg-warning/10 px-4 py-3">
                  {data.overdueScheduledDoses} scheduled dose
                  {data.overdueScheduledDoses === 1 ? " is" : "s are"} past due and not yet
                  documented — review the eMAR.
                </p>
              ) : null}
              {data.medFlags.length === 0 ? (
                <p className="text-sm text-muted-foreground pl-2">
                  No refused, held, or unavailable doses in the last 24 hours.
                </p>
              ) : (
                <MotionList className="space-y-3">
                  {data.medFlags.map((row) => (
                    <MotionItem key={row.id}>
                      <div className="flex flex-col gap-2 min-h-[36px] px-[13px] py-2 rounded-[9px] border border-border bg-card lg:flex-row lg:items-center lg:justify-between w-full">
                        <div className="flex flex-col gap-1 min-w-0 flex-1">
                          <span className="font-semibold text-foreground truncate">{row.residentName}</span>
                          <span className="text-xs text-muted-foreground">
                            Scheduled {formatEtTime(row.scheduledTime)} ET
                            {row.reason ? ` · ${row.reason}` : ""}
                          </span>
                        </div>
                        <StatusPill tone="warning">{humanize(row.status)}</StatusPill>
                      </div>
                    </MotionItem>
                  ))}
                </MotionList>
              )}
            </section>
          </>
        ) : null}

        {facilityReady && !isLoading && !loadError && !data ? (
          <AdminEmptyState
            title="No briefing data"
            description="Live queries returned nothing for this facility."
          />
        ) : null}
      </div>
    </div>
  );
}
