"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Bus, CheckCircle2, CircleDollarSign, Undo2 } from "lucide-react";
import { format, parseISO } from "date-fns";

import { buttonVariants } from "@/components/ui/button";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { MotionItem, MotionList } from "@/components/ui/motion-list";

type MileageRow = Database["public"]["Tables"]["mileage_logs"]["Row"] & {
  staff: { first_name: string; last_name: string } | null;
  residents: { first_name: string; last_name: string } | null;
};

const APPROVER_ROLES = new Set(["owner", "org_admin", "facility_admin", "nurse"]);

function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

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
      <AmbientMatrix hasCriticals={false} primaryClass="bg-emerald-700/10" secondaryClass="bg-slate-900/10" />

      <div className="relative z-10 space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 mb-2">
              SYS: Module 15 — Mileage
            </div>
            <h1 className="font-display text-3xl md:text-4xl font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-3">
              <CircleDollarSign className="h-8 w-8 text-emerald-600 dark:text-emerald-400 shrink-0" />
              Mileage approvals
            </h1>
            <p className="mt-1 font-medium tracking-wide text-slate-600 dark:text-zinc-400 max-w-2xl text-sm">
              Approve staff reimbursement rows before payroll export. Rates and amounts were fixed when each trip was
              logged.
            </p>
          </div>
          <Link
            href="/admin/transportation"
            className={cn(
              buttonVariants({ variant: "outline", size: "default" }),
              "h-11 rounded-full gap-2 text-[10px] font-bold uppercase tracking-widest",
            )}
          >
            <ArrowLeft className="h-4 w-4" />
            Hub
          </Link>
        </div>

        {!facilityReady && (
          <p className="rounded-[1.5rem] border border-amber-200 bg-amber-50 px-6 py-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
            Select a facility first.
          </p>
        )}

        {error && (
          <p className="rounded-[1.5rem] border border-red-200 bg-red-50 px-6 py-4 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100">
            {error}
          </p>
        )}

        {facilityReady && (
          <>
            <div className="flex flex-wrap gap-2 border-b border-slate-200/80 pb-4 dark:border-white/10">
              <button
                type="button"
                onClick={() => setTab("pending")}
                className={cn(
                  "rounded-full px-5 py-2 text-[10px] font-bold uppercase tracking-widest transition-colors",
                  tab === "pending"
                    ? "bg-emerald-600 text-white shadow"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/10 dark:text-slate-300",
                )}
              >
                Needs approval
                {pendingCount > 0 ? (
                  <span className="ml-2 rounded-md bg-white/20 px-1.5 py-0.5 tabular-nums">{pendingCount}</span>
                ) : null}
              </button>
              <button
                type="button"
                onClick={() => setTab("approved")}
                className={cn(
                  "rounded-full px-5 py-2 text-[10px] font-bold uppercase tracking-widest transition-colors",
                  tab === "approved"
                    ? "bg-emerald-600 text-white shadow"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/10 dark:text-slate-300",
                )}
              >
                Recently approved
              </button>
            </div>

            {!canApprove && actorRole !== null && (
              <p className="text-sm text-amber-800 dark:text-amber-200 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-950/30">
                Your role ({actorRole.replace(/_/g, " ")}) can view this list; approval is limited to owner, org admin,
                facility admin, and nurse.
              </p>
            )}

            {loading ? (
              <p className="text-sm font-mono text-slate-500 pl-2">Loading…</p>
            ) : list.length === 0 ? (
              <p className="text-sm text-slate-600 dark:text-slate-400 pl-2">
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
                      className="rounded-[1.5rem] border border-slate-200/90 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.03]"
                    >
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 space-y-1">
                          <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">{driver}</p>
                          <p className="text-sm text-slate-600 dark:text-slate-400">
                            {format(parseISO(`${row.trip_date}T12:00:00.000Z`), "MMM d, yyyy")} · {row.purpose}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-500">
                            {row.origin} → {row.destination}
                            {row.round_trip ? " · round trip" : ""}
                          </p>
                          {res ? (
                            <p className="text-xs font-medium text-slate-600 dark:text-slate-400">Resident: {res}</p>
                          ) : null}
                          <p className="text-sm font-mono text-slate-700 dark:text-slate-300">
                            {row.miles} mi · {formatUsd(row.reimbursement_amount_cents)}
                            <span className="text-slate-400 dark:text-slate-500">
                              {" "}
                              @ {(row.reimbursement_rate_cents / 100).toFixed(2)}/mi
                            </span>
                          </p>
                          {row.transport_request_id ? (
                            <Link
                              href={`/admin/transportation/requests/${row.transport_request_id}`}
                              className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
                            >
                              <Bus className="h-3.5 w-3.5" />
                              Open transport request
                            </Link>
                          ) : null}
                          {!isPending && row.approved_at ? (
                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
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
                                "h-10 gap-2 rounded-full bg-emerald-600 px-5 text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-700 text-white",
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
                                "h-10 gap-2 rounded-full text-[10px] font-bold uppercase tracking-widest",
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
