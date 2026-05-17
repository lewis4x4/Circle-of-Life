"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Bus, CheckCircle2, CircleDollarSign, Download, Undo2 } from "lucide-react";
import { format, parseISO } from "date-fns";

import { Button, buttonVariants } from "@/components/ui/button";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { csvEscapeCell, triggerCsvDownload } from "@/lib/csv-export";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";
import { MotionItem, MotionList } from "@/components/ui/motion-list";

type MileageRow = Database["public"]["Tables"]["mileage_logs"]["Row"] & {
  staff: { first_name: string; last_name: string } | null;
  residents: { first_name: string; last_name: string } | null;
};

type MileageExportRow = Database["public"]["Tables"]["mileage_logs"]["Row"] & {
  staff: { first_name: string; last_name: string } | null;
  residents: { first_name: string; last_name: string } | null;
};

function buildMileageLogsCsv(rows: MileageExportRow[]): string {
  const header = [
    "id",
    "organization_id",
    "facility_id",
    "staff_id",
    "staff_first_name",
    "staff_last_name",
    "resident_id",
    "resident_first_name",
    "resident_last_name",
    "trip_date",
    "purpose",
    "origin",
    "destination",
    "miles",
    "round_trip",
    "reimbursement_amount_cents",
    "reimbursement_rate_cents",
    "approved_at",
    "approved_by",
    "payroll_export_id",
    "transport_request_id",
    "notes",
    "created_at",
    "updated_at",
    "created_by",
    "updated_by",
  ].join(",");
  const body = rows.map((row) =>
    [
      csvEscapeCell(row.id),
      csvEscapeCell(row.organization_id),
      csvEscapeCell(row.facility_id),
      csvEscapeCell(row.staff_id),
      csvEscapeCell(row.staff?.first_name ?? ""),
      csvEscapeCell(row.staff?.last_name ?? ""),
      csvEscapeCell(row.resident_id ?? ""),
      csvEscapeCell(row.residents?.first_name ?? ""),
      csvEscapeCell(row.residents?.last_name ?? ""),
      csvEscapeCell(row.trip_date),
      csvEscapeCell(row.purpose),
      csvEscapeCell(row.origin),
      csvEscapeCell(row.destination),
      csvEscapeCell(String(row.miles)),
      csvEscapeCell(String(row.round_trip)),
      csvEscapeCell(String(row.reimbursement_amount_cents)),
      csvEscapeCell(String(row.reimbursement_rate_cents)),
      csvEscapeCell(row.approved_at ?? ""),
      csvEscapeCell(row.approved_by ?? ""),
      csvEscapeCell(row.payroll_export_id ?? ""),
      csvEscapeCell(row.transport_request_id ?? ""),
      csvEscapeCell(row.notes ?? ""),
      csvEscapeCell(row.created_at),
      csvEscapeCell(row.updated_at),
      csvEscapeCell(row.created_by ?? ""),
      csvEscapeCell(row.updated_by ?? ""),
    ].join(","),
  );
  return [header, ...body].join("\r\n");
}

const APPROVER_ROLES = new Set(["owner", "org_admin", "facility_admin", "nurse"]);

function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

type MileageCsvScope = "all" | "pending" | "approved";

const MILEAGE_CSV_SCOPE_OPTIONS: { value: MileageCsvScope; label: string }[] = [
  { value: "all", label: "All rows" },
  { value: "pending", label: "Pending approval only" },
  { value: "approved", label: "Approved only" },
];

