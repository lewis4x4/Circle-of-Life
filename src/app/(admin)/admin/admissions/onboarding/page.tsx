"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Home } from "lucide-react";

import {
  AdminEmptyState,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database";

type CaseRow = Pick<
  Database["public"]["Tables"]["admission_cases"]["Row"],
  "id" | "status" | "updated_at" | "resident_id" | "target_move_in_date"
> & {
  residents: { first_name: string; last_name: string } | null;
};

type QueueRow = {
  row: CaseRow;
  residentLabel: string;
  checklist: Array<{ key: string; label: string; passed: boolean }>;
  missingItems: string[];
  nextActionLabel: string;
  nextActionHref: string;
};

type MissingFilter = "all" | "care plan" | "medication profile" | "resident payer" | "family consent";

function onboardingChecklist(counts: { carePlans: number; medications: number; payers: number; familyConsents: number }) {
  return [
    { key: "care_plan", label: "Care plan", passed: counts.carePlans > 0 },
    { key: "meds", label: "Medication profile", passed: counts.medications > 0 },
    { key: "billing", label: "Resident payer", passed: counts.payers > 0 },
    { key: "family", label: "Family consent", passed: counts.familyConsents > 0 },
  ];
}

function formatRelative(date: string | null): string {
  if (!date) return "—";
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function AdminAdmissionsOnboardingPage() {
  const supabase = useMemo(() => createClient(), []);
  const { selectedFacilityId } = useFacilityStore();

  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [missingFilter, setMissingFilter] = useState<MissingFilter>("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setRows([]);
      setLoading(false);
      return;
    }

    try {
      const { data, error: queryError } = await supabase
        .from("admission_cases")
        .select("id, status, updated_at, resident_id, target_move_in_date, residents(first_name, last_name)")
        .eq("facility_id", selectedFacilityId)
        .eq("status", "move_in")
        .is("deleted_at", null)
        .order("updated_at", { ascending: false });
      if (queryError) throw queryError;

      const cases = (data ?? []) as CaseRow[];
      const residentIds = cases.map((row) => row.resident_id).filter(Boolean) as string[];
      if (residentIds.length === 0) {
        setRows([]);
        return;
      }

      const [carePlansRes, medsRes, payersRes, consentsRes] = await Promise.all([
        supabase.from("care_plans").select("resident_id").in("resident_id", residentIds).is("deleted_at", null),
        supabase.from("resident_medications").select("resident_id").in("resident_id", residentIds).is("deleted_at", null),
        supabase.from("resident_payers").select("resident_id").in("resident_id", residentIds).is("deleted_at", null),
        supabase.from("family_consent_records").select("resident_id").in("resident_id", residentIds).is("deleted_at", null),
      ]);

      if (carePlansRes.error) throw carePlansRes.error;
      if (medsRes.error) throw medsRes.error;
      if (payersRes.error) throw payersRes.error;
      if (consentsRes.error) throw consentsRes.error;

      const carePlanIds = new Set((carePlansRes.data ?? []).map((row) => row.resident_id));
      const medIds = new Set((medsRes.data ?? []).map((row) => row.resident_id));
      const payerIds = new Set((payersRes.data ?? []).map((row) => row.resident_id));
      const consentIds = new Set((consentsRes.data ?? []).map((row) => row.resident_id));

      const queueRows = cases
        .map((row) => {
          const residentId = row.resident_id;
          const checklist = onboardingChecklist({
            carePlans: residentId && carePlanIds.has(residentId) ? 1 : 0,
            medications: residentId && medIds.has(residentId) ? 1 : 0,
            payers: residentId && payerIds.has(residentId) ? 1 : 0,
            familyConsents: residentId && consentIds.has(residentId) ? 1 : 0,
          });
          const missingItems = checklist.filter((item) => !item.passed).map((item) => item.label.toLowerCase());
          const nextActionHref = residentId
            ? missingItems[0] === "care plan"
              ? `/admin/residents/${residentId}/care-plan`
              : missingItems[0] === "medication profile"
                ? `/admin/residents/${residentId}/medications`
                : missingItems[0] === "resident payer"
                  ? `/admin/residents/${residentId}/billing`
                  : "/admin/family-messages"
            : "/admin/admissions";
          const nextActionLabel =
            missingItems[0] === "care plan"
              ? "Open care plan"
              : missingItems[0] === "medication profile"
                ? "Open medications"
                : missingItems[0] === "resident payer"
                  ? "Open billing"
                  : "Open family coordination";
          return {
            row,
            residentLabel: row.residents ? `${row.residents.first_name} ${row.residents.last_name}` : "Resident",
            checklist,
            missingItems,
            nextActionLabel,
            nextActionHref,
          };
        })
        .filter((entry) => entry.checklist.some((item) => !item.passed));

      setRows(queueRows);
    } catch (loadError) {
      setRows([]);
      setError(loadError instanceof Error ? loadError.message : "Could not load onboarding queue.");
    } finally {
      setLoading(false);
    }
  }, [selectedFacilityId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = {
    cases: rows.length,
    incomplete: rows.reduce((sum, row) => sum + row.checklist.filter((item) => !item.passed).length, 0),
  };

  const missingCounts = useMemo(() => {
    const countsMap = new Map<string, number>();
    for (const row of rows) {
      for (const item of row.missingItems) {
        countsMap.set(item, (countsMap.get(item) ?? 0) + 1);
      }
    }
    return Array.from(countsMap.entries()).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const visibleRows = rows.filter((row) => missingFilter === "all" || row.missingItems.includes(missingFilter));

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="space-y-2">
        <Link href="/admin/admissions" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}>
          <ArrowLeft className="h-4 w-4" />
          Admissions hub
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-zinc-100">Downstream Onboarding Queue</h1>
            <p className="text-sm text-slate-500 dark:text-zinc-400">
              Move-in cases that still need downstream resident setup completed.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700">
              {counts.cases} resident{counts.cases === 1 ? "" : "s"}
            </Badge>
            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
              {counts.incomplete} incomplete items
            </Badge>
          </div>
        </div>
      </div>

      {loading ? (
        <AdminTableLoadingState />
      ) : error ? (
        <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} />
      ) : rows.length === 0 ? (
        <AdminEmptyState
          title="No downstream onboarding gaps"
          description="Move-in cases in this scope have their downstream onboarding items in place."
        />
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs uppercase tracking-widest text-slate-500 dark:text-zinc-500">Top missing work</span>
              {missingCounts.map(([label, count]) => (
                <Badge key={label} variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
                  {label}: {count}
                </Badge>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {([
              { value: "all", label: `All (${rows.length})` },
              ...missingCounts.map(([label, count]) => ({
                value: label as MissingFilter,
                label: `${label} (${count})`,
              })),
            ] as Array<{ value: MissingFilter; label: string }>).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setMissingFilter(option.value)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                  missingFilter === option.value
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

        <div className="grid gap-4">
          {visibleRows.length === 0 ? (
            <AdminEmptyState
              title="No onboarding cases in this filter"
              description="Try another missing-item filter to inspect the remaining downstream setup work."
            />
          ) : visibleRows.map(({ row, residentLabel, checklist, nextActionHref, nextActionLabel, missingItems }) => (
            <Card key={row.id} className="border-slate-200/70 shadow-soft dark:border-slate-800">
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-lg font-semibold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
                      <Home className="h-4 w-4 text-indigo-500" />
                      {residentLabel}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      Admission case {row.id}
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                      <CheckCircle2 className="mr-1 h-3 w-3" />
                      Move-in
                    </Badge>
                    {row.target_move_in_date ? (
                      <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700">
                        <Home className="mr-1 h-3 w-3" />
                        {row.target_move_in_date}
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {missingItems.map((item) => (
                    <Badge key={item} variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                      {item}
                    </Badge>
                  ))}
                </div>
                <div className="grid gap-2">
                  {checklist.map((item) => (
                    <div key={item.key} className="rounded-xl border border-slate-200/70 dark:border-white/5 bg-white/80 dark:bg-black/20 px-4 py-3 flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-slate-900 dark:text-white">{item.label}</span>
                      <span className={cn(
                        "rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-widest",
                        item.passed
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                          : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
                      )}>
                        {item.passed ? "Complete" : "Missing"}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/admin/admissions/${row.id}`} className={cn(buttonVariants({ size: "sm" }))}>
                    Open case
                  </Link>
                  <Link href={nextActionHref} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                    {nextActionLabel}
                  </Link>
                  {row.resident_id ? (
                    <>
                      <Link href={`/admin/residents/${row.resident_id}/care-plan`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                        Care plan
                      </Link>
                      <Link href={`/admin/residents/${row.resident_id}/medications`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                        Medications
                      </Link>
                      <Link href={`/admin/residents/${row.resident_id}/billing`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                        Billing
                      </Link>
                    </>
                  ) : null}
                  <Link href="/admin/family-messages" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
                    Family coordination
                  </Link>
                </div>
                <div className="text-xs text-slate-500 dark:text-zinc-400">
                  Updated {formatRelative(row.updated_at)}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        </div>
      )}
    </div>
  );
}
