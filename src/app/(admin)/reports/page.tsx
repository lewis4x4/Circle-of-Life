"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CalendarClock,
  ChevronRight,
  Fingerprint,
  FolderOpen,
  History,
  Layers,
  LayoutGrid,
  MessageSquareText,
  Save,
  ShieldCheck,
  Sparkles,
  Clock,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { ReportsHubNav } from "@/components/reports/reports-hub-nav";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { loadReportsRoleContext } from "@/lib/reports/auth";
import { cn } from "@/lib/utils";

import { KineticGrid } from "@/components/ui/kinetic-grid";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { Sparkline } from "@/components/ui/moonshot/sparkline";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";

const DISPLAY_TZ = "America/New_York";

type CountCard = {
  title: string;
  value: number;
  hint: string;
  icon: LucideIcon;
  color: string;
  href: string;
  variant: 1 | 2 | 3 | 4 | 5;
};

type RecentRun = {
  id: string;
  source_type: string;
  source_id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
};

function formatRunTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: DISPLAY_TZ,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const WORKFLOW_STEPS = [
  {
    n: 1,
    title: "Pick a template",
    body: "Start from official catalogs or org-specific definitions.",
    href: "/admin/reports/templates",
  },
  {
    n: 2,
    title: "Save & tailor",
    body: "Pin filters and naming so teams reuse the same view.",
    href: "/admin/reports/saved",
  },
  {
    n: 3,
    title: "Schedule or run",
    body: "Recurring jobs for leadership; ad-hoc runs for surveys.",
    href: "/admin/reports/scheduled",
  },
  {
    n: 4,
    title: "Audit & export",
    body: "Every execution is logged with status and timestamps.",
    href: "/admin/reports/history",
  },
] as const;

const QUICK_ACTIONS = [
  {
    title: "Template library",
    description: "Browse and open report definitions across the portfolio.",
    href: "/admin/reports/templates",
    icon: LayoutGrid,
    accent: "indigo",
  },
  {
    title: "Natural language (NLQ)",
    description: "Ask questions in plain English and route to governed outputs.",
    href: "/admin/reports/nlq",
    icon: MessageSquareText,
    accent: "violet",
  },
  {
    title: "Report packs",
    description: "Bundle executive and compliance sets for one-click delivery.",
    href: "/admin/reports/packs",
    icon: Layers,
    accent: "rose",
  },
  {
    title: "Governance & access",
    description: "Who can run exports, retention, and classification rules.",
    href: "/admin/reports/admin",
    icon: ShieldCheck,
    accent: "emerald",
  },
] as const;

