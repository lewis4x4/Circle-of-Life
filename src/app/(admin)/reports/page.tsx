"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { History, ArrowRight, X } from "lucide-react";

import { ReportsHubNav } from "@/components/reports/reports-hub-nav";
import { SourceReadinessCallout } from "@/components/common/source-readiness-callout";
import { Button, buttonVariants } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { getDashboardRouteForRole } from "@/lib/auth/dashboard-routing";
import { REPORTING_SOURCE_READINESS } from "@/lib/reporting-source-readiness";
import { createClient } from "@/lib/supabase/client";
import { loadReportsRoleContext } from "@/lib/reports/auth";
import {
  mergeReportingHubOnboardingDismissed,
  parseReportingHubOnboardingDismissedAt,
} from "@/lib/reports/hub-preferences";
import { cn } from "@/lib/utils";
import type { Json } from "@/types/database";

const DISPLAY_TZ = "America/New_York";

const ONBOARD_STEPS = [
  { n: 1, title: "Pick a template", body: "Start from governed definitions your role can access." },
  { n: 2, title: "Save & tailor", body: "Pin filters and naming so teams reuse the same view." },
  { n: 3, title: "Schedule or run", body: "Recurring leadership jobs or ad hoc portfolio pulls." },
  { n: 4, title: "Audit & export", body: "Every execution stays in history with timestamps." },
] as const;

type RecentRun = {
  id: string;
  source_type: string;
  source_id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
};

type TemplateCatalogRow = { id: string; slug: string; name: string };

type HubRow = {
  templateId: string;
  slug: string;
  name: string;
  runCount: number;
  lastRunAt: string | null;
  scheduleLabel: string;
};

