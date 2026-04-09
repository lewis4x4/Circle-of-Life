"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ArrowLeftRight, Download, Loader2 } from "lucide-react";

import {
  AdminEmptyState,
  AdminFilterBar,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { adminListFilteredEmptyCopy } from "@/lib/admin-list-empty-copy";
import { csvEscapeCell, triggerCsvDownload } from "@/lib/csv-export";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { PulseDot } from "@/components/ui/moonshot/pulse-dot";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";

type SwapRowDb = Database["public"]["Tables"]["shift_swap_requests"]["Row"];

type SwapUiRow = {
  id: string;
  status: string;
  swapType: string;
  reason: string | null;
  createdAt: string;
  requestingName: string;
  coveringName: string | null;
};

type SupabaseStaffMini = {
  id: string;
  first_name: string;
  last_name: string;
  deleted_at: string | null;
};

type QueryError = { message: string };
type QueryResult<T> = { data: T[] | null; error: QueryError | null };

type SwapExportRow = SwapRowDb & {
  requesting_staff_display_name: string;
  covering_staff_display_name: string;
};

function buildShiftSwapsCsv(rows: SwapExportRow[]): string {
  const header = [
    "id",
    "organization_id",
    "facility_id",
    "requesting_staff_id",
    "requesting_staff_display_name",
    "requesting_assignment_id",
    "covering_staff_id",
    "covering_staff_display_name",
    "covering_assignment_id",
    "swap_type",
    "reason",
    "status",
    "claimed_at",
    "approved_at",
    "approved_by",
    "denied_reason",
    "created_at",
    "updated_at",
    "deleted_at",
  ].join(",");
  const body = rows.map((row) =>
    [
      csvEscapeCell(row.id),
      csvEscapeCell(row.organization_id),
      csvEscapeCell(row.facility_id),
      csvEscapeCell(row.requesting_staff_id),
      csvEscapeCell(row.requesting_staff_display_name),
      csvEscapeCell(row.requesting_assignment_id),
      csvEscapeCell(row.covering_staff_id ?? ""),
      csvEscapeCell(row.covering_staff_display_name),
      csvEscapeCell(row.covering_assignment_id ?? ""),
      csvEscapeCell(row.swap_type),
      csvEscapeCell(row.reason ?? ""),
      csvEscapeCell(row.status),
      csvEscapeCell(row.claimed_at ?? ""),
      csvEscapeCell(row.approved_at ?? ""),
      csvEscapeCell(row.approved_by ?? ""),
      csvEscapeCell(row.denied_reason ?? ""),
      csvEscapeCell(row.created_at),
      csvEscapeCell(row.updated_at),
      csvEscapeCell(row.deleted_at ?? ""),
    ].join(","),
  );
  return [header, ...body].join("\r\n");
}

function staffDisplayName(s: SupabaseStaffMini | undefined): string {
  if (!s) return "Unknown staff";
  const first = s.first_name?.trim() ?? "";
  const last = s.last_name?.trim() ?? "";
  return `${first} ${last}`.trim() || "Staff member";
}

const DEFAULT_FILTERS = { search: "", status: "all" };

export default function AdminShiftSwapsPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<SwapUiRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [search, setSearch] = useState(DEFAULT_FILTERS.search);
  const [status, setStatus] = useState(DEFAULT_FILTERS.status);
  const [actionId, setActionId] = useState<string | null>(null);
  const [denyTargetId, setDenyTargetId] = useState<string | null>(null);
  const [denyReason, setDenyReason] = useState("");

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    setNotice(null);
    try {
      const ui = await fetchShiftSwapsFromSupabase(supabase, selectedFacilityId);
      setRows(ui);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load shift swap requests");
      setRows([]);
    } finally {
      setIsLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesSearch =
        q.length === 0 ||
        row.requestingName.toLowerCase().includes(q) ||
        (row.coveringName?.toLowerCase().includes(q) ?? false) ||
        row.swapType.toLowerCase().includes(q) ||
        row.status.toLowerCase().includes(q) ||
        (row.reason?.toLowerCase().includes(q) ?? false);
      const matchesStatus =
        status === "all" || row.status.toLowerCase() === status.toLowerCase();
      return matchesSearch && matchesStatus;
    });
  }, [rows, search, status]);

  const pendingCount = useMemo(
    () => rows.filter((r) => r.status.toLowerCase() === "pending").length,
    [rows],
  );

  const listEmptyCopy = useMemo(
    () =>
      adminListFilteredEmptyCopy({
        datasetRowCount: rows.length,
        whenDatasetEmpty: {
          title: "No shift swap requests in this scope",
          description:
            "When staff submit swaps, they appear here for scheduling oversight (RLS-scoped).",
        },
        whenFiltersExcludeAll: {
          title: "No requests match filters",
          description: "Clear search or status to see more rows.",
        },
      }),
    [rows.length],
  );

  const approveSwap = useCallback(
    async (id: string) => {
      setActionId(id);
      setNotice(null);
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user?.id) {
          setNotice("You must be signed in to approve.");
          return;
        }
        const res = (await supabase
          .from("shift_swap_requests" as never)
          .update({
            status: "approved",
            approved_at: new Date().toISOString(),
            approved_by: user.id,
            denied_reason: null,
          } as never)
          .eq("id", id)
          .is("deleted_at", null)) as { error: QueryError | null };
        if (res.error) throw res.error;
        await load();
      } catch (e) {
        setNotice(e instanceof Error ? e.message : "Could not approve request.");
      } finally {
        setActionId(null);
      }
    },
    [supabase, load],
  );

  const submitDeny = useCallback(async () => {
    if (!denyTargetId) return;
    const reason = denyReason.trim();
    if (!reason) {
      setNotice("Enter a short reason for denial.");
      return;
    }
    setActionId(denyTargetId);
    setNotice(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.id) {
        setNotice("You must be signed in to deny.");
        return;
      }
      const res = (await supabase
        .from("shift_swap_requests" as never)
        .update({
          status: "denied",
          denied_reason: reason,
          approved_at: null,
          approved_by: null,
        } as never)
        .eq("id", denyTargetId)
        .is("deleted_at", null)) as { error: QueryError | null };
      if (res.error) throw res.error;
      setDenyTargetId(null);
      setDenyReason("");
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not deny request.");
    } finally {
      setActionId(null);
    }
  }, [denyTargetId, denyReason, supabase, load]);

  const exportShiftSwapsCsv = useCallback(async () => {
    setExportingCsv(true);
    setNotice(null);
    try {
      let q = supabase
        .from("shift_swap_requests" as never)
        .select("*")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(500);

      if (isValidFacilityIdForQuery(selectedFacilityId)) {
        q = q.eq("facility_id", selectedFacilityId);
      }

      const res = (await q) as unknown as QueryResult<SwapRowDb>;
      if (res.error) throw res.error;
      const list = res.data ?? [];
      if (list.length === 0) {
        triggerCsvDownload(`shift-swap-requests-${format(new Date(), "yyyy-MM-dd")}.csv`, buildShiftSwapsCsv([]));
        return;
      }

      const staffIds = new Set<string>();
      for (const r of list) {
        staffIds.add(r.requesting_staff_id);
        if (r.covering_staff_id) staffIds.add(r.covering_staff_id);
      }

      const staffRes = (await supabase
        .from("staff" as never)
        .select("id, first_name, last_name, deleted_at")
        .in("id", [...staffIds])
        .is("deleted_at", null)) as unknown as QueryResult<SupabaseStaffMini>;
      if (staffRes.error) throw staffRes.error;

      const byId = new Map<string, SupabaseStaffMini>();
      for (const s of staffRes.data ?? []) {
        byId.set(s.id, s);
      }

      const exportRows: SwapExportRow[] = list.map((row) => ({
        ...row,
        requesting_staff_display_name: staffDisplayName(byId.get(row.requesting_staff_id)),
        covering_staff_display_name: row.covering_staff_id
          ? staffDisplayName(byId.get(row.covering_staff_id))
          : "",
      }));

      const csv = buildShiftSwapsCsv(exportRows);
      triggerCsvDownload(`shift-swap-requests-${format(new Date(), "yyyy-MM-dd")}.csv`, csv);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setExportingCsv(false);
    }
  }, [supabase, selectedFacilityId]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix hasCriticals={false} primaryClass="bg-indigo-700/10" secondaryClass="bg-blue-900/10" />

      <div className="relative z-10 space-y-6">
        <header className="mb-6">
          <p className="text-[10px] uppercase font-mono tracking-widest text-slate-500 mb-2">
            SYS: Module 11 / Shift swap requests
          </p>
          <h2 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-3">
            Shift swaps {pendingCount > 0 ? <PulseDot colorClass="bg-amber-500" /> : null}
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 max-w-2xl">
            Oversight queue for COL’s shift swap workflow. Pending requests can be approved or denied when your role
            allows (facility admin or nurse per RLS). Export supports audits.
          </p>
        </header>

        <KineticGrid className="grid-cols-1 md:grid-cols-3 gap-4 mb-2">
          <div className="h-[120px] md:col-span-2">
            <V2Card hoverColor="indigo" className="h-full relative overflow-hidden flex flex-col justify-center">
              <MonolithicWatermark value={pendingCount} className="text-indigo-600/5 dark:text-indigo-400/5 opacity-50" />
              <div className="relative z-10 px-4">
                <h3 className="text-[10px] font-mono tracking-widest uppercase text-indigo-600 dark:text-indigo-400 flex items-center gap-2">
                  <ArrowLeftRight className="h-3.5 w-3.5" /> Pending
                </h3>
                <p className="text-3xl font-mono tracking-tighter text-indigo-600 dark:text-indigo-400">{pendingCount}</p>
              </div>
            </V2Card>
          </div>
          <div className="h-[120px] flex items-stretch">
            <V2Card hoverColor="blue" className="w-full flex items-center justify-center">
              <p className="text-xs font-mono text-slate-500 px-4 text-center">Up to 500 rows loaded; CSV matches list scope.</p>
            </V2Card>
          </div>
        </KineticGrid>

        <AdminFilterBar
          searchValue={search}
          searchPlaceholder="Search staff, status, type, reason…"
          onSearchChange={setSearch}
          filters={[
            {
              id: "status",
              value: status,
              onChange: setStatus,
              options: [
                { value: "all", label: "All statuses" },
                { value: "pending", label: "Pending" },
                { value: "claimed", label: "Claimed" },
                { value: "approved", label: "Approved" },
                { value: "denied", label: "Denied" },
                { value: "cancelled", label: "Cancelled" },
              ],
            },
          ]}
          onReset={() => {
            setSearch(DEFAULT_FILTERS.search);
            setStatus(DEFAULT_FILTERS.status);
          }}
        />

        {notice ? (
          <div
            className="rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
            role="status"
          >
            {notice}
          </div>
        ) : null}

        {isLoading ? <AdminTableLoadingState /> : null}
        {!isLoading && loadError ? (
          <AdminLiveDataFallbackNotice message={loadError} onRetry={() => void load()} />
        ) : null}
        {!isLoading && !loadError && filteredRows.length === 0 ? (
          <AdminEmptyState title={listEmptyCopy.title} description={listEmptyCopy.description} />
        ) : null}
        {!isLoading && !loadError && filteredRows.length > 0 ? (
          <div className="relative z-10 p-4 sm:p-6 mb-4 glass-panel rounded-3xl border border-white/20 dark:border-white/5 bg-white/40 dark:bg-black/20 backdrop-blur-2xl shadow-2xl flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-lg font-display font-semibold text-slate-900 dark:text-slate-100">Requests</h3>
              <p className="text-sm font-mono text-slate-500">{filteredRows.length} shown</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 font-mono text-[10px] uppercase tracking-widest"
              disabled={exportingCsv}
              aria-busy={exportingCsv}
              onClick={() => void exportShiftSwapsCsv()}
            >
              <Download className="mr-2 h-3.5 w-3.5" aria-hidden />
              {exportingCsv ? "Exporting…" : "Download CSV"}
            </Button>
          </div>
        ) : null}

        {!isLoading && !loadError && filteredRows.length > 0 ? (
          <MotionList className="space-y-3">
            {filteredRows.map((row) => (
              <MotionItem key={row.id}>
                <div className="p-4 sm:p-5 rounded-2xl glass-panel border border-white/20 dark:border-white/5 bg-white/40 dark:bg-slate-900/40 w-full flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex flex-col gap-1 min-w-0 flex-1">
                    <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {row.requestingName}
                      <span className="text-slate-500 font-normal"> → </span>
                      {row.coveringName ?? "—"}
                    </span>
                    <span className="text-xs text-slate-500">
                      {formatDateTime(row.createdAt)} · {row.swapType}
                    </span>
                    {row.reason ? (
                      <span className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2">{row.reason}</span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {row.status.toLowerCase() === "pending" ? (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          className="font-mono text-[10px] uppercase tracking-widest"
                          disabled={actionId !== null}
                          onClick={() => void approveSwap(row.id)}
                        >
                          {actionId === row.id ? (
                            <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />
                          ) : null}
                          Approve
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="font-mono text-[10px] uppercase tracking-widest"
                          disabled={actionId !== null}
                          onClick={() => {
                            setDenyTargetId(row.id);
                            setDenyReason("");
                            setNotice(null);
                          }}
                        >
                          Deny
                        </Button>
                      </>
                    ) : null}
                    <SwapStatusBadge status={row.status} />
                  </div>
                </div>
              </MotionItem>
            ))}
          </MotionList>
        ) : null}

        {denyTargetId ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="deny-swap-title"
          >
            <div className="w-full max-w-md rounded-2xl border border-white/20 bg-white p-5 shadow-xl dark:bg-slate-900 dark:border-white/10">
              <h3 id="deny-swap-title" className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
                Deny swap request
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 mb-3">
                Provide a brief reason (stored on the record for audit).
              </p>
              <textarea
                value={denyReason}
                onChange={(e) => setDenyReason(e.target.value)}
                rows={3}
                className={cn(
                  "w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm",
                  "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                  "dark:bg-input/30",
                )}
                placeholder="Reason for denial…"
                aria-label="Denial reason"
              />
              <div className="mt-4 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={actionId !== null}
                  onClick={() => {
                    setDenyTargetId(null);
                    setDenyReason("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={actionId !== null}
                  onClick={() => void submitDeny()}
                >
                  {actionId === denyTargetId ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />
                  ) : null}
                  Confirm deny
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

async function fetchShiftSwapsFromSupabase(
  supabase: ReturnType<typeof createClient>,
  selectedFacilityId: string | null,
): Promise<SwapUiRow[]> {
  let q = supabase
    .from("shift_swap_requests" as never)
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(500);

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    q = q.eq("facility_id", selectedFacilityId);
  }

  const res = (await q) as unknown as QueryResult<SwapRowDb>;
  if (res.error) throw res.error;
  const list = res.data ?? [];
  if (list.length === 0) return [];

  const staffIds = new Set<string>();
  for (const r of list) {
    staffIds.add(r.requesting_staff_id);
    if (r.covering_staff_id) staffIds.add(r.covering_staff_id);
  }

  const staffRes = (await supabase
    .from("staff" as never)
    .select("id, first_name, last_name, deleted_at")
    .in("id", [...staffIds])
    .is("deleted_at", null)) as unknown as QueryResult<SupabaseStaffMini>;
  if (staffRes.error) throw staffRes.error;

  const byId = new Map<string, SupabaseStaffMini>();
  for (const s of staffRes.data ?? []) {
    byId.set(s.id, s);
  }

  const ui: SwapUiRow[] = list.map((r) => ({
    id: r.id,
    status: r.status,
    swapType: r.swap_type,
    reason: r.reason,
    createdAt: r.created_at,
    requestingName: staffDisplayName(byId.get(r.requesting_staff_id)),
    coveringName: r.covering_staff_id ? staffDisplayName(byId.get(r.covering_staff_id)) : null,
  }));

  return ui;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

function SwapStatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  const map: Record<string, string> = {
    pending: "bg-amber-500/20 text-amber-900 dark:text-amber-200",
    claimed: "bg-blue-500/20 text-blue-900 dark:text-blue-200",
    approved: "bg-emerald-500/20 text-emerald-900 dark:text-emerald-200",
    denied: "bg-rose-500/20 text-rose-900 dark:text-rose-200",
    cancelled: "bg-slate-200/50 text-slate-800 dark:bg-slate-800/50 dark:text-slate-300",
  };
  const cls = map[s] ?? "bg-slate-200/50 text-slate-800";
  return (
    <Badge className={`shrink-0 uppercase tracking-widest font-mono text-[9px] font-bold border-0 ${cls}`}>
      {status}
    </Badge>
  );
}
