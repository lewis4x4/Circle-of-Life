"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Activity, ClipboardList, Clock3, ShieldAlert } from "lucide-react";

import { RoundingHubNav } from "./rounding-hub-nav";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { cn } from "@/lib/utils";

type OverviewSummary = {
  plans: number;
  activeTasks: number;
  urgentTasks: number;
  completionRate: number;
};

export default function AdminRoundingHubPage() {
  const { selectedFacilityId } = useFacilityStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<OverviewSummary>({ plans: 0, activeTasks: 0, urgentTasks: 0, completionRate: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    if (!selectedFacilityId) {
      setLoading(false);
      return;
    }

    try {
      const [plansRes, tasksRes, reportsRes] = await Promise.all([
        fetch(`/api/rounding/plans?facilityId=${encodeURIComponent(selectedFacilityId)}`, { cache: "no-store" }),
        fetch(`/api/rounding/tasks?facilityId=${encodeURIComponent(selectedFacilityId)}&limit=200`, { cache: "no-store" }),
        fetch(`/api/rounding/reports/completion?facilityId=${encodeURIComponent(selectedFacilityId)}&from=${encodeURIComponent(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString())}`, { cache: "no-store" }),
      ]);

      const plansJson = (await plansRes.json()) as { error?: string; plans?: unknown[] };
      const tasksJson = (await tasksRes.json()) as { error?: string; tasks?: { derived_status: string }[] };
      const reportsJson = (await reportsRes.json()) as { error?: string; summary?: { completionRate?: number } };

      if (!plansRes.ok) throw new Error(plansJson.error ?? "Could not load plans");
      if (!tasksRes.ok) throw new Error(tasksJson.error ?? "Could not load tasks");
      if (!reportsRes.ok) throw new Error(reportsJson.error ?? "Could not load reports");

      const tasks = tasksJson.tasks ?? [];
      const urgent = tasks.filter((task) => task.derived_status === "critically_overdue" || task.derived_status === "missed").length;
      const active = tasks.filter((task) => !(task.derived_status ?? "").startsWith("completed")).length;
      setSummary({
        plans: plansJson.plans?.length ?? 0,
        activeTasks: active,
        urgentTasks: urgent,
        completionRate: reportsJson.summary?.completionRate ?? 0,
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load rounding overview.");
      setSummary({ plans: 0, activeTasks: 0, urgentTasks: 0, completionRate: 0 });
    } finally {
      setLoading(false);
    }
  }, [selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Resident Assurance</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Live rounding visibility, resident observation plans, and completion reporting for the selected facility.
        </p>
      </div>

      <RoundingHubNav />

      {!selectedFacilityId ? (
        <Card className="border-amber-200/80 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/30">
          <CardContent className="py-6 text-sm text-amber-950 dark:text-amber-100">
            Select a facility in the header to load resident rounding plans and task activity.
          </CardContent>
        </Card>
      ) : null}

      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Plans" value={loading ? "—" : String(summary.plans)} icon={<ClipboardList className="h-4 w-4" />} />
        <MetricCard title="Active tasks" value={loading ? "—" : String(summary.activeTasks)} icon={<Activity className="h-4 w-4" />} />
        <MetricCard title="Urgent now" value={loading ? "—" : String(summary.urgentTasks)} icon={<ShieldAlert className="h-4 w-4" />} danger={summary.urgentTasks > 0} />
        <MetricCard title="Completion rate" value={loading ? "—" : `${Math.round(summary.completionRate * 100)}%`} icon={<Clock3 className="h-4 w-4" />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <LinkCard
          href="/admin/rounding/live"
          title="Live board"
          description="See due, overdue, missed, and completed checks in one board."
        />
        <LinkCard
          href="/admin/rounding/plans"
          title="Observation plans"
          description="Manage resident cadence, daypart rules, grace windows, and assignment expectations."
        />
        <LinkCard
          href="/admin/rounding/reports"
          title="Completion reports"
          description="Review completion, on-time, late, and missed-check rates by shift, staff member, and resident."
        />
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={() => void load()}>Refresh overview</Button>
        <Link href="/admin/rounding/plans/new" className={cn(buttonVariants({ variant: "outline" }))}>
          Create plan
        </Link>
      </div>
    </div>
  );
}

function MetricCard({
  title,
  value,
  icon,
  danger,
}: {
  title: string;
  value: string;
  icon: ReactNode;
  danger?: boolean;
}) {
  return (
    <Card className={`border-slate-200/80 shadow-soft dark:border-slate-800 ${danger ? "border-rose-300/80 dark:border-rose-900/50" : ""}`}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="font-display text-2xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

function LinkCard({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link href={href} className="group block">
      <Card className="border-slate-200/80 shadow-soft transition-colors hover:border-brand-500/40 dark:border-slate-800">
        <CardHeader>
          <CardTitle className="text-base group-hover:text-brand-700 dark:group-hover:text-brand-300">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
      </Card>
    </Link>
  );
}
