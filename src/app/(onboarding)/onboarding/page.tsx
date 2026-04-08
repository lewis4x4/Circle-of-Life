"use client";

import { useMemo } from "react";
import { AlertTriangle, ArrowRight, CircleCheckBig, FileText, LayoutGrid } from "lucide-react";
import Link from "next/link";

import { ExportMarkdownButton } from "@/components/onboarding/export-markdown-button";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useOnboardingStore } from "@/hooks/useOnboardingStore";
import { cn } from "@/lib/utils";

const DEPARTMENT_SUMMARY = [
  { name: "Executive / Ownership", completion: "40%", status: "In progress", blockers: 1 },
  { name: "Operations", completion: "25%", status: "Waiting on client", blockers: 2 },
  { name: "Finance", completion: "10%", status: "Not started", blockers: 0 },
  { name: "Clinical / Resident Care", completion: "15%", status: "In progress", blockers: 1 },
] as const;

export default function OnboardingDashboardPage() {
  const questionsById = useOnboardingStore((s) => s.questionsById);
  const responsesByQuestionId = useOnboardingStore((s) => s.responsesByQuestionId);

  const { completionPct, readinessLabel, lastUpdatedLabel } = useMemo(() => {
    const questions = Object.values(questionsById);
    const required = questions.filter((q) => q.required !== false);
    const answered = required.filter((q) => {
      const v = responsesByQuestionId[q.id]?.value?.trim() ?? "";
      return v.length > 0;
    }).length;
    const pct = required.length === 0 ? 0 : Math.round((answered / required.length) * 100);
    const times = Object.values(responsesByQuestionId)
      .map((r) => r.updatedAt)
      .filter(Boolean)
      .sort();
    const last = times[times.length - 1];
    const lastUpdatedLabel = last
      ? new Date(last).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
      : "No answers yet";
    const readinessLabel = pct >= 100 ? "Required complete" : "In progress";
    return { completionPct: pct, readinessLabel, lastUpdatedLabel };
  }, [questionsById, responsesByQuestionId]);

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
              <ExportMarkdownButton variant="outline" className="shrink-0" />
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-300">
            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2">
              <span>Required questions answered</span>
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

        <MetricCard label="Unresolved blockers" value="4" icon={AlertTriangle} accent="text-rose-300" />
        <MetricCard label="Pending documents" value="12" icon={FileText} accent="text-amber-200" />
        <MetricCard label="Decisions confirmed" value="3" icon={CircleCheckBig} accent="text-teal-200" />
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <Card className="border-white/10 bg-white/[0.03]">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-white">Departments</CardTitle>
              <CardDescription className="text-slate-400">
                Completion and blocker visibility by operating lane.
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
          <CardContent className="space-y-3">
            {DEPARTMENT_SUMMARY.map((department) => (
              <div
                key={department.name}
                className="grid gap-2 rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm md:grid-cols-[minmax(0,1fr)_auto_auto_auto]"
              >
                <p className="font-medium text-slate-100">{department.name}</p>
                <p className="text-slate-400">Completion: {department.completion}</p>
                <p className="text-slate-400">Status: {department.status}</p>
                <p className="text-slate-400">Blockers: {department.blockers}</p>
              </div>
            ))}
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
