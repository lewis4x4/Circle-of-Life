"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ClipboardList } from "lucide-react";

import { AdminEmptyState, AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const STATUS_RANK: Record<string, number> = {
  active: 0,
  under_review: 1,
  draft: 2,
  archived: 3,
};

type QueryError = { message: string };
type QueryResult<T> = { data: T | null; error: QueryError | null };
type QueryListResult<T> = { data: T[] | null; error: QueryError | null };

type ResidentMini = {
  id: string;
  facility_id: string;
  first_name: string | null;
  last_name: string | null;
};

type CarePlanRow = {
  id: string;
  version: number | null;
  status: string | null;
  effective_date: string | null;
  review_due_date: string | null;
  notes: string | null;
  updated_at: string | null;
};

type CarePlanItemRow = {
  id: string;
  category: string | null;
  title: string | null;
  description: string | null;
  assistance_level: string | null;
  frequency: string | null;
  special_instructions: string | null;
  goal: string | null;
  interventions: string[] | null;
  sort_order: number | null;
};

type LoadedState = {
  residentName: string;
  plan: CarePlanRow | null;
  items: CarePlanItemRow[];
};

export default function AdminResidentCarePlanPage() {
  const params = useParams();
  const rawId = params?.id;
  const residentId = typeof rawId === "string" ? rawId : Array.isArray(rawId) ? rawId[0] : "";
  const { selectedFacilityId } = useFacilityStore();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [noPlan, setNoPlan] = useState(false);
  const [loaded, setLoaded] = useState<LoadedState | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    setNoPlan(false);
    setLoaded(null);

    if (!residentId || !UUID_RE.test(residentId)) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    try {
      const supabase = createClient();

      const resResult = (await supabase
        .from("residents" as never)
        .select("id, facility_id, first_name, last_name")
        .eq("id", residentId)
        .is("deleted_at", null)
        .maybeSingle()) as unknown as QueryResult<ResidentMini>;

      if (resResult.error) throw resResult.error;
      const resident = resResult.data;
      if (!resident) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      if (isValidFacilityIdForQuery(selectedFacilityId) && resident.facility_id !== selectedFacilityId) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      const firstName = resident.first_name ?? "";
      const lastName = resident.last_name ?? "";
      const residentName = `${firstName} ${lastName}`.trim() || "Unknown Resident";

      const plansResult = (await supabase
        .from("care_plans" as never)
        .select("id, version, status, effective_date, review_due_date, notes, updated_at")
        .eq("resident_id", residentId)
        .is("deleted_at", null)) as unknown as QueryListResult<CarePlanRow>;

      if (plansResult.error) throw plansResult.error;
      const plans = plansResult.data ?? [];
      const plan = pickCarePlan(plans);

      if (!plan) {
        setNoPlan(true);
        setLoaded({ residentName, plan: null, items: [] });
        setLoading(false);
        return;
      }

      const itemsResult = (await supabase
        .from("care_plan_items" as never)
        .select(
          "id, category, title, description, assistance_level, frequency, special_instructions, goal, interventions, sort_order",
        )
        .eq("care_plan_id", plan.id)
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("sort_order", { ascending: true })) as unknown as QueryListResult<CarePlanItemRow>;

      if (itemsResult.error) throw itemsResult.error;
      const items = itemsResult.data ?? [];

      setLoaded({ residentName, plan, items });
    } catch {
      setError("Care plan data is unavailable. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [residentId, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const groupedItems = useMemo(() => groupByCategory(loaded?.items ?? []), [loaded?.items]);

  if (loading) {
    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        <Link
          href={`/admin/residents/${residentId}`}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}
        >
          <ArrowLeft className="h-4 w-4" />
          Resident profile
        </Link>
        <AdminTableLoadingState />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        <Link
          href="/admin/residents"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to census
        </Link>
        <Card className="border-slate-200/70 dark:border-slate-800">
          <CardHeader>
            <CardTitle className="font-display text-xl">Resident not found</CardTitle>
            <CardDescription>
              This care plan route is tied to a resident record. Adjust your facility filter or return to
              the census list.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        <Link
          href={`/admin/residents/${residentId}`}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}
        >
          <ArrowLeft className="h-4 w-4" />
          Resident profile
        </Link>
        <Card className="border-amber-200/80 bg-amber-50/40 dark:border-amber-900/60 dark:bg-amber-950/20">
          <CardContent className="py-4 text-sm text-amber-800 dark:text-amber-200">{error}</CardContent>
        </Card>
      </div>
    );
  }

  if (!loaded) {
    return null;
  }

  const { residentName, plan, items } = loaded;
  const reviewState = plan?.review_due_date ? getReviewBadgeState(plan.review_due_date) : null;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-3">
          <Link
            href={`/admin/residents/${residentId}`}
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex w-fit gap-1 px-0 sm:px-3")}
          >
            <ArrowLeft className="h-4 w-4" />
            {residentName}
          </Link>
          <div className="flex flex-wrap items-start gap-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-900/50">
              <ClipboardList className="h-6 w-6 text-brand-600" />
            </div>
            <div>
              <h1 className="font-display text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                Care plan
              </h1>
              <p className="mt-1 text-slate-500 dark:text-slate-400">
                Structured needs and interventions for {residentName}.
              </p>
            </div>
          </div>
        </div>
      </div>

      {noPlan || !plan?.id ? (
        <AdminEmptyState
          title="No care plan on file"
          description="When a plan is created in the clinical workflow, version, review dates, and line items will appear here."
        />
      ) : (
        <>
          <Card className="border-slate-200/70 shadow-soft dark:border-slate-800">
            <CardHeader className="border-b border-slate-100 dark:border-slate-800">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="font-display text-lg">Plan summary</CardTitle>
                {plan?.status ? <CarePlanStatusBadge status={plan.status} /> : null}
                {plan && plan.version != null ? (
                  <Badge variant="outline" className="border-slate-300 dark:border-slate-600">
                    v{plan.version}
                  </Badge>
                ) : null}
                {reviewState ? (
                  <Badge variant="outline" className={reviewState.className}>
                    Review: {reviewState.label}
                  </Badge>
                ) : null}
              </div>
              <CardDescription>Effective dates and documentation notes</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 pt-6 text-sm sm:grid-cols-2">
              <DetailRow label="Effective" value={formatDate(plan?.effective_date ?? null)} />
              <DetailRow label="Review due" value={formatDate(plan?.review_due_date ?? null)} />
              {plan?.notes ? (
                <div className="sm:col-span-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Notes</p>
                  <p className="mt-1 text-slate-700 dark:text-slate-300">{plan.notes}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {items.length === 0 ? (
            <AdminEmptyState
              title="No active line items"
              description="Care plan items will list ADLs, safety measures, and other ordered interventions when they are added to this plan."
            />
          ) : (
            <div className="space-y-6">
              {Array.from(groupedItems.entries()).map(([category, rows]) => (
                <Card key={category} className="border-slate-200/70 shadow-soft dark:border-slate-800">
                  <CardHeader className="border-b border-slate-100 dark:border-slate-800">
                    <CardTitle className="font-display text-base">{formatCategoryLabel(category)}</CardTitle>
                    <CardDescription>{rows.length} item{rows.length === 1 ? "" : "s"}</CardDescription>
                  </CardHeader>
                  <CardContent className="divide-y divide-slate-100 p-0 dark:divide-slate-800">
                    {rows.map((row) => (
                      <div key={row.id} className="space-y-2 px-6 py-4">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <h3 className="font-medium text-slate-900 dark:text-slate-100">{row.title ?? "—"}</h3>
                          {row.assistance_level ? (
                            <Badge variant="secondary" className="font-normal">
                              {formatSnakeLabel(row.assistance_level)}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="text-sm text-slate-600 dark:text-slate-400">{row.description ?? "—"}</p>
                        {row.frequency ? (
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            <span className="font-medium text-slate-600 dark:text-slate-300">Frequency:</span>{" "}
                            {row.frequency}
                          </p>
                        ) : null}
                        {row.goal ? (
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            <span className="font-medium text-slate-600 dark:text-slate-300">Goal:</span> {row.goal}
                          </p>
                        ) : null}
                        {row.interventions?.length ? (
                          <ul className="list-inside list-disc text-xs text-slate-600 dark:text-slate-400">
                            {row.interventions.filter(Boolean).map((iv) => (
                              <li key={iv}>{iv}</li>
                            ))}
                          </ul>
                        ) : null}
                        {row.special_instructions ? (
                          <p className="rounded-md border border-amber-200/80 bg-amber-50/50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                            <span className="font-semibold">Instructions:</span> {row.special_instructions}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function pickCarePlan(plans: CarePlanRow[]): CarePlanRow | null {
  if (plans.length === 0) return null;
  return [...plans].sort((a, b) => {
    const ra = STATUS_RANK[a.status ?? ""] ?? 99;
    const rb = STATUS_RANK[b.status ?? ""] ?? 99;
    if (ra !== rb) return ra - rb;
    const ta = a.updated_at ? new Date(a.updated_at).getTime() : 0;
    const tb = b.updated_at ? new Date(b.updated_at).getTime() : 0;
    return tb - ta;
  })[0];
}

function groupByCategory(items: CarePlanItemRow[]): Map<string, CarePlanItemRow[]> {
  const map = new Map<string, CarePlanItemRow[]>();
  for (const item of items) {
    const key = item.category ?? "other";
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  return new Map([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(parsed);
}

function formatSnakeLabel(value: string): string {
  return value.replace(/_/g, " ");
}

function formatCategoryLabel(category: string): string {
  return formatSnakeLabel(category)
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function getReviewBadgeState(isoDate: string): { label: string; className: string } {
  const due = new Date(`${isoDate}T23:59:59Z`);
  const now = new Date();
  if (Number.isNaN(due.getTime())) {
    return { label: formatDate(isoDate), className: "border-slate-300 dark:border-slate-600" };
  }
  if (due < now) {
    return {
      label: `${formatDate(isoDate)} (overdue)`,
      className: "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200",
    };
  }
  const days = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 14) {
    return {
      label: `${formatDate(isoDate)} (${days}d)`,
      className: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200",
    };
  }
  return {
    label: formatDate(isoDate),
    className: "border-slate-300 dark:border-slate-600",
  };
}

function CarePlanStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200",
    draft: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
    under_review: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200",
    archived: "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  };
  return <Badge className={map[status] ?? "bg-slate-100 text-slate-700"}>{formatSnakeLabel(status)}</Badge>;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
      <span className="min-w-[8rem] text-xs font-medium uppercase tracking-wide text-slate-400">{label}</span>
      <span className="text-slate-800 dark:text-slate-200">{value}</span>
    </div>
  );
}
