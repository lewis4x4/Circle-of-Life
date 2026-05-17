"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Brain, CalendarClock } from "lucide-react";

import {
  AdminEmptyState,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { buttonVariants, Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { UUID_STRING_RE, isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { SignaturePad } from "@/components/ui/signature-pad";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  RecordDetailHeader,
  RecordDetailSection,
} from "@/design-system/components/record-detail";

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
  const [signingOpen, setSigningOpen] = useState(false);
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    setNoPlan(false);
    setLoaded(null);

    if (!residentId || !UUID_STRING_RE.test(residentId)) {
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

  const handleApprove = async () => {
    if (!signatureData || !plan?.id) return;

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/care-plans/${plan.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature: signatureData }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to approve care plan");
      }

      await load();
      setSigningOpen(false);
      setSignatureData(null);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to approve care plan");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-in fade-in duration-[var(--motion-duration)]">
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
      <div className="space-y-6 animate-in fade-in duration-[var(--motion-duration)]">
        <Link
          href="/admin/residents"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to census
        </Link>
        <RecordDetailSection title="Resident not found">
          <p className="text-sm text-muted-foreground">
            This care plan route is tied to a resident record. Adjust your facility filter or return to the
            census list.
          </p>
        </RecordDetailSection>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6 animate-in fade-in duration-[var(--motion-duration)]">
        <Link
          href={`/admin/residents/${residentId}`}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}
        >
          <ArrowLeft className="h-4 w-4" />
          Resident profile
        </Link>
        <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} />
      </div>
    );
  }

  if (!loaded) {
    return null;
  }

  const { residentName, plan, items } = loaded;
  const reviewState = plan?.review_due_date ? getReviewBadgeState(plan.review_due_date) : null;

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6 animate-in fade-in duration-[var(--motion-duration)] ease-[var(--motion-ease)]">

        <RecordDetailHeader
          title="Care plan"
          subtitle={`Structured needs and interventions mapped to ADLs and behavioral goals${residentName ? ` · ${residentName}` : ""}`}
          backLink={{ label: "Back to profile", href: `/admin/residents/${residentId}` }}
        />

        {noPlan || !plan?.id ? (
          <AdminEmptyState
            title="No care plan on file"
            description="When a plan is created in the clinical workflow, version, review dates, and line items will appear here."
          />
        ) : (
          <div className="space-y-6">

            <RecordDetailSection
              title="Plan configuration"
              description="Operational metadata"
              action={
                <div className="flex flex-wrap items-center gap-2">
                  {plan?.status ? <CarePlanStatusBadge status={plan.status} /> : null}
                  {plan && plan.version != null && (
                    <Badge variant="outline" className="tabular-nums text-[10px] uppercase font-bold tracking-wider bg-muted border-border px-3">
                      v{plan.version}
                    </Badge>
                  )}
                  {reviewState ? (
                    <Badge variant="outline" className={cn("tabular-nums text-[10px] uppercase font-bold tracking-wider px-3 border", reviewState.className)}>
                      Review: {reviewState.label}
                    </Badge>
                  ) : null}
                  {plan?.status && (plan.status === "draft" || plan.status === "under_review") && (
                    <button
                      type="button"
                      onClick={() => setSigningOpen(true)}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-[8px] bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold uppercase tracking-wider transition-colors duration-[var(--motion-duration-micro)] shadow-[var(--shadow-card)]"
                    >
                      Review &amp; sign
                    </button>
                  )}
                </div>
              }
            >
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="bg-muted p-[14px] rounded-[8px] border border-border shadow-[var(--shadow-card)]">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-2 mb-2">
                    <CalendarClock className="w-3.5 h-3.5" /> Effective date
                  </p>
                  <p className="tabular-nums text-base font-medium text-foreground">
                    {formatDate(plan?.effective_date ?? null)}
                  </p>
                </div>
                <div className="bg-muted p-[14px] rounded-[8px] border border-border shadow-[var(--shadow-card)]">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-2 mb-2">
                    <CalendarClock className="w-3.5 h-3.5" /> Next review
                  </p>
                  <p className="tabular-nums text-base font-medium text-foreground">
                    {formatDate(plan?.review_due_date ?? null)}
                  </p>
                </div>
                {plan?.notes ? (
                  <div className="sm:col-span-2 lg:col-span-3 bg-muted p-[14px] rounded-[8px] border border-border shadow-[var(--shadow-card)]">
                    <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-2">Documentation notes</p>
                    <p className="text-sm font-medium text-foreground">{plan.notes}</p>
                  </div>
                ) : null}
              </div>
            </RecordDetailSection>

            {items.length === 0 ? (
              <AdminEmptyState
                title="No active interventions"
                description="Needs and interventions will list ADLs, safety measures, and other ordered protocols."
              />
            ) : (
              <div className="grid grid-cols-1 gap-6">
                {Array.from(groupedItems.entries()).map(([category, rows]) => (
                  <RecordDetailSection
                    key={category}
                    title={formatCategoryLabel(category)}
                    description={`${rows.length} configured rule${rows.length > 1 ? "s" : ""}`}
                  >
                    <MotionList className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {rows.map((row) => (
                        <MotionItem key={row.id}>
                          <div className="group flex flex-col h-full justify-between p-[14px] rounded-[8px] border border-border bg-card shadow-[var(--shadow-card)] transition-all duration-[var(--motion-duration)] outline-none relative overflow-hidden focus-within:ring-2 focus-within:ring-ring hover:border-primary/20 hover:-translate-y-0.5">
                            <div className="space-y-4 relative z-10">
                              <div className="flex items-start justify-between gap-3">
                                <h4 className="font-semibold text-foreground leading-tight pr-4">
                                  {row.title ?? "—"}
                                </h4>
                                {row.assistance_level ? (
                                  <Badge className="bg-muted text-muted-foreground border-border uppercase tracking-wider text-[9px] font-bold px-2.5 py-0.5 shadow-none whitespace-nowrap">
                                    {formatSnakeLabel(row.assistance_level)}
                                  </Badge>
                                ) : null}
                              </div>

                              <p className="text-sm font-medium text-muted-foreground">
                                {row.description ?? "—"}
                              </p>

                              {row.frequency && (
                                <div className="pt-2">
                                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground block mb-1">Frequency</span>
                                  <span className="tabular-nums text-sm bg-muted px-2 py-1 rounded inline-block text-foreground border border-border">
                                    {row.frequency}
                                  </span>
                                </div>
                              )}

                              {row.interventions?.length ? (
                                <div className="pt-2">
                                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground block mb-1">Prescribed interventions</span>
                                  <ul className="space-y-1.5 w-full">
                                    {row.interventions.filter(Boolean).map((iv) => (
                                      <li key={iv} className="text-sm text-foreground flex items-start">
                                        <span className="text-primary mr-2 mt-0.5">•</span>
                                        <span className="flex-1">{iv}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ) : null}

                              {row.goal && (
                                <div className="pt-2">
                                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground block mb-1">Outcome goal</span>
                                  <p className="text-sm text-primary font-medium">
                                    {row.goal}
                                  </p>
                                </div>
                              )}

                              {row.special_instructions && (
                                <div className="pt-4 mt-auto">
                                  <div className="rounded-[8px] border border-warning/30 bg-warning/10 p-[14px]">
                                    <span className="text-[11px] font-medium uppercase tracking-wider text-warning block mb-1.5 flex items-center gap-1.5">
                                      <Brain className="w-3.5 h-3.5" /> High-priority protocol
                                    </span>
                                    <p className="text-xs font-medium text-foreground">
                                      {row.special_instructions}
                                    </p>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </MotionItem>
                      ))}
                    </MotionList>
                  </RecordDetailSection>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Signing Dialog */}
      <Dialog open={signingOpen} onOpenChange={setSigningOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Approve care plan</DialogTitle>
            <DialogDescription>
              Sign to approve this care plan and mark it as active. This action will be logged.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {submitError && (
              <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-[8px] text-sm text-destructive">
                {submitError}
              </div>
            )}

            <div className="bg-muted rounded-[8px] p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Resident:</span>
                <span className="font-medium text-foreground">{residentName}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Version:</span>
                <span className="tabular-nums font-medium text-foreground">v{plan?.version ?? "—"}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Effective:</span>
                <span className="tabular-nums font-medium text-foreground">{formatDate(plan?.effective_date ?? null)}</span>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-foreground block mb-3">
                Digital signature <span className="text-destructive">*</span>
              </label>
              <SignaturePad
                onSignatureChange={setSignatureData}
                height={150}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setSigningOpen(false);
                setSignatureData(null);
                setSubmitError(null);
              }}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleApprove}
              disabled={!signatureData || isSubmitting}
            >
              {isSubmitting ? "Approving..." : "Confirm & approve"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
    return { label: formatDate(isoDate), className: "border-border" };
  }
  if (due < now) {
    return {
      label: `${formatDate(isoDate)} (overdue)`,
      className: "border-destructive/30 bg-destructive/10 text-destructive",
    };
  }
  const days = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 14) {
    return {
      label: `${formatDate(isoDate)} (${days}d)`,
      className: "border-warning/30 bg-warning/10 text-warning",
    };
  }
  return {
    label: formatDate(isoDate),
    className: "border-border",
  };
}

function CarePlanStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: "bg-success/10 text-success border-success/20",
    draft: "bg-muted text-muted-foreground border-border",
    under_review: "bg-warning/10 text-warning border-warning/20",
    archived: "bg-muted text-muted-foreground border-border",
  };
  return <Badge className={cn("text-[10px] uppercase font-bold tracking-wider px-3 border shadow-none", map[status] ?? "bg-muted text-muted-foreground")}>{formatSnakeLabel(status)}</Badge>;
}
