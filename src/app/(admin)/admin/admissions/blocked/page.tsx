"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarDays, FileWarning, Home, Loader2 } from "lucide-react";

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
import { useHavenAuth } from "@/contexts/haven-auth-context";

type CaseRow = Pick<
  Database["public"]["Tables"]["admission_cases"]["Row"],
  | "id"
  | "status"
  | "updated_at"
  | "target_move_in_date"
  | "financial_clearance_at"
  | "physician_orders_received_at"
  | "bed_id"
> & {
  residents: { first_name: string; last_name: string } | null;
};

type BlockedCase = {
  row: CaseRow;
  residentLabel: string;
  blockers: string[];
};

type BlockerFilter = "all" | "financial clearance" | "physician orders" | "bed assignment" | "move-in date";

function admissionBlockers(row: CaseRow): string[] {
  const blockers: string[] = [];
  if (!row.financial_clearance_at) blockers.push("financial clearance");
  if (!row.physician_orders_received_at) blockers.push("physician orders");
  if (!row.bed_id) blockers.push("bed assignment");
  if (!row.target_move_in_date) blockers.push("move-in date");
  return blockers;
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

export default function AdminBlockedAdmissionsPage() {
  const supabase = useMemo(() => createClient(), []);
  const { selectedFacilityId } = useFacilityStore();
  const { user } = useHavenAuth();

  const [rows, setRows] = useState<BlockedCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [blockerFilter, setBlockerFilter] = useState<BlockerFilter>("all");
  const [moveInDrafts, setMoveInDrafts] = useState<Record<string, string>>({});

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
        .select("id, status, updated_at, target_move_in_date, financial_clearance_at, physician_orders_received_at, bed_id, residents(first_name, last_name)")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .not("status", "eq", "cancelled")
        .order("updated_at", { ascending: false });

      if (queryError) throw queryError;

      const blocked = ((data ?? []) as CaseRow[])
        .map((row) => ({
          row,
          residentLabel: row.residents ? `${row.residents.first_name} ${row.residents.last_name}` : "Unlinked case",
          blockers: admissionBlockers(row),
        }))
        .filter((entry) => entry.blockers.length > 0);

      setRows(blocked);
      setMoveInDrafts(
        Object.fromEntries(blocked.map((entry) => [entry.row.id, entry.row.target_move_in_date ?? ""])),
      );
    } catch (loadError) {
      setRows([]);
      setError(loadError instanceof Error ? loadError.message : "Could not load blocked admissions.");
    } finally {
      setLoading(false);
    }
  }, [selectedFacilityId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const blockerCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of rows) {
      for (const blocker of entry.blockers) {
        counts.set(blocker, (counts.get(blocker) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [rows]);

  const visibleRows = rows.filter((entry) => {
    if (blockerFilter === "all") return true;
    return entry.blockers.includes(blockerFilter);
  });

  async function updateCase(
    caseId: string,
    patch: Partial<Database["public"]["Tables"]["admission_cases"]["Update"]>,
    successMessage: string,
  ) {
    setActionLoading(caseId);
    setActionError(null);
    setActionMessage(null);
    try {
      const { error: updateError } = await supabase
        .from("admission_cases")
        .update({
          ...patch,
          updated_at: new Date().toISOString(),
          updated_by: user?.id ?? null,
        })
        .eq("id", caseId);
      if (updateError) throw updateError;
      setActionMessage(successMessage);
      await load();
    } catch (updateErr) {
      setActionError(updateErr instanceof Error ? updateErr.message : "Could not update admission case.");
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="space-y-2">
        <Link
          href="/admin/admissions"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}
        >
          <ArrowLeft className="h-4 w-4" />
          Admissions hub
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-zinc-100">Blocked Admissions</h1>
            <p className="text-sm text-slate-500 dark:text-zinc-400">
              Work the admission cases that are missing core move-in readiness steps.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
              {rows.length} blocked cases
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
          title="No blocked admissions"
          description="Current admission cases do not have core move-in readiness blockers in this scope."
        />
      ) : (
        <div className="space-y-4">
          {actionError ? (
            <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-800 dark:text-red-200">
              {actionError}
            </div>
          ) : null}
          {actionMessage ? (
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200">
              {actionMessage}
            </div>
          ) : null}
          <div className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs uppercase tracking-widest text-slate-500 dark:text-zinc-500">Top blockers</span>
              {blockerCounts.map(([label, count]) => (
                <Badge key={label} variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
                  {label}: {count}
                </Badge>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {([
              { value: "all", label: `All (${rows.length})` },
              ...blockerCounts.map(([label, count]) => ({
                value: label as BlockerFilter,
                label: `${label} (${count})`,
              })),
            ] as Array<{ value: BlockerFilter; label: string }>).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setBlockerFilter(option.value)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                  blockerFilter === option.value
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
                title="No blocked admissions in this filter"
                description="Try another blocker filter to view the remaining readiness work."
              />
            ) : visibleRows.map(({ row, residentLabel, blockers }) => (
              <Card key={row.id} className="border-slate-200/70 shadow-soft dark:border-slate-800">
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-lg font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                        <Home className="h-4 w-4 text-indigo-500" />
                        {residentLabel}
                      </CardTitle>
                      <CardDescription className="mt-1">
                        Admission case {row.id}
                      </CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {row.target_move_in_date ? (
                        <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700">
                          <CalendarDays className="mr-1 h-3 w-3" />
                          {row.target_move_in_date}
                        </Badge>
                      ) : null}
                      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                        <FileWarning className="mr-1 h-3 w-3" />
                        {blockers.length} blocker{blockers.length === 1 ? "" : "s"}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    {blockers.map((blocker) => (
                      <Badge key={blocker} variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                        {blocker}
                      </Badge>
                    ))}
                  </div>
                  <div className="text-sm text-slate-500 dark:text-zinc-400">
                    Updated {formatRelative(row.updated_at)}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      disabled={Boolean(row.financial_clearance_at) || actionLoading === row.id}
                      onClick={() =>
                        void updateCase(
                          row.id,
                          {
                            financial_clearance_at: new Date().toISOString(),
                            financial_clearance_by: user?.id ?? null,
                          },
                          "Financial clearance recorded.",
                        )
                      }
                      className={cn(
                        "rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                        Boolean(row.financial_clearance_at)
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800",
                      )}
                    >
                      {actionLoading === row.id && !row.financial_clearance_at ? (
                        <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Saving…</span>
                      ) : row.financial_clearance_at ? "Financial clearance complete" : "Mark financial clearance"}
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(row.physician_orders_received_at) || actionLoading === row.id}
                      onClick={() =>
                        void updateCase(
                          row.id,
                          { physician_orders_received_at: new Date().toISOString() },
                          "Physician orders recorded.",
                        )
                      }
                      className={cn(
                        "rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                        Boolean(row.physician_orders_received_at)
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800",
                      )}
                    >
                      {actionLoading === row.id && !row.physician_orders_received_at ? (
                        <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Saving…</span>
                      ) : row.physician_orders_received_at ? "Physician orders complete" : "Mark physician orders"}
                    </button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                    <input
                      type="date"
                      value={moveInDrafts[row.id] ?? ""}
                      onChange={(event) =>
                        setMoveInDrafts((current) => ({
                          ...current,
                          [row.id]: event.target.value,
                        }))
                      }
                      className="w-full rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2.5 text-sm text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <button
                      type="button"
                      disabled={
                        actionLoading === row.id ||
                        !moveInDrafts[row.id] ||
                        moveInDrafts[row.id] === (row.target_move_in_date ?? "")
                      }
                      onClick={() =>
                        void updateCase(
                          row.id,
                          { target_move_in_date: moveInDrafts[row.id] || null },
                          "Target move-in date saved.",
                        )
                      }
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    >
                      {actionLoading === row.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save move-in date"}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link href={`/admin/admissions/${row.id}`} className={cn(buttonVariants({ size: "sm" }))}>
                      Open case
                    </Link>
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