export default function MileageApprovalsPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const [pending, setPending] = useState<MileageRow[]>([]);
  const [approvedRecent, setApprovedRecent] = useState<MileageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"pending" | "approved">("pending");
  const [actorRole, setActorRole] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [mileageCsvScope, setMileageCsvScope] = useState<MileageCsvScope>("all");

  const canApprove = actorRole !== null && APPROVER_ROLES.has(actorRole);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setPending([]);
      setApprovedRecent([]);
      setLoading(false);
      return;
    }
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data: prof } = await supabase.from("user_profiles").select("app_role").eq("id", user.id).maybeSingle();
        setActorRole((prof as { app_role: string } | null)?.app_role ?? null);
      } else {
        setActorRole(null);
      }

      const sel =
        "id, trip_date, purpose, origin, destination, miles, round_trip, reimbursement_amount_cents, reimbursement_rate_cents, approved_at, approved_by, payroll_export_id, transport_request_id, staff_id, resident_id, staff(first_name, last_name), residents(first_name, last_name)";

      const [pRes, aRes] = await Promise.all([
        supabase
          .from("mileage_logs")
          .select(sel)
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .is("approved_at", null)
          .order("trip_date", { ascending: true })
          .order("created_at", { ascending: true })
          .limit(100),
        supabase
          .from("mileage_logs")
          .select(sel)
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .not("approved_at", "is", null)
          .order("approved_at", { ascending: false })
          .limit(50),
      ]);

      if (pRes.error) throw pRes.error;
      if (aRes.error) throw aRes.error;
      setPending((pRes.data ?? []) as MileageRow[]);
      setApprovedRecent((aRes.data ?? []) as MileageRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load mileage logs.");
      setPending([]);
      setApprovedRecent([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportMileageLogsCsv = useCallback(async () => {
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) return;
    setExportingCsv(true);
    setError(null);
    try {
      let q = supabase
        .from("mileage_logs")
        .select("*, staff(first_name, last_name), residents(first_name, last_name)")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null);
      if (mileageCsvScope === "pending") {
        q = q.is("approved_at", null);
      } else if (mileageCsvScope === "approved") {
        q = q.not("approved_at", "is", null);
      }
      const { data, error: qErr } = await q
        .order("trip_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(500);
      if (qErr) throw qErr;
      const rows = (data ?? []) as MileageExportRow[];
      const csv = buildMileageLogsCsv(rows);
      const stamp = format(new Date(), "yyyy-MM-dd");
      const scope =
        mileageCsvScope === "all" ? "" : `_${mileageCsvScope}`;
      triggerCsvDownload(`mileage-logs-${stamp}${scope}.csv`, csv);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to export mileage logs.");
    } finally {
      setExportingCsv(false);
    }
  }, [supabase, selectedFacilityId, mileageCsvScope]);

  const pendingCount = pending.length;

  const approve = async (row: MileageRow) => {
    if (!canApprove) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    setBusyId(row.id);
    setError(null);
    try {
      const { error: uErr } = await supabase
        .from("mileage_logs")
        .update({
          approved_at: new Date().toISOString(),
          approved_by: user.id,
          updated_by: user.id,
        })
        .eq("id", row.id)
        .is("approved_at", null);
      if (uErr) throw uErr;
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not approve.");
    } finally {
      setBusyId(null);
    }
  };

  const unapprove = async (row: MileageRow) => {
    if (!canApprove) return;
    if (row.payroll_export_id) {
      setError("This log was included in a payroll export and cannot be unapproved here.");
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    setBusyId(row.id);
    setError(null);
    try {
      const { error: uErr } = await supabase
        .from("mileage_logs")
        .update({
          approved_at: null,
          approved_by: null,
          updated_by: user.id,
        })
        .eq("id", row.id);
      if (uErr) throw uErr;
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not undo approval.");
    } finally {
      setBusyId(null);
    }
  };

  const facilityReady = Boolean(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));

  const list = useMemo(() => (tab === "pending" ? pending : approvedRecent), [tab, pending, approvedRecent]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <></>

      <div className="relative z-10 space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end justify-between bg-card p-8 rounded-[var(--radius)] border border-border shadow-sm mt-4">
          <div className="space-y-2">
            
            <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-foreground flex items-center gap-3">
              <CircleDollarSign className="h-8 w-8 text-success shrink-0" />
              Mileage approvals
            </h1>
            <p className="mt-1 font-medium tracking-wide text-muted-foreground max-w-2xl text-sm">
              Approve staff reimbursement rows before payroll export. Rates and amounts were fixed when each trip was
              logged.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="whitespace-nowrap font-bold uppercase tracking-wider">CSV</span>
              <select
                className="rounded-[var(--radius)] border border-border bg-card px-3 py-2 text-xs text-foreground"
                value={mileageCsvScope}
                onChange={(e) => setMileageCsvScope(e.target.value as MileageCsvScope)}
                aria-label="Mileage CSV scope"
              >
                {MILEAGE_CSV_SCOPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <Button
              type="button"
              variant="outline"
              disabled={!facilityReady || exportingCsv}
              className="h-11 gap-2 rounded-[var(--radius)] text-[10px] font-bold uppercase tracking-wider"
              onClick={() => void exportMileageLogsCsv()}
            >
              <Download className="h-4 w-4" aria-hidden />
              {exportingCsv ? "Preparing…" : "Download mileage CSV"}
            </Button>
            <Link
              href="/admin/transportation"
              className={cn(
                buttonVariants({ variant: "outline", size: "default" }),
                "h-11 rounded-[var(--radius)] gap-2 text-[10px] font-bold uppercase tracking-wider",
              )}
            >
              <ArrowLeft className="h-4 w-4" />
              Hub
            </Link>
          </div>
        </div>

        {!facilityReady && (
          <p className="rounded-[var(--radius)] border border-warning/30 bg-warning/10 px-6 py-4 text-sm text-warning">
            Select a facility first.
          </p>
        )}

        {error && (
          <p className="rounded-[var(--radius)] border border-destructive/30 bg-destructive/10 px-6 py-4 text-sm text-destructive">
            {error}
          </p>
        )}

        {facilityReady && (
          <>
            <div className="flex flex-wrap gap-2 border-b border-border pb-4">
              <button
                type="button"
                onClick={() => setTab("pending")}
                className={cn(
                  "rounded-[var(--radius)] px-5 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors",
                  tab === "pending"
                    ? "bg-primary text-primary-foreground shadow"
                    : "bg-muted text-muted-foreground hover:bg-muted/80",
                )}
              >
                Needs approval
                {pendingCount > 0 ? (
                  <span className="ml-2 rounded-md bg-card/20 px-1.5 py-0.5 tabular-nums">{pendingCount}</span>
                ) : null}
              </button>
              <button
                type="button"
                onClick={() => setTab("approved")}
                className={cn(
                  "rounded-[var(--radius)] px-5 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors",
                  tab === "approved"
                    ? "bg-primary text-primary-foreground shadow"
                    : "bg-muted text-muted-foreground hover:bg-muted/80",
                )}
              >
                Recently approved
              </button>
            </div>

            {!canApprove && actorRole !== null && (
              <p className="text-sm text-warning rounded-[var(--radius)] border border-warning/30 bg-warning/10 px-4 py-3">
                Your role ({actorRole.replace(/_/g, " ")}) can view this list; approval is limited to owner, org admin,
                facility admin, and nurse.
              </p>
            )}

            {loading ? (
              <p className="text-sm text-muted-foreground pl-2">Loading…</p>
            ) : list.length === 0 ? (
              <p className="text-sm text-muted-foreground pl-2">
                {tab === "pending" ? "No mileage logs awaiting approval." : "No approved trips in the recent window."}
              </p>
            ) : (
              <MotionList className="space-y-3">
                {list.map((row) => {
                  const driver = row.staff ? `${row.staff.first_name} ${row.staff.last_name}` : "Staff";
                  const res = row.residents ? `${row.residents.first_name} ${row.residents.last_name}` : null;
                  const isPending = tab === "pending";
                  return (
                    <MotionItem
                      key={row.id}
                      className="flex items-start gap-3 min-h-[36px] px-[13px] py-4 rounded-[9px] border border-border bg-card hover:bg-muted/40 hover:-translate-y-px transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)]"
                    >
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 space-y-1">
                          <p className="text-lg font-semibold text-foreground">{driver}</p>
                          <p className="text-sm text-muted-foreground">
                            {format(parseISO(`${row.trip_date}T12:00:00.000Z`), "MMM d, yyyy")} · {row.purpose}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {row.origin} → {row.destination}
                            {row.round_trip ? " · round trip" : ""}
                          </p>
                          {res ? (
                            <p className="text-xs font-medium text-muted-foreground">Resident: {res}</p>
                          ) : null}
                          <p className="text-sm font-mono text-foreground tabular-nums">
                            {row.miles} mi · {formatUsd(row.reimbursement_amount_cents)}
                            <span className="text-muted-foreground">
                              {" "}
                              @ {(row.reimbursement_rate_cents / 100).toFixed(2)}/mi
                            </span>
                          </p>
                          {row.transport_request_id ? (
                            <Link
                              href={`/admin/transportation/requests/${row.transport_request_id}`}
                              className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-info hover:text-info/80"
                            >
                              <Bus className="h-3.5 w-3.5" />
                              Open transport request
                            </Link>
                          ) : null}
                          {!isPending && row.approved_at ? (
                            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                              Approved {format(parseISO(row.approved_at), "MMM d, yyyy h:mm a")}
                              {row.payroll_export_id ? " · marked for payroll export" : ""}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2 lg:flex-col lg:items-end">
                          {isPending && canApprove ? (
                            <button
                              type="button"
                              disabled={busyId === row.id}
                              onClick={() => void approve(row)}
                              className={cn(
                                buttonVariants({ size: "default" }),
                                "h-10 gap-2 rounded-[var(--radius)] bg-success px-5 text-[10px] font-bold uppercase tracking-wider hover:bg-success/90 text-primary-foreground",
                              )}
                            >
                              <CheckCircle2 className="h-4 w-4" />
                              {busyId === row.id ? "…" : "Approve"}
                            </button>
                          ) : null}
                          {!isPending && canApprove && !row.payroll_export_id ? (
                            <button
                              type="button"
                              disabled={busyId === row.id}
                              onClick={() => void unapprove(row)}
                              className={cn(
                                buttonVariants({ variant: "outline", size: "default" }),
                                "h-10 gap-2 rounded-[var(--radius)] text-[10px] font-bold uppercase tracking-wider",
                              )}
                            >
                              <Undo2 className="h-4 w-4" />
                              {busyId === row.id ? "…" : "Undo approval"}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </MotionItem>
                  );
                })}
              </MotionList>
            )}
          </>
        )}
      </div>
    </div>
  );
}
