"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
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
  Clock,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { ReportsHubNav } from "@/components/reports/reports-hub-nav";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { TableRow, TableRowHeader } from "@/components/ui/table-row";
import { getDashboardRouteForRole } from "@/lib/auth/dashboard-routing";
import { createClient } from "@/lib/supabase/client";
import { loadReportsRoleContext } from "@/lib/reports/auth";
import { cn } from "@/lib/utils";

import { KineticGrid } from "@/components/ui/kinetic-grid";
import { V2Card } from "@/components/ui/v2-card";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";
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
    title: "Haven Insight",
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
  const [homeHref, setHomeHref] = useState("/admin/executive");

  useEffect(() => {
    let alive = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const ctx = await loadReportsRoleContext(supabase);
        if (!ctx.ok) throw new Error(ctx.error);
        if (alive) {
          setHomeHref(getDashboardRouteForRole(ctx.ctx.appRole));
        }

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
      <></>

      <div className="relative z-10 mx-auto max-w-7xl space-y-8 px-4 sm:px-6 xl:px-0">
        <ReportsHubNav />

        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-card p-8 rounded-lg border border-border shadow-sm mt-4">
          <div className="space-y-3">
            <Link href={homeHref} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="w-3.5 h-3.5" /> Back to Dashboard
            </Link>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="rounded-full border border-info/20 bg-info/10 text-info uppercase tracking-wider text-[9px] font-bold px-2 py-0.5">
                Governed exports
              </Badge>
              <span className="text-[10px] font-mono tracking-wider uppercase text-slate-500 dark:text-slate-400">Template → schedule → audit trail</span>
            </div>
            <h1 className="flex items-center gap-4 text-4xl md:text-2xl font-semibold tracking-tight text-foreground">
              <Layers className="size-10 shrink-0 text-indigo-500" strokeWidth={1.5} aria-hidden />
              Reporting Hub
            </h1>
            <p className="max-w-2xl text-balance text-base font-medium leading-relaxed text-muted-foreground">
              One place to run portfolio analytics, package leadership briefings, and prove what was generated—without
              spreadsheets on shared drives.
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
            <Link href="/admin/reports/templates" className={cn(buttonVariants({ variant: "default", size: "lg" }), "gap-2 rounded-lg text-xs uppercase tracking-wider font-bold")}>
              Browse templates
              <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link
              href="/admin/reports/nlq"
              className={cn(buttonVariants({ variant: "outline", size: "lg" }), "gap-2 border-indigo-500/30 dark:border-indigo-400/30 rounded-xl text-xs uppercase tracking-wider font-bold")}
            >
              <MessageSquareText className="size-4" aria-hidden />
              Ask Haven Insight
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
                  className="flex flex-col h-full bg-card p-5 rounded-lg border border-white/20 dark:border-white/5 shadow-xl transition-all hover:-translate-y-1 overflow-hidden"
                >
                  <></>
                  <MonolithicWatermark value={loading ? 0 : card.value} className="opacity-40" />

                  <div className="relative z-10 flex flex-col h-full justify-between">
                    <div className="flex justify-between items-start gap-2">
                       <h3 className={cn("text-[10px] font-mono tracking-wider uppercase w-2/3 leading-snug flex items-center gap-2", `text-${colorName}-600 dark:text-${colorName}-400`)}>
                         {card.title}
                       </h3>
                       <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center shrink-0 group-hover:bg-opacity-20 transition-colors border", `border-${colorName}-500/20 text-${colorName}-600 dark:text-${colorName}-400 bg-${colorName}-500/10 shadow-inner`)}>
                         <Icon className="size-4" aria-hidden />
                       </div>
                    </div>
                    
                    <div className="flex flex-col">
                       <span className="text-4xl lg:text-2xl font-mono tracking-tighter tabular-nums pb-1 leading-none text-foreground transition-colors duration-300">
                          {loading ? "-" : card.value.toLocaleString()}
                       </span>
                       <span className="text-[9px] uppercase tracking-wider font-mono text-slate-500 dark:text-slate-400 mt-1 line-clamp-2 leading-tight">
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
          className="rounded-lg border border-border bg-card p-6 shadow-sm sm:p-8"
          aria-labelledby="reports-workflow-heading"
        >
          <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 id="reports-workflow-heading" className="text-xl font-semibold text-foreground">
                How reporting works here
              </h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
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
                  className="flex h-full flex-col rounded-lg border border-border bg-card p-5 transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:-translate-y-0.5 hover:shadow-md"
                >
                  <span className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <span className="flex size-7 items-center justify-center rounded-full bg-info/15 text-xs font-bold text-info">
                      {step.n}
                    </span>
                    {i < WORKFLOW_STEPS.length - 1 && (
                      <ArrowRight className="ml-auto hidden size-4 text-slate-300 xl:block" aria-hidden />
                    )}
                  </span>
                  <span className="font-semibold text-foreground">{step.title}</span>
                  <span className="mt-1 flex-1 text-sm leading-relaxed text-muted-foreground">{step.body}</span>
                </Link>
              </li>
            ))}
          </ol>
        </section>

        <div className="grid gap-8 lg:grid-cols-12">
          {/* Quick actions */}
          <section className="lg:col-span-7" aria-labelledby="quick-actions-heading">
            <h2 id="quick-actions-heading" className="mb-4 text-lg font-semibold text-foreground">
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
                      "group flex gap-4 rounded-lg border border-border bg-card p-4 shadow-sm transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
                      ring
                    )}
                  >
                    <div className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl", iconBg)}>
                      <AIcon className="size-5" aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold text-foreground">{action.title}</span>
                        <ArrowRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" aria-hidden />
                      </div>
                      <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{action.description}</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>

          {/* Recent activity */}
          <section
            className="flex flex-col rounded-lg border border-border bg-card p-6 shadow-sm lg:col-span-5"
            aria-labelledby="recent-activity-heading"
          >
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 id="recent-activity-heading" className="text-lg font-semibold text-foreground">
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
              <div className="flex flex-1 flex-col justify-center py-12 text-center text-sm text-muted-foreground">Loading runs…</div>
            ) : recentRuns.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-6 py-12 text-center">
                <CalendarClock className="mb-3 size-10 text-muted-foreground/50" aria-hidden />
                <p className="font-medium text-foreground">No runs yet</p>
                <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                  Execute a template or schedule a job—each run will appear here with status and timestamps.
                </p>
                <Link href="/admin/reports/templates" className={cn(buttonVariants({ variant: "outline", size: "default" }), "mt-4")}>
                  Go to templates
                </Link>
              </div>
            ) : (
              <div>
                <TableRowHeader>
                  <span className="flex-1 min-w-0">Source</span>
                  <span className="w-[90px] shrink-0">Status</span>
                  <span className="w-[110px] shrink-0 text-right">Started</span>
                </TableRowHeader>
                <ul className="space-y-1 p-1">
                  {recentRuns.map((run) => {
                    const detailHref = `/admin/reports/run/${encodeURIComponent(run.source_type)}/${encodeURIComponent(run.source_id)}`;
                    const statusOk = run.status === "completed";
                    const statusFail = run.status === "failed";

                    return (
                      <li key={run.id}>
                        <TableRow render={<Link href={detailHref} />}>
                          <span className="flex-1 min-w-0 truncate font-mono text-[12px] font-medium text-foreground">
                            {run.source_type}
                          </span>
                          <span className="w-[90px] shrink-0">
                            {statusOk ? (
                              <StatusPill tone="muted">Done</StatusPill>
                            ) : statusFail ? (
                              <StatusPill tone="danger">Failed</StatusPill>
                            ) : (
                              <StatusPill tone="warning">{run.status}</StatusPill>
                            )}
                          </span>
                          <span className="w-[110px] shrink-0 text-right text-[11px] text-muted-foreground font-mono tabular-nums truncate">
                            {formatRunTime(run.started_at)}
                          </span>
                        </TableRow>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
