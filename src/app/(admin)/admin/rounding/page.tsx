"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ClipboardList,
  Eye,
  FileBarChart,
  Play,
  RefreshCw,
  Shield,
  ShieldAlert,
  UserPlus,
} from "lucide-react";

import { RoundingHubNav } from "./rounding-hub-nav";
import { V2Card } from "@/components/ui/v2-card";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { Button, buttonVariants } from "@/components/ui/button";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { AdminLiveDataFallbackNotice } from "@/components/common/admin-list-patterns";

type OverviewSummary = {
  plans: number;
  activeTasks: number;
  urgentTasks: number;
  completionRate: number;
  onTimeRate: number;
  missedCount: number;
  completedCount: number;
  expectedCount: number;
  activeWatches: number;
  pendingApprovals: number;
  openEscalations: number;
  openIntegrityFlags: number;
};

const EMPTY_SUMMARY: OverviewSummary = {
  plans: 0,
  activeTasks: 0,
  urgentTasks: 0,
  completionRate: 0,
  onTimeRate: 0,
  missedCount: 0,
  completedCount: 0,
  expectedCount: 0,
  activeWatches: 0,
  pendingApprovals: 0,
  openEscalations: 0,
  openIntegrityFlags: 0,
};

export default function AdminRoundingHubPage() {
  const { selectedFacilityId } = useFacilityStore();
  const supabase = useMemo(() => createClient(), []);
  const [, setLoading] = useState(true);
  const [summary, setSummary] = useState<OverviewSummary>(EMPTY_SUMMARY);
  const [sourceNotice, setSourceNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);

    if (!selectedFacilityId || !isBrowserSupabaseConfigured()) {
      setSourceNotice("Select a facility and connect the live rounding source to show Resident Assurance metrics.");
      setSummary(EMPTY_SUMMARY);
      setLoading(false);
      return;
    }

    setSourceNotice(null);

    try {
      const [plansRes, tasksRes, watchesRes, escalationsRes, integrityRes] = await Promise.all([
        supabase
          .from("resident_observation_plans")
          .select("id")
          .eq("facility_id", selectedFacilityId)
          .eq("status", "active")
          .is("deleted_at", null),
        supabase
          .from("resident_observation_tasks")
          .select("id, status, due_at, grace_ends_at")
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .gte("due_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
          .order("due_at", { ascending: true })
          .limit(200),
        supabase
          .from("resident_watch_instances")
          .select("id, status")
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null),
        supabase
          .from("resident_observation_escalations")
          .select("id", { count: "exact", head: true })
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .in("status", ["open", "in_progress"]),
        supabase
          .from("resident_observation_integrity_flags")
          .select("id", { count: "exact", head: true })
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .in("status", ["open", "in_progress"]),
      ]);

      if (plansRes.error) throw plansRes.error;
      if (tasksRes.error) throw tasksRes.error;
      if (watchesRes.error) throw watchesRes.error;
      if (escalationsRes.error) throw escalationsRes.error;
      if (integrityRes.error) throw integrityRes.error;

      const planCount = plansRes.data?.length ?? 0;
      const taskRows = tasksRes.data ?? [];
      const watchRows = watchesRes.data ?? [];
      const completed = taskRows.filter((t) => (t.status as string).startsWith("completed"));
      const missed = taskRows.filter((t) => t.status === "missed");
      const urgent = taskRows.filter((t) => t.status === "critically_overdue" || t.status === "missed");
      const active = taskRows.filter((t) => !(t.status as string).startsWith("completed") && t.status !== "excused");
      const expected = taskRows.length;
      const activeWatches = watchRows.filter((row) => row.status === "active").length;
      const pendingApprovals = watchRows.filter((row) => row.status === "pending_approval").length;

      if (expected === 0) {
        setSourceNotice("No live rounding tasks were returned for the current facility scope.");
      }

      setSummary({
        plans: planCount,
        activeTasks: active.length,
        urgentTasks: urgent.length,
        completionRate: expected > 0 ? completed.length / expected : 0,
        onTimeRate: expected > 0 ? taskRows.filter((t) => t.status === "completed_on_time").length / expected : 0,
        missedCount: missed.length,
        completedCount: completed.length,
        expectedCount: expected,
        activeWatches,
        pendingApprovals,
        openEscalations: escalationsRes.count ?? 0,
        openIntegrityFlags: integrityRes.count ?? 0,
      });
    } catch {
      setSourceNotice("Unable to load live Resident Assurance metrics. No fallback metrics are shown.");
      setSummary(EMPTY_SUMMARY);
    } finally {
      setLoading(false);
    }
  }, [selectedFacilityId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasUrgent = summary.urgentTasks > 0;

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6">
        
        {/* ─── MOONSHOT HEADER ─── */}
        <div className="flex flex-col gap-6 md:flex-row md:items-end justify-between bg-card p-8 rounded-lg border border-border shadow-sm mt-4">
           <div className="space-y-2">
             
             <h1 className="text-4xl md:text-2xl font-semibold tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
                Resident Assurance
             </h1>
             <p className="mt-2 font-medium tracking-wide text-slate-600 dark:text-zinc-400 max-w-2xl">
               Live rounding visibility, observation plans, and compliance reporting.
             </p>
           </div>
           <div>
              <RoundingHubNav />
           </div>
        </div>

        {sourceNotice ? (
          <AdminLiveDataFallbackNotice
            message={sourceNotice}
            onRetry={() => void load()}
          />
        ) : null}

        {/* Hero Start Rounds CTA */}
        <Link
          href="/admin/rounding/live"
          className={cn(
            "group relative block overflow-hidden rounded-lg border border-border p-8 transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)]",
            "",
            "border-emerald-500/30 hover:border-emerald-400/50",
            "shadow-lg shadow-emerald-900/20 hover:shadow-emerald-800/30",
          )}
        >
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-6">
              <div className="rounded-lg bg-success/20 p-5 group-hover:bg-success/30 transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)]">
                <Play className="h-10 w-10 text-emerald-400" />
              </div>
              <div>
                <h3 className="text-3xl font-semibold text-emerald-100 tracking-tight">Start Rounds</h3>
                <p className="text-sm font-medium text-emerald-300/70 mt-1">
                  {summary.activeTasks > 0
                    ? `${summary.activeTasks} checks due — tap to begin sequential rounding`
                    : "Open the live board to begin rounding"
                  }
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {summary.urgentTasks > 0 && (
                <span className="flex items-center gap-2 rounded-full bg-rose-500/20 px-4 py-1.5 text-xs font-mono font-bold uppercase tracking-wider text-rose-300 border border-rose-500/30">
                  {summary.urgentTasks} urgent
                </span>
              )}
              <div className="rounded-full bg-emerald-500/20 p-3 group-hover:bg-emerald-500 group-hover:text-white transition-all">
                <Play className="h-6 w-6 text-emerald-400 group-hover:text-white" />
              </div>
            </div>
          </div>
        </Link>

        <KineticGrid className="grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" staggerMs={50}>
          <MetricV2
            label="Active Plans"
            value={String(summary.plans)}
            hoverColor="cyan"
          />
          <MetricV2
            label="Active Tasks"
            value={String(summary.activeTasks)}
            hoverColor="indigo"
          />
          <MetricV2
            label="Urgent Now"
            value={String(summary.urgentTasks)}
            hoverColor={hasUrgent ? "rose" : "emerald"}
          />
          <MetricV2
            label="Completion Rate"
            value={`${Math.round(summary.completionRate * 100)}%`}
            hoverColor="emerald"
          />
        </KineticGrid>

        <KineticGrid className="grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4" staggerMs={80} baseDelayMs={200}>
          <ActionCard
            href="/admin/rounding/live"
            title="Live Board"
            description="Real-time view of due, overdue, and completed checks across all residents and shifts."
            icon={<Eye className="h-5 w-5" />}
            hoverColor="cyan"
            metrics={[
              { label: "On-time", value: `${Math.round(summary.onTimeRate * 100)}%` },
              { label: "Missed", value: String(summary.missedCount) },
            ]}
          />
          <ActionCard
            href="/admin/rounding/plans"
            title="Observation Plans"
            description="Create and manage resident cadence rules, daypart windows, grace periods, and assignments."
            icon={<ClipboardList className="h-5 w-5" />}
            hoverColor="indigo"
            metrics={[
              { label: "Plans", value: String(summary.plans) },
              { label: "Active", value: String(summary.plans) },
            ]}
          />
          <ActionCard
            href="/admin/rounding/reports"
            title="Completion Reports"
            description="Analyze completion, on-time, late, and missed rates by shift, staff member, and resident."
            icon={<FileBarChart className="h-5 w-5" />}
            hoverColor="emerald"
            metrics={[
              { label: "Completed", value: String(summary.completedCount) },
              { label: "Expected", value: String(summary.expectedCount) },
            ]}
          />
          <ActionCard
            href="/admin/rounding/watches"
            title="Watch Center"
            description="Approve triggered watches, review active watch load, and close or pause monitoring windows without losing audit evidence."
            icon={<Shield className="h-5 w-5" />}
            hoverColor="rose"
            metrics={[
              { label: "Active", value: String(summary.activeWatches) },
              { label: "Pending", value: String(summary.pendingApprovals) },
            ]}
          />
          <ActionCard
            href="/admin/rounding/escalations"
            title="Escalation Queue"
            description="Move overdue and missed checks into active review, then resolve or dismiss them with preserved audit context."
            icon={<AlertTriangle className="h-5 w-5" />}
            hoverColor="rose"
            metrics={[
              { label: "Open", value: String(summary.openEscalations) },
              { label: "Urgent", value: String(summary.urgentTasks) },
            ]}
          />
          <ActionCard
            href="/admin/rounding/integrity"
            title="Integrity Review"
            description="Review late-entry and documentation-quality flags before rounding evidence turns into an auditability gap."
            icon={<ShieldAlert className="h-5 w-5" />}
            hoverColor="indigo"
            metrics={[
              { label: "Open", value: String(summary.openIntegrityFlags) },
              {
                label: "Late",
                value: summary.expectedCount > 0
                  ? `${Math.round((1 - summary.onTimeRate) * 100)}%`
                  : "—",
              },
            ]}
          />
        </KineticGrid>

        <div className="flex flex-wrap items-center gap-3 pt-6 lg:justify-center">
          <Button
            onClick={() => void load()}
            variant="outline"
            className="h-[52px] px-8 rounded-lg border border-border bg-card text-foreground hover:bg-muted/40 shadow-sm text-xs font-bold uppercase tracking-wider tap-responsive"
          >
            <RefreshCw className="mr-3 h-4 w-4" />
            Sync Real-time
          </Button>
          <Link
            href="/admin/rounding/plans/new"
            className={cn(buttonVariants({ variant: "outline" }), "h-[52px] px-8 rounded-lg border-cyan-700/50 bg-cyan-950/30 text-cyan-200 hover:bg-cyan-900/40 text-xs font-bold uppercase tracking-wider tap-responsive")}
          >
            <UserPlus className="mr-3 h-4 w-4" />
            Create plan
          </Link>
          <Link
            href="/caregiver/rounds"
            className={cn(buttonVariants({ variant: "outline" }), "h-[52px] px-8 rounded-lg border-emerald-700/50 bg-emerald-950/30 text-emerald-200 hover:bg-emerald-900/40 text-xs font-bold uppercase tracking-wider tap-responsive")}
          >
            <Play className="mr-3 h-4 w-4" />
            Caregiver Interface
          </Link>
        </div>

      </div>
    </div>
  );
}