type StatusCounts = {
  templates: number;
  saved: number;
  schedules: number;
  packs: number;
  history: number;
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

function scheduleMatchesTemplate(scheduleSourceId: string, t: TemplateCatalogRow): boolean {
  const sid = scheduleSourceId.trim();
  return sid === t.id || sid === t.slug;
}

export default function ReportsOverviewPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<StatusCounts | null>(null);
  const [recentRuns, setRecentRuns] = useState<RecentRun[]>([]);
  const [pinnedRows, setPinnedRows] = useState<HubRow[]>([]);
  const [hubRowsFallback, setHubRowsFallback] = useState(false);
  const [homeHref, setHomeHref] = useState("/admin/executive");
  const [userId, setUserId] = useState<string | null>(null);
  const [currentSettings, setCurrentSettings] = useState<Json | null>(null);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [reportingHubOnboardingDismissed, setReportingHubOnboardingDismissed] = useState(false);
  const [dismissBusy, setDismissBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ctx = await loadReportsRoleContext(supabase);
      if (!ctx.ok) throw new Error(ctx.error);

      const uId = ctx.ctx.userId;
      setHomeHref(getDashboardRouteForRole(ctx.ctx.appRole));
      setUserId(uId);

      const [
        profileRes,
        templatesRes,
        savedRes,
        schedulesRes,
        packsRes,
        runsTotalRes,
        recentRes,
        catalogRes,
        userRunsRes,
        scheduleListRes,
      ] = await Promise.all([
        supabase.from("user_profiles").select("settings").eq("id", uId).maybeSingle(),
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
        supabase
          .from("report_templates")
          .select("id, slug, name")
          .eq("status", "active")
          .order("name", { ascending: true }),
        supabase
          .from("report_runs")
          .select("template_id, started_at")
          .eq("organization_id", ctx.ctx.organizationId)
          .eq("generated_by_user_id", uId)
          .not("template_id", "is", null)
          .order("started_at", { ascending: false })
          .limit(2000),
        supabase
          .from("report_schedules")
          .select("source_type, source_id, status")
          .eq("organization_id", ctx.ctx.organizationId)
          .is("deleted_at", null),
      ]);

      const settings = profileRes.data?.settings ?? null;

      const firstErr = [
        profileRes.error,
        templatesRes.error,
        savedRes.error,
        schedulesRes.error,
        packsRes.error,
        runsTotalRes.error,
        recentRes.error,
        catalogRes.error,
        userRunsRes.error,
        scheduleListRes.error,
      ].find(Boolean);

      if (firstErr) throw new Error(firstErr.message);

      setCurrentSettings(settings);
      setReportingHubOnboardingDismissed(!!parseReportingHubOnboardingDismissedAt(settings));
      setPreferencesReady(true);

      setCounts({
        templates: templatesRes.count ?? 0,
        saved: savedRes.count ?? 0,
        schedules: schedulesRes.count ?? 0,
        packs: packsRes.count ?? 0,
        history: runsTotalRes.count ?? 0,
      });
      setRecentRuns((recentRes.data ?? []) as RecentRun[]);

      const cat = (catalogRes.data ?? []) as TemplateCatalogRow[];

      const tplById = new Map(cat.map((t) => [t.id, t]));
      const aggregates = new Map<string, { runCount: number; lastRunAt: string | null }>();
      const userRunRows = (userRunsRes.data ?? []) as { template_id: string; started_at: string }[];

      for (const row of userRunRows) {
        const tid = row.template_id;
        if (!tplById.has(tid)) continue;
        const prev = aggregates.get(tid);
        const nextCount = (prev?.runCount ?? 0) + 1;
        const lastRunAt = prev?.lastRunAt ?? row.started_at;
        aggregates.set(tid, { runCount: nextCount, lastRunAt });
      }

      const scheduleRows =
        (scheduleListRes.data ?? []) as {
          source_type: string;
          source_id: string;
          status: string;
        }[];

      function deriveScheduleLabel(t: TemplateCatalogRow): string {
        const relevant = scheduleRows.filter((s) => s.source_type === "template" && scheduleMatchesTemplate(s.source_id, t));
        if (!relevant.length) return "Not scheduled";
        if (relevant.some((s) => s.status === "active")) return "Scheduled";
        if (relevant.some((s) => s.status === "paused")) return "Paused";
        return "Not scheduled";
      }

      let rows: HubRow[] = [...aggregates.entries()]
        .map(([tid, agg]) => {
          const tpl = tplById.get(tid);
          if (!tpl) return null;
          return {
            templateId: tpl.id,
            slug: tpl.slug,
            name: tpl.name,
            runCount: agg.runCount,
            lastRunAt: agg.lastRunAt,
            scheduleLabel: deriveScheduleLabel(tpl),
          } satisfies HubRow;
        })
        .filter((r): r is HubRow => r !== null);

      rows.sort((a, b) => b.runCount - a.runCount || a.name.localeCompare(b.name));

      let fallback = false;
      if (!rows.length) {
        fallback = true;
        rows = cat.slice(0, 8).map((tpl) => ({
          templateId: tpl.id,
          slug: tpl.slug,
          name: tpl.name,
          runCount: 0,
          lastRunAt: null,
          scheduleLabel: deriveScheduleLabel(tpl),
        }));
      }
      setPinnedRows(rows);
      setHubRowsFallback(fallback);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load reporting overview.");
      setPreferencesReady(true);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const onboardingVisible = useMemo(
    () => preferencesReady && !reportingHubOnboardingDismissed,
    [preferencesReady, reportingHubOnboardingDismissed],
  );

  const dismissOnboarding = useCallback(async () => {
    if (!userId) return;
    setDismissBusy(true);
    try {
      const iso = new Date().toISOString();
      const nextSettings = mergeReportingHubOnboardingDismissed(currentSettings, iso);
      const { error: upErr } = await supabase
        .from("user_profiles")
        .update({ settings: nextSettings })
        .eq("id", userId);
      if (upErr) throw new Error(upErr.message);
      setCurrentSettings(nextSettings);
      setReportingHubOnboardingDismissed(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not dismiss onboarding.");
    } finally {
      setDismissBusy(false);
    }
  }, [supabase, userId, currentSettings]);

  const statusItems = useMemo(
    () => [
      { href: "/admin/reports/templates", label: "Templates", value: counts?.templates ?? 0 },
      { href: "/admin/reports/saved", label: "Saved", value: counts?.saved ?? 0 },
      { href: "/admin/reports/scheduled", label: "Schedules", value: counts?.schedules ?? 0 },
      { href: "/admin/reports/packs", label: "Packs", value: counts?.packs ?? 0 },
      { href: "/admin/reports/history", label: "History", value: counts?.history ?? 0 },
    ],
    [counts],
  );

  const lastRunLabel = (iso: string | null) => (iso ? formatRunTime(iso) : "Never");

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full pb-16">
      <div className="relative z-10 mx-auto max-w-7xl space-y-6 px-4 sm:px-6 xl:px-0">
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <ReportsHubNav />
        </div>

        <nav aria-label="Breadcrumb" className="text-[13px]">
          <Link href={homeHref} className="text-muted-foreground hover:text-foreground">
            Dashboard
          </Link>
          <span className="mx-2 text-muted-foreground" aria-hidden>
            /
          </span>
          <span className="text-foreground font-medium">Reporting Hub</span>
        </nav>

        <header className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Reporting Hub</h1>
            <p className="max-w-xl text-sm text-muted-foreground">
              Run portfolio analytics, package leadership briefings, and prove what was generated.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <Link
              href="/admin/reports/templates"
              className={cn(buttonVariants({ variant: "default", size: "default" }), "gap-2 rounded-md")}
            >
              Run a report
              <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link href="/admin/reports/nlq" className={cn(buttonVariants({ variant: "outline", size: "default" }), "rounded-md")}>
              Ask Haven Insight
            </Link>
          </div>
        </header>

        <SourceReadinessCallout copy={REPORTING_SOURCE_READINESS} />

        {onboardingVisible ? (
          <section
            className="relative rounded-lg border border-border bg-muted/50 px-4 py-4 sm:px-5"
            aria-label="Reporting onboarding"
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={dismissBusy}
              onClick={() => void dismissOnboarding()}
              className="absolute right-2 top-2 h-8 w-8 rounded-md text-muted-foreground hover:text-foreground"
              aria-label="Dismiss reporting onboarding"
            >
              <X className="size-4" />
            </Button>
            <p className="pr-10 text-sm font-medium text-foreground">How reporting works</p>
            <ol className="mt-3 flex flex-wrap items-start gap-x-2 gap-y-2 text-[13px] leading-snug text-muted-foreground">
              {ONBOARD_STEPS.map((step, i) => (
                <li key={step.n} className="flex min-w-0 flex-wrap items-center gap-x-2">
                  <span className="tabular-nums text-foreground">{step.n}.</span>
                  <span>
                    <span className="font-medium text-foreground">{step.title}</span>
                    <span className="hidden sm:inline"> — {step.body}</span>
                  </span>
                  {i < ONBOARD_STEPS.length - 1 ? (
                    <span className="hidden h-px w-8 bg-border sm:block" aria-hidden />
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {/* Status strip */}
        <section
          className={cn(
            "flex flex-wrap gap-y-4 rounded-lg border border-border bg-card px-8 py-6",
            loading && "animate-pulse",
          )}
          aria-label="Reporting catalog status"
        >
          {statusItems.map((item, idx) => (
            <div key={item.href} className="flex flex-1 items-center gap-6 min-[520px]:min-w-[100px]">
              <Link
                href={item.href}
                className="flex min-h-[52px] min-w-[72px] flex-col justify-center gap-0.5 rounded-md px-1 py-1 transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="text-[28px] font-semibold tabular-nums leading-none tracking-tight text-foreground">
                  {loading ? "—" : item.value.toLocaleString()}
                </span>
                <span className="text-[13px] text-muted-foreground">{item.label}</span>
              </Link>
              {idx < statusItems.length - 1 ? (
                <div className="hidden h-10 w-px shrink-0 bg-border min-[520px]:block" aria-hidden />
              ) : null}
            </div>
          ))}
        </section>

        <div className="grid gap-8 lg:grid-cols-12">
          {/* Pinned templates */}
          <section className="lg:col-span-8" aria-labelledby="pinned-templates-heading">
            <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 id="pinned-templates-heading" className="text-[15px] font-semibold text-foreground">
                  {hubRowsFallback ? "Suggested starters" : "Pinned for you"}
                </h2>
                {!hubRowsFallback ? (
                  <p className="text-sm text-muted-foreground">
                    Templates you run most often, based on history tied to your account.
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">Pick a starter template below to build your habit.</p>
                )}
              </div>
              <Link
                href="/admin/reports/templates"
                className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                Open template library
              </Link>
            </div>

            <div className="overflow-hidden rounded-lg border border-border bg-card">
              <div className="grid grid-cols-[minmax(0,2fr)_100px_100px_auto] gap-3 border-b border-border bg-card/60 px-[13px] py-2 max-lg:hidden lg:items-center">
                <span className="text-[13px] font-medium text-muted-foreground">Template</span>
                <span className="text-[13px] font-medium text-muted-foreground">Last run</span>
                <span className="text-[13px] font-medium text-muted-foreground">Schedule</span>
                <span className="justify-self-end text-[13px] font-medium text-muted-foreground">
                  Actions
                </span>
              </div>
              {loading ? (
                <div className="px-[13px] py-10 text-left text-sm text-muted-foreground">Loading…</div>
              ) : pinnedRows.length === 0 ? (
                <div className="px-[13px] py-10 text-left text-sm text-muted-foreground">
                  No templates in catalog yet. Seed reporting templates first.
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {pinnedRows.map((row) => {
                    const runHint =
                      !hubRowsFallback && row.runCount > 0
                        ? ` · ${row.runCount.toLocaleString()} ${row.runCount === 1 ? "run" : "runs"}`
                        : "";
                    return (
                      <li key={row.templateId}>
                        <div className="grid grid-cols-1 gap-3 px-[13px] py-3 sm:grid-cols-[minmax(0,1fr)_minmax(92px,_auto)_minmax(88px,_auto)_auto] sm:items-center sm:gap-3">
                          <span className="flex min-w-0 items-center gap-1 truncate text-[13px] leading-none">
                            <span className="min-w-0 truncate font-medium text-foreground">{row.name}</span>
                            {runHint ? (
                              <span className="shrink-0 font-normal tabular-nums text-muted-foreground">{runHint}</span>
                            ) : null}
                          </span>
                          <span className="shrink-0 tabular-nums text-[13px] text-muted-foreground">
                            {lastRunLabel(row.lastRunAt)}
                          </span>
                          <span className="shrink-0 text-[13px] text-muted-foreground">{row.scheduleLabel}</span>
                          <div className="flex shrink-0 justify-start gap-2 sm:justify-end">
                            <Link
                              href={`/admin/reports/run/template/${encodeURIComponent(row.slug)}`}
                              className={cn(buttonVariants({ variant: "default", size: "sm" }), "rounded-md")}
                            >
                              Run
                            </Link>
                            <Link
                              href={`/admin/reports/scheduled?fromTemplate=${encodeURIComponent(row.slug)}`}
                              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "rounded-md")}
                            >
                              Schedule
                            </Link>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

          {/* Recent activity */}
          <section className="lg:col-span-4" aria-labelledby="recent-activity-heading">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <h2 id="recent-activity-heading" className="text-[15px] font-semibold text-foreground">
                Recent activity
              </h2>
              <Link href="/admin/reports/history" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "ml-auto gap-1")}>
                <History className="size-3.5" aria-hidden />
                Full history
              </Link>
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading runs…</p>
              ) : recentRuns.length === 0 ? (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] leading-snug text-muted-foreground">
                  <span className="w-full shrink-0 text-foreground font-medium">Nothing run yet.</span>
                  <span className="w-full">Reports will appear here after the first execution.</span>
                  <Link
                    href="/admin/reports/templates"
                    className={cn(
                      buttonVariants({ variant: "ghost", size: "sm", className: "h-8 px-2 -mx-2" }),
                      "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    Open templates
                  </Link>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex gap-3 text-[13px] font-medium text-muted-foreground">
                    <span className="min-w-0 flex-1">Run</span>
                    <span className="w-[72px] shrink-0">Status</span>
                    <span className="w-[102px] shrink-0 text-right">Started</span>
                  </div>
                  <ul className="space-y-1">
                    {recentRuns.map((run) => {
                      const detailHref = `/admin/reports/run/${encodeURIComponent(run.source_type)}/${encodeURIComponent(run.source_id)}`;
                      const statusOk = run.status === "completed";
                      const statusFail = run.status === "failed";
                      const label =
                        run.source_type === "template"
                          ? "Template run"
                          : run.source_type === "saved_view"
                            ? "Saved view"
                            : run.source_type === "pack"
                              ? "Pack"
                              : run.source_type;
                      return (
                        <li key={run.id}>
                          <Link
                            href={detailHref}
                            className="flex flex-wrap gap-x-3 gap-y-1 rounded-md px-2 py-2 text-[13px] leading-tight hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <span className="min-w-0 flex-1 text-foreground">
                              {label}
                              <span className="sr-only">{`, started ${formatRunTime(run.started_at)}`}</span>
                            </span>
                            <span className="w-[72px] shrink-0">
                              {statusOk ? (
                                <StatusPill tone="muted">Done</StatusPill>
                              ) : statusFail ? (
                                <StatusPill tone="danger">Failed</StatusPill>
                              ) : (
                                <StatusPill tone="warning">{run.status}</StatusPill>
                              )}
                            </span>
                            <span className="w-[102px] shrink-0 tabular-nums text-right text-[12px] text-muted-foreground">
                              {formatRunTime(run.started_at)}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