export default function ReportsOverviewPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cards, setCards] = useState<CountCard[]>([]);
  const [recentRuns, setRecentRuns] = useState<RecentRun[]>([]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const ctx = await loadReportsRoleContext(supabase);
        if (!ctx.ok) throw new Error(ctx.error);

        const [templatesRes, savedRes, schedulesRes, packsRes, runsRes, recentRes] = await Promise.all([
          supabase.from("report_templates").select("id", { count: "exact", head: true }),
          supabase
            .from("report_saved_views")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", ctx.ctx.organizationId)
            .is("deleted_at", null),
          supabase
            .from("report_schedules")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", ctx.ctx.organizationId)
            .is("deleted_at", null)
            .eq("status", "active"),
          supabase
            .from("report_packs")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", ctx.ctx.organizationId)
            .is("deleted_at", null)
            .eq("active", true),
          supabase
            .from("report_runs")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", ctx.ctx.organizationId),
          supabase
            .from("report_runs")
            .select("id, source_type, source_id, status, started_at, completed_at")
            .eq("organization_id", ctx.ctx.organizationId)
            .order("started_at", { ascending: false })
            .limit(6),
        ]);

        const firstError = [
          templatesRes.error,
          savedRes.error,
          schedulesRes.error,
          packsRes.error,
          runsRes.error,
          recentRes.error,
        ].find(Boolean);
        if (firstError) throw new Error(firstError.message);

        if (alive) {
          setCards([
            {
              title: "Template Library",
              value: templatesRes.count ?? 0,
              hint: "Official and custom templates you can run or schedule.",
              icon: Fingerprint,
              color: "indigo",
              href: "/admin/reports/templates",
              variant: 1,
            },
            {
              title: "Saved Reports",
              value: savedRes.count ?? 0,
              hint: "Pinned views and inherited variants for repeat use.",
              icon: Save,
              color: "emerald",
              href: "/admin/reports/saved",
              variant: 2,
            },
            {
              title: "Active Schedules",
              value: schedulesRes.count ?? 0,
              hint: "Recurring jobs delivering to leadership inboxes.",
              icon: Clock,
              color: "amber",
              href: "/admin/reports/scheduled",
              variant: 3,
            },
            {
              title: "Report Packs",
              value: packsRes.count ?? 0,
              hint: "Executive and compliance bundles shipped together.",
              icon: FolderOpen,
              color: "rose",
              href: "/admin/reports/packs",
              variant: 4,
            },
            {
              title: "Run History",
              value: runsRes.count ?? 0,
              hint: "Immutable log of who ran what and export outcomes.",
              icon: Layers,
              color: "blue",
              href: "/admin/reports/history",
              variant: 5,
            },
          ]);
          setRecentRuns((recentRes.data ?? []) as RecentRun[]);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Failed to load reporting overview.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [supabase]);

  const orderedCards = useMemo(() => cards, [cards]);
  const placeholderCards = useMemo<CountCard[]>(
    () =>
      Array.from({ length: 5 }, (_, index) => ({
        title: `Metric ${index + 1}`,
        value: 0,
        hint: "Loading catalog…",
        icon: Fingerprint,
        color: "slate",
        href: "#",
        variant: 1,
      })),
    []
  );

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-8 pb-16">
      <AmbientMatrix hasCriticals={false} primaryClass="bg-indigo-700/10" secondaryClass="bg-slate-900/10" />

      <div className="relative z-10 mx-auto max-w-7xl space-y-8 px-4 sm:px-6 xl:px-0">
        <ReportsHubNav />

        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="rounded-full border border-indigo-500/20 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 uppercase tracking-widest text-[9px] font-bold px-2 py-0.5">
                <Sparkles className="mr-1 size-3" aria-hidden />
                Governed exports
              </Badge>
              <span className="text-[10px] font-mono tracking-widest uppercase text-slate-500 dark:text-slate-400">Template → schedule → audit trail</span>
            </div>
            <h1 className="font-display flex items-center gap-4 text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white">
              <Layers className="size-10 shrink-0 text-indigo-500" strokeWidth={1.5} aria-hidden />
              Reporting Hub
            </h1>
            <p className="max-w-2xl text-balance text-base font-medium leading-relaxed text-slate-600 dark:text-zinc-400">
              One place to run portfolio analytics, package leadership briefings, and prove what was generated—without
              spreadsheets on shared drives.
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
            <Link href="/admin/reports/templates" className={cn(buttonVariants({ variant: "default", size: "lg" }), "gap-2 rounded-xl text-xs uppercase tracking-widest font-bold")}>
              Browse templates
              <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link
              href="/admin/reports/nlq"
              className={cn(buttonVariants({ variant: "outline", size: "lg" }), "gap-2 border-indigo-500/30 dark:border-indigo-400/30 rounded-xl text-xs uppercase tracking-widest font-bold")}
            >
              <MessageSquareText className="size-4" aria-hidden />
              Ask NLQ
            </Link>
          </div>
        </header>

        {error && (
          <div className="flex items-center gap-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-6 text-sm font-medium tracking-wide text-rose-600 dark:text-rose-400">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full border border-rose-500/30 bg-rose-500/20 font-bold">!</div>
            {error}
          </div>
        )}

        {/* Metric cards */}
        <KineticGrid className="grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5" staggerMs={75}>
          {(loading ? placeholderCards : orderedCards).map((card, idx) => {
            const Icon = card.icon;
            const colorName = card.color;

            return (
              <Link
                key={card.title + idx}
                href={card.href}
                className="tap-responsive group block h-[180px] lg:h-[190px] outline-none"
              >
                <V2Card
                  hoverColor={colorName}
                  className="flex flex-col h-full bg-white/40 dark:bg-black/20 p-5 rounded-3xl border border-white/20 dark:border-white/5 backdrop-blur-2xl shadow-xl transition-all hover:-translate-y-1 overflow-hidden"
                >
                  <Sparkline colorClass={`text-${colorName}-500`} variant={card.variant} />
                  <MonolithicWatermark value={loading ? 0 : card.value} className="opacity-40" />

                  <div className="relative z-10 flex flex-col h-full justify-between">
                    <div className="flex justify-between items-start gap-2">
                       <h3 className={cn("text-[10px] font-mono tracking-widest uppercase w-2/3 leading-snug flex items-center gap-2", `text-${colorName}-600 dark:text-${colorName}-400`)}>
                         {card.title}
                       </h3>
                       <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center shrink-0 group-hover:bg-opacity-20 transition-colors border", `border-${colorName}-500/20 text-${colorName}-600 dark:text-${colorName}-400 bg-${colorName}-500/10 shadow-inner`)}>
                         <Icon className="size-4" aria-hidden />
                       </div>
                    </div>
                    
                    <div className="flex flex-col">
                       <span className={cn("text-4xl lg:text-5xl font-mono tracking-tighter tabular-nums pb-1 leading-none text-slate-800 dark:text-slate-100 group-hover:text-transparent group-hover:bg-clip-text transition-all duration-300", `group-hover:bg-gradient-to-b group-hover:from-${colorName}-600 group-hover:to-${colorName}-400 dark:group-hover:from-${colorName}-300 dark:group-hover:to-${colorName}-500`)}>
                          {loading ? "-" : card.value.toLocaleString()}
                       </span>
                       <span className="text-[9px] uppercase tracking-widest font-mono text-slate-500 dark:text-slate-400 mt-1 line-clamp-2 leading-tight">
                          {card.hint}
                       </span>
                    </div>
                  </div>
                </V2Card>
              </Link>
            );
          })}
        </KineticGrid>

        {/* Workflow strip */}
        <section
          className="rounded-[2rem] border border-slate-200/60 bg-gradient-to-br from-slate-50/90 to-white/80 p-6 shadow-sm backdrop-blur-xl dark:border-white/5 dark:from-white/[0.04] dark:to-black/20 sm:p-8"
          aria-labelledby="reports-workflow-heading"
        >
          <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 id="reports-workflow-heading" className="font-display text-xl font-semibold text-slate-900 dark:text-white">
                How reporting works here
              </h2>
              <p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
                Structured steps so clinical and finance leaders get the same numbers—and compliance can trace every file.
              </p>
            </div>
            <Link
              href="/admin/reports/templates"
              className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400 sm:mt-0"
            >
              Open library
              <ChevronRight className="size-4" aria-hidden />
            </Link>
          </div>
          <ol className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {WORKFLOW_STEPS.map((step, i) => (
              <li key={step.n}>
                <Link
                  href={step.href}
                  className="flex h-full flex-col rounded-2xl border border-slate-200/80 bg-white/70 p-5 transition hover:border-indigo-400/40 hover:shadow-md dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-indigo-400/30"
                >
                  <span className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    <span className="flex size-7 items-center justify-center rounded-full bg-indigo-500/15 text-xs font-bold text-indigo-700 dark:text-indigo-300">
                      {step.n}
                    </span>
                    {i < WORKFLOW_STEPS.length - 1 && (
                      <ArrowRight className="ml-auto hidden size-4 text-slate-300 xl:block" aria-hidden />
                    )}
                  </span>
                  <span className="font-semibold text-slate-900 dark:text-white">{step.title}</span>
                  <span className="mt-1 flex-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{step.body}</span>
                </Link>
              </li>
            ))}
          </ol>
        </section>

        <div className="grid gap-8 lg:grid-cols-12">
          {/* Quick actions */}
          <section className="lg:col-span-7" aria-labelledby="quick-actions-heading">
            <h2 id="quick-actions-heading" className="mb-4 font-display text-lg font-semibold text-slate-900 dark:text-white">
              Jump in
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {QUICK_ACTIONS.map((action) => {
                const AIcon = action.icon;
                const ring =
                  action.accent === "indigo"
                    ? "hover:border-indigo-400/50 hover:shadow-indigo-500/10"
                    : action.accent === "violet"
                      ? "hover:border-violet-400/50 hover:shadow-violet-500/10"
                      : action.accent === "rose"
                        ? "hover:border-rose-400/50 hover:shadow-rose-500/10"
                        : "hover:border-emerald-400/50 hover:shadow-emerald-500/10";
                const iconBg =
                  action.accent === "indigo"
                    ? "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300"
                    : action.accent === "violet"
                      ? "bg-violet-500/15 text-violet-700 dark:text-violet-300"
                      : action.accent === "rose"
                        ? "bg-rose-500/15 text-rose-700 dark:text-rose-300"
                        : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";

                return (
                  <Link
                    key={action.href}
                    href={action.href}
                    className={cn(
                      "group flex gap-4 rounded-2xl border border-slate-200/80 bg-white/60 p-4 shadow-sm backdrop-blur transition hover:-translate-y-0.5 dark:border-white/10 dark:bg-white/[0.03]",
                      ring
                    )}
                  >
                    <div className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl", iconBg)}>
                      <AIcon className="size-5" aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold text-slate-900 dark:text-white">{action.title}</span>
                        <ArrowRight className="size-4 shrink-0 text-slate-400 opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" aria-hidden />
                      </div>
                      <p className="mt-0.5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{action.description}</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>

          {/* Recent activity */}
          <section
            className="flex flex-col rounded-[2rem] border border-slate-200/60 bg-white/50 p-6 shadow-sm backdrop-blur-xl dark:border-white/5 dark:bg-black/20 lg:col-span-5"
            aria-labelledby="recent-activity-heading"
          >
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 id="recent-activity-heading" className="font-display text-lg font-semibold text-slate-900 dark:text-white">
                Recent activity
              </h2>
              <Link
                href="/admin/reports/history"
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-1 text-indigo-600 dark:text-indigo-400")}
              >
                <History className="size-3.5" aria-hidden />
                Full history
              </Link>
            </div>

            {loading ? (
              <div className="flex flex-1 flex-col justify-center py-12 text-center text-sm text-slate-500">Loading runs…</div>
            ) : recentRuns.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-12 text-center dark:border-white/10 dark:bg-white/[0.02]">
                <CalendarClock className="mb-3 size-10 text-slate-300 dark:text-slate-600" aria-hidden />
                <p className="font-medium text-slate-900 dark:text-slate-100">No runs yet</p>
                <p className="mt-1 max-w-xs text-sm text-slate-600 dark:text-slate-400">
                  Execute a template or schedule a job—each run will appear here with status and timestamps.
                </p>
                <Link href="/admin/reports/templates" className={cn(buttonVariants({ variant: "outline", size: "default" }), "mt-4")}>
                  Go to templates
                </Link>
              </div>
            ) : (
              <ul className="space-y-2">
                {recentRuns.map((run) => {
                  const detailHref = `/admin/reports/run/${encodeURIComponent(run.source_type)}/${encodeURIComponent(run.source_id)}`;
                  const statusOk = run.status === "completed";
                  const statusFail = run.status === "failed";

                  return (
                    <li key={run.id}>
                      <Link
                        href={detailHref}
                        className="flex items-center gap-3 rounded-xl border border-transparent bg-slate-50/80 px-3 py-2.5 transition hover:border-slate-200 hover:bg-white dark:bg-white/[0.04] dark:hover:border-white/10 dark:hover:bg-white/[0.07]"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate font-mono text-xs font-medium text-slate-800 dark:text-slate-100">{run.source_type}</span>
                            {statusOk ? (
                              <Badge className="rounded-full border border-emerald-200 bg-emerald-50 text-[10px] text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                                Done
                              </Badge>
                            ) : statusFail ? (
                              <Badge className="rounded-full border border-rose-200 bg-rose-50 text-[10px] text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                                Failed
                              </Badge>
                            ) : (
                              <Badge className="rounded-full border border-amber-200 bg-amber-50 text-[10px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                                {run.status}
                              </Badge>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{formatRunTime(run.started_at)} · NY</p>
                        </div>
                        <ChevronRight className="size-4 shrink-0 text-slate-400" aria-hidden />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