function MetricV2({
  label,
  value,
  hoverColor,
}: {
  label: string;
  value: string;
  hoverColor: string;
}) {
  const borderColor = {
    cyan: "border-cyan-500/20 shadow-[0_8px_30px_rgba(6,182,212,0.05)]",
    indigo: "border-primary-500/20 shadow-[0_8px_30px_rgba(99,102,241,0.05)]",
    emerald: "border-emerald-500/20 shadow-[0_8px_30px_rgba(16,185,129,0.05)]",
    rose: "border-rose-500/20 shadow-[0_8px_30px_rgba(244,63,94,0.05)]",
  }[hoverColor] || "";

  const labelColor = {
    cyan: "text-cyan-600 dark:text-cyan-400",
    indigo: "text-primary-600 dark:text-primary-400",
    emerald: "text-emerald-600 dark:text-emerald-400",
    rose: "text-rose-600 dark:text-rose-400",
  }[hoverColor] || "text-slate-400";

  return (
    <div className="h-[180px]">
      <V2Card hoverColor={hoverColor} className={cn("p-6", borderColor)}>
        <div className="relative z-10 flex flex-col h-full justify-between">
          <h3 className={cn("text-[11px] font-bold tracking-wider uppercase flex items-center gap-2", labelColor)}>
            {label}
          </h3>
          <p className={cn("text-2xl tracking-tight font-medium pb-2", labelColor)}>{value}</p>
        </div>
      </V2Card>
    </div>
  );
}

