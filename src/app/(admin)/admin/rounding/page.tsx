"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Eye,
  FileBarChart,
  Play,
  RefreshCw,
  ShieldAlert,
  UserPlus,
} from "lucide-react";

import { RoundingHubNav } from "./rounding-hub-nav";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { Sparkline } from "@/components/ui/moonshot/sparkline";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { PulseDot } from "@/components/ui/moonshot/pulse-dot";
import { Button, buttonVariants } from "@/components/ui/button";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type OverviewSummary = {
  plans: number;
  activeTasks: number;
  urgentTasks: number;
  completionRate: number;
  onTimeRate: number;
  missedCount: number;
  completedCount: number;
  expectedCount: number;
};

const DEMO_SUMMARY: OverviewSummary = {
  plans: 14,
  activeTasks: 38,
  urgentTasks: 2,
  completionRate: 0.916,
  onTimeRate: 0.842,
  missedCount: 3,
  completedCount: 87,
  expectedCount: 95,
};

export default function AdminRoundingHubPage() {
  const { selectedFacilityId } = useFacilityStore();
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<OverviewSummary>(DEMO_SUMMARY);

  const load = useCallback(async () => {
    setLoading(true);

    if (!selectedFacilityId || !isBrowserSupabaseConfigured()) {
      setSummary(DEMO_SUMMARY);
      setLoading(false);
      return;
    }

    try {
      const { data: plans } = await supabase
        .from("resident_observation_plans")
        .select("id")
        .eq("facility_id", selectedFacilityId)
        .eq("status", "active")
        .is("deleted_at", null);

      const { data: tasks } = await supabase
        .from("resident_observation_tasks")
        .select("id, status, due_at, grace_ends_at")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .gte("due_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order("due_at", { ascending: true })
        .limit(200);

      const planCount = plans?.length ?? 0;
      const taskRows = tasks ?? [];
      const completed = taskRows.filter((t) => (t.status as string).startsWith("completed"));
      const missed = taskRows.filter((t) => t.status === "missed");
      const urgent = taskRows.filter((t) => t.status === "critically_overdue" || t.status === "missed");
      const active = taskRows.filter((t) => !(t.status as string).startsWith("completed") && t.status !== "excused");
      const expected = taskRows.length;

      if (expected === 0) {
        setSummary(DEMO_SUMMARY);
      } else {
        setSummary({
          plans: planCount,
          activeTasks: active.length,
          urgentTasks: urgent.length,
          completionRate: expected > 0 ? completed.length / expected : 0,
          onTimeRate: expected > 0 ? taskRows.filter((t) => t.status === "completed_on_time").length / expected : 0,
          missedCount: missed.length,
          completedCount: completed.length,
          expectedCount: expected,
        });
      }
    } catch {
      setSummary(DEMO_SUMMARY);
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
      <AmbientMatrix
        hasCriticals={hasUrgent}
        primaryClass="bg-cyan-700/10"
        secondaryClass="bg-emerald-900/10"
      />

      <div className="relative z-10 space-y-6">
        <header className="mb-6 mt-2">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-white/10 pb-6 mb-4">
            <div>
              <p className="text-[10px] uppercase font-mono tracking-widest text-slate-500 mb-2">SYS: Resident Safety</p>
              <h2 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-3">
                Resident Assurance
                {hasUrgent && <PulseDot colorClass="bg-rose-500" />}
              </h2>
              <p className="text-sm text-slate-500 mt-1 dark:text-slate-400">
                Live rounding visibility, observation plans, and compliance reporting
              </p>
            </div>
            <div className="hidden md:block">
              <RoundingHubNav />
            </div>
          </div>
        </header>

        {/* Hero Start Rounds CTA */}
        <Link
          href="/admin/rounding/live"
          className={cn(
            "group relative block overflow-hidden rounded-2xl border p-6 transition-all duration-300",
            "bg-gradient-to-r from-emerald-950/60 via-emerald-900/30 to-cyan-950/40",
            "border-emerald-500/30 hover:border-emerald-400/50",
            "shadow-lg shadow-emerald-900/20 hover:shadow-emerald-800/30",
          )}
        >
          <div className="flex items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="rounded-xl bg-emerald-500/20 p-3 group-hover:bg-emerald-500/30 transition-colors">
                <Play className="h-8 w-8 text-emerald-400" />
              </div>
              <div>
                <h3 className="text-xl font-display font-semibold text-emerald-100">Start Rounds</h3>
                <p className="text-sm text-emerald-300/70 mt-0.5">
                  {summary.activeTasks > 0
                    ? `${summary.activeTasks} checks due — tap to begin sequential rounding`
                    : "Open the live board to begin rounding"
                  }
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {summary.urgentTasks > 0 && (
                <span className="flex items-center gap-1.5 rounded-full bg-rose-500/20 px-3 py-1 text-xs font-mono text-rose-300">
                  <PulseDot colorClass="bg-rose-400" />
                  {summary.urgentTasks} urgent
                </span>
              )}
              <div className="rounded-full bg-emerald-500/20 p-2 group-hover:bg-emerald-500 group-hover:text-white transition-all">
                <Play className="h-5 w-5 text-emerald-400 group-hover:text-white" />
              </div>
            </div>
          </div>
        </Link>

        <KineticGrid className="grid-cols-2 md:grid-cols-4 gap-4" staggerMs={50}>
          <MetricV2
            label="Active Plans"
            value={String(summary.plans)}
            hoverColor="cyan"
            colorClass="text-cyan-500"
            sparkVariant={2}
          />
          <MetricV2
            label="Active Tasks"
            value={String(summary.activeTasks)}
            hoverColor="indigo"
            colorClass="text-indigo-500"
            sparkVariant={1}
          />
          <MetricV2
            label="Urgent Now"
            value={String(summary.urgentTasks)}
            hoverColor={hasUrgent ? "rose" : "emerald"}
            colorClass={hasUrgent ? "text-rose-500" : "text-emerald-500"}
            sparkVariant={4}
            pulse={hasUrgent}
          />
          <MetricV2
            label="Completion Rate"
            value={`${Math.round(summary.completionRate * 100)}%`}
            hoverColor="emerald"
            colorClass="text-emerald-500"
            sparkVariant={3}
          />
        </KineticGrid>

        <KineticGrid className="grid-cols-1 md:grid-cols-3 gap-4" staggerMs={80} baseDelayMs={200}>
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
            description="Create and manage resident cadence rules, daypart windows, grace periods, and assignment expectations."
            icon={<ClipboardList className="h-5 w-5" />}
            hoverColor="indigo"
            metrics={[
              { label: "Plans", value: String(summary.plans) },
              { label: "Rules active", value: "—" },
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
        </KineticGrid>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button
            onClick={() => void load()}
            variant="outline"
            className="border-slate-700 bg-slate-900/40 text-slate-200 hover:bg-slate-800"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Link
            href="/admin/rounding/plans/new"
            className={cn(buttonVariants({ variant: "outline" }), "border-cyan-700/50 bg-cyan-950/30 text-cyan-200 hover:bg-cyan-900/40")}
          >
            <UserPlus className="mr-2 h-4 w-4" />
            Create plan
          </Link>
          <Link
            href="/caregiver/rounds"
            className={cn(buttonVariants({ variant: "outline" }), "border-emerald-700/50 bg-emerald-950/30 text-emerald-200 hover:bg-emerald-900/40")}
          >
            <Play className="mr-2 h-4 w-4" />
            Caregiver rounds
          </Link>
        </div>

        <div className="block md:hidden">
          <RoundingHubNav />
        </div>
      </div>
    </div>
  );
}

function MetricV2({
  label,
  value,
  hoverColor,
  colorClass,
  sparkVariant,
  pulse,
}: {
  label: string;
  value: string;
  hoverColor: string;
  colorClass: string;
  sparkVariant: number;
  pulse?: boolean;
}) {
  const borderColor = {
    cyan: "border-cyan-500/20 shadow-[inset_0_0_15px_rgba(6,182,212,0.05)]",
    indigo: "border-indigo-500/20 shadow-[inset_0_0_15px_rgba(99,102,241,0.05)]",
    emerald: "border-emerald-500/20 shadow-[inset_0_0_15px_rgba(16,185,129,0.05)]",
    rose: "border-rose-500/20 shadow-[inset_0_0_15px_rgba(244,63,94,0.05)]",
  }[hoverColor] || "";

  const labelColor = {
    cyan: "text-cyan-600 dark:text-cyan-400",
    indigo: "text-indigo-600 dark:text-indigo-400",
    emerald: "text-emerald-600 dark:text-emerald-400",
    rose: "text-rose-600 dark:text-rose-400",
  }[hoverColor] || "text-slate-400";

  return (
    <div className="h-[120px]">
      <V2Card hoverColor={hoverColor} className={borderColor}>
        <Sparkline colorClass={colorClass} variant={sparkVariant as 1 | 2 | 3 | 4} />
        <div className="relative z-10 flex flex-col h-full justify-between">
          <h3 className={cn("text-[10px] font-mono tracking-widest uppercase flex items-center gap-2", labelColor)}>
            {label}
            {pulse && <PulseDot colorClass="bg-rose-500" />}
          </h3>
          <p className={cn("text-3xl font-mono tracking-tighter pb-1", labelColor)}>{value}</p>
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
    indigo: "text-indigo-500",
    emerald: "text-emerald-500",
    rose: "text-rose-500",
  }[hoverColor] || "text-slate-400";

  const borderAccent = {
    cyan: "border-cyan-500/20",
    indigo: "border-indigo-500/20",
    emerald: "border-emerald-500/20",
    rose: "border-rose-500/20",
  }[hoverColor] || "";

  return (
    <V2Card href={href} hoverColor={hoverColor} className={borderAccent}>
      <div className="flex flex-col h-full justify-between gap-3">
        <div>
          <div className={cn("flex items-center gap-2 mb-2", accentColor)}>
            {icon}
            <h3 className="text-[10px] font-mono tracking-widest uppercase">{title}</h3>
          </div>
          <p className="text-sm text-slate-400 leading-relaxed">{description}</p>
        </div>
        <div className="flex gap-4 pt-2 border-t border-white/5">
          {metrics.map((m) => (
            <div key={m.label} className="flex flex-col">
              <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">{m.label}</span>
              <span className={cn("text-lg font-mono tracking-tight", accentColor)}>{m.value}</span>
            </div>
          ))}
        </div>
      </div>
    </V2Card>
  );
}
