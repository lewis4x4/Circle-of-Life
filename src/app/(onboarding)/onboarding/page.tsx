"use client";

import { useMemo } from "react";
import { AlertTriangle, ArrowRight, CircleCheckBig, FileText, LayoutGrid, Loader2 } from "lucide-react";
import Link from "next/link";

import { ExportMarkdownButton } from "@/components/onboarding/export-markdown-button";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useOnboardingStore } from "@/hooks/useOnboardingStore";
import type { OnboardingQuestion, OnboardingResponse } from "@/lib/onboarding/types";
import { cn } from "@/lib/utils";

function questionTier(q: Pick<OnboardingQuestion, "tier">): "core" | "extended" {
  return q.tier === "extended" ? "extended" : "core";
}

function buildDepartmentRows(
  questions: OnboardingQuestion[],
  responsesByQuestionId: Record<string, OnboardingResponse>,
) {
  const deptMap = new Map<string, { total: number; answered: number }>();
  for (const q of questions) {
    const dep = q.department;
    if (!deptMap.has(dep)) deptMap.set(dep, { total: 0, answered: 0 });
    const row = deptMap.get(dep)!;
    row.total += 1;
    if (responsesByQuestionId[q.id]?.value?.trim()) row.answered += 1;
  }
  return Array.from(deptMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, { total, answered }]) => {
      const pctDept = total === 0 ? 0 : Math.round((answered / total) * 100);
      let status: string;
      if (answered === 0) status = "Not started";
      else if (answered === total) status = "Complete";
      else status = "In progress";
      return { name, total, answered, pctDept, status };
    });
}

