"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Users, AlertCircle, Map as MapIcon, Maximize2 } from "lucide-react";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { fetchAdminDashboardSnapshot, type AdminDashboardSnapshot } from "@/lib/admin-dashboard-snapshot";
import { cn } from "@/lib/utils";

export default function AdminDashboardPage() {
  const { selectedFacilityId } = useFacilityStore();
  const [snapshot, setSnapshot] = useState<AdminDashboardSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchAdminDashboardSnapshot(selectedFacilityId);
      setSnapshot(data);
    } catch (e) {
      setSnapshot(null);
      setError(e instanceof Error ? e.message : "Unable to load dashboard metrics.");
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (isLoading) {
    return (
      <div className="space-y-8 animate-in fade-in duration-500">
        <Skeleton className="h-[280px] w-full rounded-[2rem] lg:h-[340px]" />
        <div className="grid gap-6 md:grid-cols-12">
          <Card className="col-span-8 shadow-soft">
            <CardContent>
              <Skeleton className="h-[400px] w-full" />
            </CardContent>
          </Card>
          <Card className="col-span-4 shadow-soft">
            <CardContent>
              <Skeleton className="h-[400px] w-full" />
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (error || !snapshot) {
    return (
      <div className="space-y-6 pb-12 animate-in fade-in duration-500">
        <Card className="border-amber-200/80 bg-amber-50/40 dark:border-amber-900/60 dark:bg-amber-950/20">
          <CardHeader>
            <CardTitle className="text-lg">Dashboard unavailable</CardTitle>
            <CardDescription>
              {error ?? "No snapshot returned. Check Supabase configuration and network access."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" variant="outline" onClick={() => void load()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const occValue =
    snapshot.licensedBeds != null
      ? `${snapshot.residentCount}/${snapshot.licensedBeds}`
      : String(snapshot.residentCount);
  const occSub =
    snapshot.licensedBeds != null && snapshot.licensedBeds > 0
      ? `${Math.min(100, Math.round((snapshot.residentCount / snapshot.licensedBeds) * 100))}% of licensed beds`
      : "Licensed bed total not available for this scope";

  const ratioSub =
    snapshot.activeStaffCount > 0
      ? `~1:${Math.max(1, Math.round(snapshot.residentCount / snapshot.activeStaffCount))} residents per staff`
      : "No active staff in scope";

  return (
    <div className="space-y-8 animate-in fade-in duration-500 slide-in-from-bottom-2 pb-12">
      <div className="relative h-[280px] w-full overflow-hidden rounded-[2rem] border border-slate-200/60 shadow-soft dark:border-slate-800 lg:h-[340px]">
        <div
          className="absolute inset-0 bg-cover bg-center transition-transform duration-[15s] ease-out hover:scale-105"
          style={{ backgroundImage: "url('/facility-hero.png')" }}
        />

        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/60 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-slate-950/50 to-transparent" />

        <div className="absolute inset-x-0 bottom-0 flex flex-col items-start justify-between gap-6 p-6 sm:flex-row sm:items-end sm:p-10">
          <div className="max-w-xl">
            <Badge className="mb-4 border border-emerald-500/30 bg-emerald-500/20 px-3 py-1 text-emerald-300 backdrop-blur-md">
              <span className="mr-2 h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
              <span className="text-[10px] font-bold uppercase tracking-widest">Live data</span>
            </Badge>
            <h1 className="font-display text-4xl font-bold tracking-tight text-white drop-shadow-md lg:text-5xl">
              {snapshot.headlineName}
            </h1>
            <p className="mt-2 text-sm font-medium text-slate-300 drop-shadow-sm sm:text-base">
              Facility command · {snapshot.shiftSummary}
            </p>
            <p className="mt-1 text-xs text-slate-400">Timezone: {snapshot.timezoneLabel}</p>
          </div>

          <div className="flex w-full shrink-0 gap-3 overflow-x-auto pb-2 scrollbar-hide sm:w-auto sm:pb-0">
            <FloatingMetric title="Census" value={occValue} sub={occSub} />
            <FloatingMetric
              title="Active staff"
              value={snapshot.activeStaffCount}
              sub={ratioSub}
              icon={<Users className="h-4 w-4 text-emerald-400" />}
            />
            <FloatingMetric
              title="Open incidents"
              value={snapshot.openIncidentAlerts}
              sub={snapshot.openIncidentAlerts > 0 ? "Needs follow-up" : "Queue clear"}
              critical={snapshot.openIncidentAlerts > 0}
            />
          </div>
        </div>
      </div>

      <div className="grid items-start gap-6 md:grid-cols-12">
        <Card className="col-span-12 flex flex-col overflow-hidden border-slate-200/60 bg-white shadow-soft dark:border-slate-800 dark:bg-slate-950 lg:col-span-7">
          <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 bg-slate-50/50 pb-4 dark:border-slate-800 dark:bg-slate-900/20">
            <div>
              <CardTitle className="font-display text-lg">Census preview</CardTitle>
              <CardDescription>Recently updated residents in the current scope</CardDescription>
            </div>
            <Link
              href="/admin/residents"
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "h-8 text-xs font-medium tap-responsive",
              )}
            >
              View directory
            </Link>
          </CardHeader>
          <CardContent className="max-h-[700px] overflow-auto p-0">
            {snapshot.censusPreview.length === 0 ? (
              <p className="p-6 text-sm text-slate-500 dark:text-slate-400">
                No residents in this scope. Select a facility or add census in Supabase.
              </p>
            ) : (
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-slate-50/80 backdrop-blur-sm dark:bg-slate-900/80">
                  <TableRow className="border-slate-100 hover:bg-transparent dark:border-slate-800">
                    <TableHead className="font-medium">Resident</TableHead>
                    <TableHead className="hidden font-medium sm:table-cell">Room</TableHead>
                    <TableHead className="hidden font-medium md:table-cell">Acuity</TableHead>
                    <TableHead className="text-right font-medium">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {snapshot.censusPreview.map((res) => (
                    <TableRow
                      key={res.id}
                      className="group cursor-pointer border-slate-100 transition-colors hover:bg-slate-50/60 dark:border-slate-800 dark:hover:bg-slate-900/40"
                    >
                      <TableCell className="py-4">
                        <Link href={`/admin/residents/${res.id}`} className="flex items-center gap-4">
                          <Avatar className="h-10 w-10 border-2 border-white shadow-sm ring-1 ring-slate-200 dark:border-slate-950 dark:ring-slate-800">
                            <AvatarFallback className="bg-slate-100 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                              {res.initials}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex flex-col">
                            <span className="font-semibold text-slate-900 transition-colors group-hover:text-brand-600 dark:text-slate-100 dark:group-hover:text-brand-400">
                              {res.name}
                            </span>
                            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 sm:hidden">
                              Rm {res.room} · DOB {res.dobDisplay}
                            </span>
                            <span className="hidden text-xs font-medium text-slate-500 dark:text-slate-400 sm:block">
                              DOB {res.dobDisplay}
                            </span>
                          </div>
                        </Link>
                      </TableCell>
                      <TableCell className="hidden font-medium text-slate-700 dark:text-slate-300 sm:table-cell">
                        {res.room}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <AcuityBadge level={res.acuity} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-col items-end gap-1">
                          <StatusIndicator label={res.statusLabel} away={res.statusTone === "away"} />
                          <span className="text-[10px] font-bold uppercase text-slate-400">
                            {res.updatedRelative}
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <div className="col-span-12 flex flex-col gap-6 lg:col-span-5">
          <Card className="group relative overflow-hidden border-slate-200/60 bg-white shadow-soft dark:border-slate-800 dark:bg-slate-950">
            <CardHeader className="absolute inset-x-0 top-0 z-10 flex flex-row items-center justify-between border-none bg-gradient-to-b from-slate-950/80 to-transparent pb-8 pt-4">
              <div className="flex items-center gap-2">
                <MapIcon className="h-5 w-5 text-teal-400" />
                <CardTitle className="text-white drop-shadow-md">Campus overview</CardTitle>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 rounded-full bg-black/40 text-white backdrop-blur-md hover:bg-white/20"
                type="button"
                aria-label="Expand map (placeholder)"
              >
                <Maximize2 className="h-4 w-4" />
              </Button>
            </CardHeader>
            <div className="relative aspect-video w-full bg-slate-950">
              <div
                className="absolute inset-0 bg-cover bg-center opacity-80 transition-transform duration-[10s] group-hover:scale-[1.03]"
                style={{ backgroundImage: "url('/campus-map.png')" }}
              />
              {snapshot.openIncidentAlerts > 0 ? (
                <div className="absolute left-1/3 top-1/4 h-3 w-3 animate-pulse rounded-full bg-red-500 shadow-[0_0_15px_rgba(239,68,68,1)]" />
              ) : null}
            </div>
            <div className="flex items-center justify-between border-t border-slate-800 bg-slate-900 px-4 py-3">
              <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                Phase 1 map visual
              </span>
              <span
                className={cn(
                  "flex items-center gap-1 text-xs font-bold",
                  snapshot.openIncidentAlerts > 0 ? "text-red-400" : "text-emerald-400",
                )}
              >
                <AlertCircle className="h-3 w-3" />
                {snapshot.openIncidentAlerts > 0
                  ? `${snapshot.openIncidentAlerts} open incident${snapshot.openIncidentAlerts === 1 ? "" : "s"}`
                  : "No open incidents"}
              </span>
            </div>
          </Card>

          <Card className="flex h-full max-h-[400px] flex-col overflow-hidden border-slate-200/60 bg-white shadow-soft dark:border-slate-800 dark:bg-slate-950">
            <CardHeader className="border-b border-slate-100 bg-slate-50/50 pb-4 dark:border-slate-800 dark:bg-slate-900/20">
              <CardTitle className="font-display text-lg">Recent incidents</CardTitle>
              <CardDescription>Latest reports in the current scope</CardDescription>
            </CardHeader>
            <CardContent className="relative flex-1 p-0">
              <ScrollArea className="h-full px-5 py-4">
                {snapshot.activity.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    No recent incidents in this scope.
                  </p>
                ) : (
                  <div className="relative space-y-5 before:absolute before:inset-0 before:ml-[11px] before:h-full before:w-[2px] before:bg-gradient-to-b before:from-slate-200 before:via-slate-200 before:to-transparent dark:before:via-slate-800">
                    {snapshot.activity.map((event) => (
                      <div key={event.id} className="relative flex items-start gap-4">
                        <div className="z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-[3px] border-white bg-slate-200 dark:border-slate-950 dark:bg-slate-800">
                          <div
                            className={cn(
                              "h-2 w-2 rounded-full",
                              event.tone === "critical"
                                ? "bg-red-500"
                                : event.tone === "warning"
                                  ? "bg-amber-500"
                                  : "bg-slate-400",
                            )}
                          />
                        </div>
                        <div className="flex flex-1 flex-col pb-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                              {event.actor}
                            </span>
                            <span className="text-xs font-medium text-slate-400">{event.timeLabel}</span>
                          </div>
                          <p
                            className={cn(
                              "mt-0.5 text-sm font-medium",
                              event.tone === "critical"
                                ? "text-red-600 dark:text-red-400"
                                : "text-slate-800 dark:text-slate-200",
                            )}
                          >
                            {event.message}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function FloatingMetric({
  title,
  value,
  sub,
  critical,
  icon,
}: {
  title: string;
  value: React.ReactNode;
  sub: string;
  critical?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex w-[140px] shrink-0 flex-col justify-center rounded-2xl border p-4 shadow-[0_8px_30px_rgb(0,0,0,0.12)] backdrop-blur-md",
        critical ? "border-red-500/30 bg-red-950/40" : "border-white/10 bg-slate-950/40",
      )}
    >
      <span className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-300 opacity-80">
        {title}
      </span>
      <div className="flex items-center gap-2">
        <span
          className={cn("text-2xl font-bold tracking-tight", critical ? "text-red-400" : "text-white")}
        >
          {value}
        </span>
        {icon}
      </div>
      <span
        className={cn("mt-0.5 text-[10px] font-semibold", critical ? "text-red-300/80" : "text-slate-400")}
      >
        {sub}
      </span>
    </div>
  );
}

function AcuityBadge({ level }: { level: 1 | 2 | 3 }) {
  const map = {
    1: {
      label: "Routine",
      class:
        "border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700/50 dark:bg-slate-800/50 dark:text-slate-300",
    },
    2: {
      label: "Observation",
      class:
        "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/50 dark:bg-amber-950/50 dark:text-amber-400",
    },
    3: {
      label: "Critical",
      class: "border-red-200 bg-red-50 text-red-700 dark:border-red-800/50 dark:bg-red-950/50 dark:text-red-400",
    },
  };
  const cfg = map[level];
  return (
    <Badge variant="outline" className={cn("text-[10px] font-bold uppercase tracking-wide", cfg.class)}>
      {cfg.label}
    </Badge>
  );
}

function StatusIndicator({ label, away }: { label: string; away: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{label}</span>
      <div
        className={cn(
          "h-2 w-2 rounded-full shadow-sm",
          away ? "bg-amber-500" : "bg-emerald-500",
        )}
      />
    </div>
  );
}