function ActionCard({
  href,
  title,
  description,
  icon,
  hoverColor,
  metrics,
}: {
  href: string;
  title: string;
  description: string;
  icon: ReactNode;
  hoverColor: string;
  metrics: { label: string; value: string }[];
}) {
  const accentColor = {
    cyan: "text-cyan-500",
    indigo: "text-primary-500",
    emerald: "text-emerald-500",
    rose: "text-rose-500",
  }[hoverColor] || "text-slate-400";

  const borderAccent = {
    cyan: "border-cyan-500/20",
    indigo: "border-primary-500/20",
    emerald: "border-emerald-500/20",
    rose: "border-rose-500/20",
  }[hoverColor] || "";

  return (
    <V2Card href={href} hoverColor={hoverColor} className={cn("p-6", borderAccent)}>
      <div className="flex flex-col h-full justify-between gap-6">
        <div>
          <div className={cn("flex items-center gap-3 mb-4", accentColor)}>
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center  border border-white/20">
              {icon}
            </div>
            <h3 className="text-[12px] font-bold tracking-wider uppercase">{title}</h3>
          </div>
          <p className="text-sm font-medium text-slate-600 dark:text-slate-400 leading-relaxed">{description}</p>
        </div>
        <div className="flex gap-8 pt-4 border-t border-slate-200 dark:border-white/5">
          {metrics.map((m) => (
            <div key={m.label} className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500">{m.label}</span>
              <span className={cn("text-2xl font-medium tracking-tight", accentColor)}>{m.value}</span>
            </div>
          ))}
        </div>
      </div>
    </V2Card>
  );
}