export default function OnboardingDashboardPage() {
  const hydration = useOnboardingStore((s) => s.hydration);
  const loadError = useOnboardingStore((s) => s.loadError);
  const isOrgAdmin = useOnboardingStore((s) => s.isOrgAdmin);
  const questionsById = useOnboardingStore((s) => s.questionsById);
  const responsesByQuestionId = useOnboardingStore((s) => s.responsesByQuestionId);

  const {
    completionPct,
    completionPctCore,
    completionPctExtended,
    readinessLabel,
    lastUpdatedLabel,
    answeredCount,
    totalQuestions,
    coreAnswered,
    coreTotal,
    extendedAnswered,
    extendedTotal,
    uniqueDepartments,
    departmentRowsCore,
    departmentRowsExtended,
  } = useMemo(() => {
    const questions = Object.values(questionsById) as OnboardingQuestion[];
    const coreQs = questions.filter((q) => questionTier(q) === "core");
    const extQs = questions.filter((q) => questionTier(q) === "extended");

    const answeredFor = (qs: OnboardingQuestion[]) =>
      qs.filter((q) => {
        const v = responsesByQuestionId[q.id]?.value?.trim() ?? "";
        return v.length > 0;
      }).length;

    const totalQuestions = questions.length;
    const answeredCount = answeredFor(questions);
    const coreAnswered = answeredFor(coreQs);
    const coreTotal = coreQs.length;
    const extendedAnswered = answeredFor(extQs);
    const extendedTotal = extQs.length;

    const pct = totalQuestions === 0 ? 0 : Math.round((answeredCount / totalQuestions) * 100);
    const completionPctCore = coreTotal === 0 ? 0 : Math.round((coreAnswered / coreTotal) * 100);
    const completionPctExtended = extendedTotal === 0 ? 0 : Math.round((extendedAnswered / extendedTotal) * 100);

    const times = Object.values(responsesByQuestionId)
      .map((r) => r.updatedAt)
      .filter(Boolean)
      .sort();
    const last = times[times.length - 1];
    const lastUpdatedLabel = last
      ? new Date(last).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
      : "No answers yet";

    const readinessLabel =
      coreTotal === 0
        ? "No Core library"
        : coreAnswered >= coreTotal
          ? "Core complete"
          : "Core in progress";

    const uniqueDepartments = new Set(questions.map((q) => q.department)).size;

    const departmentRowsCore = buildDepartmentRows(coreQs, responsesByQuestionId);
    const departmentRowsExtended = buildDepartmentRows(extQs, responsesByQuestionId);

    return {
      completionPct: pct,
      completionPctCore,
      completionPctExtended,
      readinessLabel,
      lastUpdatedLabel,
      answeredCount,
      totalQuestions,
      coreAnswered,
      coreTotal,
      extendedAnswered,
      extendedTotal,
      uniqueDepartments,
      departmentRowsCore,
      departmentRowsExtended,
    };
  }, [questionsById, responsesByQuestionId]);

  if (hydration === "loading" || hydration === "idle") {
    return (
      <div className="flex items-center gap-2 text-slate-300">
        <Loader2 className="h-5 w-5 animate-spin text-teal-400" aria-hidden />
        <span>Loading overview…</span>
      </div>
    );
  }

  if (hydration === "error") {
    return (
      <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100" role="alert">
        {loadError ?? "Could not load onboarding data."}
      </div>
    );
  }

  const remaining = Math.max(0, totalQuestions - answeredCount);

  return (
    <div className="space-y-6 pb-8">
      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card className="border-white/10 bg-white/[0.03] lg:col-span-2">
          <CardHeader className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="text-xl text-white">Activation Overview</CardTitle>
                <CardDescription className="text-slate-400">
                  Guided onboarding record for pilot scope, decisions, and build readiness.
                </CardDescription>
              </div>
              {isOrgAdmin ? <ExportMarkdownButton variant="outline" className="shrink-0" /> : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-300">
            <div className="space-y-2 rounded-lg border border-teal-500/30 bg-teal-500/5 px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="font-medium text-teal-100">Core (pilot readiness)</span>
                <Badge className="border-0 bg-teal-500/25 text-teal-50">
                  {coreAnswered} / {coreTotal}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Progress</span>
                <span className="text-teal-200/90">{completionPctCore}%</span>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2">
              <span>Extended discovery</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">{completionPctExtended}%</span>
                <Badge className="border-0 bg-slate-500/20 text-slate-200">
                  {extendedAnswered} / {extendedTotal}
                </Badge>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2">
              <span>All questions answered</span>
              <Badge className="border-0 bg-teal-500/20 text-teal-100">
                {answeredCount} / {totalQuestions}
              </Badge>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2">
              <span>Overall progress</span>
              <Badge className="border-0 bg-teal-500/20 text-teal-100">{completionPct}%</Badge>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2">
              <span>Readiness status</span>
              <Badge className="border-0 bg-amber-500/20 text-amber-100">{readinessLabel}</Badge>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2">
              <span>Last answer update</span>
              <span className="text-right text-slate-400">{lastUpdatedLabel}</span>
            </div>
          </CardContent>
        </Card>

        <MetricCard
          label="Unanswered questions"
          value={String(remaining)}
          icon={AlertTriangle}
          accent="text-rose-300"
        />
        <MetricCard
          label="Question library"
          value={String(totalQuestions)}
          icon={FileText}
          accent="text-amber-200"
        />
        <MetricCard
          label="Leadership lanes"
          value={String(uniqueDepartments)}
          icon={CircleCheckBig}
          accent="text-teal-200"
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <Card className="border-white/10 bg-white/[0.03]">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-white">Departments</CardTitle>
              <CardDescription className="text-slate-400">
                Completion by department, split by Core (readiness) vs Extended discovery.
              </CardDescription>
            </div>
            <Link
              href="/onboarding/departments"
              className={cn(
                buttonVariants({ variant: "outline" }),
                "border-white/20 bg-transparent text-slate-100 hover:bg-white/10",
              )}
            >
              Open lanes
              <ArrowRight className="ml-1.5 h-4 w-4" />
            </Link>
          </CardHeader>
          <CardContent className="space-y-6">
            {totalQuestions === 0 ? (
              <p className="text-sm text-slate-500">No questions loaded yet.</p>
            ) : (
              <>
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-teal-200/90">Core lanes</p>
                  {departmentRowsCore.length === 0 ? (
                    <p className="text-sm text-slate-500">No Core questions in library.</p>
                  ) : (
                    departmentRowsCore.map((department) => (
                      <div
                        key={`core-${department.name}`}
                        className="grid gap-2 rounded-xl border border-teal-500/15 bg-black/20 px-4 py-3 text-sm md:grid-cols-[minmax(0,1fr)_auto_auto_auto]"
                      >
                        <p className="font-medium text-slate-100">{department.name}</p>
                        <p className="text-slate-400">
                          Answered: {department.answered}/{department.total}
                        </p>
                        <p className="text-slate-400">Progress: {department.pctDept}%</p>
                        <p className="text-slate-400">Status: {department.status}</p>
                      </div>
                    ))
                  )}
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Extended lanes</p>
                  {departmentRowsExtended.length === 0 ? (
                    <p className="text-sm text-slate-500">No Extended questions in library.</p>
                  ) : (
                    departmentRowsExtended.map((department) => (
                      <div
                        key={`ext-${department.name}`}
                        className="grid gap-2 rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm md:grid-cols-[minmax(0,1fr)_auto_auto_auto]"
                      >
                        <p className="font-medium text-slate-100">{department.name}</p>
                        <p className="text-slate-400">
                          Answered: {department.answered}/{department.total}
                        </p>
                        <p className="text-slate-400">Progress: {department.pctDept}%</p>
                        <p className="text-slate-400">Status: {department.status}</p>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-white/[0.03]">
          <CardHeader>
            <CardTitle className="text-white">Next best action</CardTitle>
            <CardDescription className="text-slate-400">
              Complete first-run sequence items before opening secondary lanes.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-300">
            <ActionItem label="Leadership / Governance / Decision Rights" state="in_progress" />
            <ActionItem label="Pilot Scope / Success Definition" state="queued" />
            <ActionItem label="Current Systems / Shadow Systems" state="queued" />
            <ActionItem label="Cannot-Fail Workflows" state="queued" />
            <Link
              href="/onboarding/questions"
              className={cn(
                buttonVariants(),
                "mt-2 flex w-full items-center justify-center bg-teal-500 text-slate-950 hover:bg-teal-400",
              )}
            >
              Continue onboarding
              <ArrowRight className="ml-1.5 h-4 w-4" />
            </Link>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  icon: typeof LayoutGrid;
  accent: string;
}) {
  return (
    <Card className="border-white/10 bg-white/[0.03]">
      <CardHeader className="space-y-1 pb-2">
        <CardDescription className="text-slate-400">{label}</CardDescription>
        <CardTitle className="text-3xl text-white">{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <Icon className={`h-5 w-5 ${accent}`} />
      </CardContent>
    </Card>
  );
}

function ActionItem({
  label,
  state,
}: {
  label: string;
  state: "in_progress" | "queued";
}) {
  const badgeClass =
    state === "in_progress" ? "bg-teal-500/20 text-teal-100" : "bg-slate-500/20 text-slate-300";
  const badgeLabel = state === "in_progress" ? "In progress" : "Queued";

  return (
    <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-slate-200">{label}</p>
        <Badge className={`border-0 ${badgeClass}`}>{badgeLabel}</Badge>
      </div>
    </div>
  );
}
