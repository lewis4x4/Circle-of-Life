"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeftRight,
  BookOpen,
  CircleDollarSign,
  Clock,
  ListChecks,
  Loader2,
} from "lucide-react";
import { format, parseISO } from "date-fns";

import {
  AdminEmptyState,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Button, buttonVariants } from "@/components/ui/button";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";
import { MotionItem, MotionList } from "@/components/ui/motion-list";
import { V2Card } from "@/components/ui/v2-card";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database";

type SwapRow = Database["public"]["Tables"]["shift_swap_requests"]["Row"];
type TimeRecordRow = Database["public"]["Tables"]["time_records"]["Row"];
type MileageRow = Database["public"]["Tables"]["mileage_logs"]["Row"] & {
  staff: { first_name: string; last_name: string } | null;
};

type PendingSwap = {
  id: string;
  requestingName: string;
  coveringName: string | null;
  swapType: string;
  reason: string | null;
  createdAt: string;
};

type PendingPunch = {
  id: string;
  staffName: string;
  clockIn: string;
  clockOut: string;
  actualHours: number | null;
};

type PendingMileage = {
  id: string;
  staffName: string;
  tripDate: string;
  purpose: string;
  miles: number;
  reimbursementCents: number;
};

type PendingKbDoc = {
  id: string;
  title: string;
  reviewDueAt: string | null;
};

type StaffMini = {
  id: string;
  first_name: string;
  last_name: string;
};

type QueryError = { message: string };
type QueryResult<T> = { data: T[] | null; error: QueryError | null };

const MILEAGE_APPROVER_ROLES = new Set(["owner", "org_admin", "facility_admin", "nurse"]);

function staffName(s: StaffMini | undefined): string {
  if (!s) return "Unknown staff";
  return `${s.first_name?.trim() ?? ""} ${s.last_name?.trim() ?? ""}`.trim() || "Staff member";
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export default function AdminApprovalsInboxPage() {
  const supabase = createClient();
  const { user, appRole } = useHavenAuth();
  const { selectedFacilityId } = useFacilityStore();

  const [swaps, setSwaps] = useState<PendingSwap[]>([]);
  const [punches, setPunches] = useState<PendingPunch[]>([]);
  const [mileage, setMileage] = useState<PendingMileage[]>([]);
  const [kbDocs, setKbDocs] = useState<PendingKbDoc[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [denyTargetId, setDenyTargetId] = useState<string | null>(null);
  const [denyReason, setDenyReason] = useState("");

  const canApproveMileage = MILEAGE_APPROVER_ROLES.has(appRole);
  const facilityScoped = isValidFacilityIdForQuery(selectedFacilityId);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      let swapQ = supabase
        .from("shift_swap_requests")
        .select("*")
        .eq("status", "pending")
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .limit(100);
      let punchQ = supabase
        .from("time_records")
        .select("id, staff_id, clock_in, clock_out, approved, actual_hours")
        .eq("approved", false)
        .not("clock_out", "is", null)
        .is("deleted_at", null)
        .order("clock_in", { ascending: true })
        .limit(100);
      let mileageQ = supabase
        .from("mileage_logs")
        .select(
          "id, trip_date, purpose, miles, reimbursement_amount_cents, staff_id, staff(first_name, last_name)",
        )
        .is("approved_at", null)
        .is("deleted_at", null)
        .order("trip_date", { ascending: true })
        .limit(100);

      if (facilityScoped) {
        swapQ = swapQ.eq("facility_id", selectedFacilityId as string);
        punchQ = punchQ.eq("facility_id", selectedFacilityId as string);
        mileageQ = mileageQ.eq("facility_id", selectedFacilityId as string);
      }

      const kbQ = supabase
        .from("documents")
        .select("id, title, review_due_at")
        .eq("status", "pending_review")
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .limit(100);

      const [swapRes, punchRes, mileageRes, kbRes] = await Promise.all([
        swapQ as unknown as Promise<QueryResult<SwapRow>>,
        punchQ as unknown as Promise<QueryResult<TimeRecordRow>>,
        mileageQ as unknown as Promise<QueryResult<MileageRow>>,
        kbQ as unknown as Promise<QueryResult<PendingKbDoc & { review_due_at: string | null }>>,
      ]);
      if (swapRes.error) throw swapRes.error;
      if (punchRes.error) throw punchRes.error;
      if (mileageRes.error) throw mileageRes.error;
      if (kbRes.error) throw kbRes.error;

      const swapRows = swapRes.data ?? [];
      const punchRows = punchRes.data ?? [];

      const staffIds = new Set<string>();
      for (const r of swapRows) {
        staffIds.add(r.requesting_staff_id);
        if (r.covering_staff_id) staffIds.add(r.covering_staff_id);
      }
      for (const r of punchRows) staffIds.add(r.staff_id);

      const staffById = new Map<string, StaffMini>();
      if (staffIds.size > 0) {
        const staffRes = (await supabase
          .from("staff")
          .select("id, first_name, last_name")
          .in("id", [...staffIds])
          .is("deleted_at", null)) as unknown as QueryResult<StaffMini>;
        if (staffRes.error) throw staffRes.error;
        for (const s of staffRes.data ?? []) staffById.set(s.id, s);
      }

      setSwaps(
        swapRows.map((r) => ({
          id: r.id,
          requestingName: staffName(staffById.get(r.requesting_staff_id)),
          coveringName: r.covering_staff_id ? staffName(staffById.get(r.covering_staff_id)) : null,
          swapType: r.swap_type,
          reason: r.reason,
          createdAt: r.created_at,
        })),
      );
      setPunches(
        punchRows
          .filter((r): r is TimeRecordRow & { clock_out: string } => r.clock_out !== null)
          .map((r) => ({
            id: r.id,
            staffName: staffName(staffById.get(r.staff_id)),
            clockIn: r.clock_in,
            clockOut: r.clock_out,
            actualHours: r.actual_hours == null ? null : Number(r.actual_hours),
          })),
      );
      setMileage(
        (mileageRes.data ?? []).map((r) => ({
          id: r.id,
          staffName: r.staff ? `${r.staff.first_name} ${r.staff.last_name}` : "Staff member",
          tripDate: r.trip_date,
          purpose: r.purpose,
          miles: Number(r.miles),
          reimbursementCents: r.reimbursement_amount_cents,
        })),
      );
      setKbDocs(
        (kbRes.data ?? []).map((r) => ({
          id: r.id,
          title: r.title,
          reviewDueAt: r.review_due_at,
        })),
      );
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load approvals inbox.");
      setSwaps([]);
      setPunches([]);
      setMileage([]);
      setKbDocs([]);
    } finally {
      setIsLoading(false);
    }
  }, [supabase, selectedFacilityId, facilityScoped]);

  useEffect(() => {
    void load();
  }, [load]);

  const approveSwap = useCallback(
    async (id: string) => {
      setActionId(id);
      setNotice(null);
      try {
        if (!user?.id) {
          setNotice("You must be signed in to approve.");
          return;
        }
        const { error } = await supabase
          .from("shift_swap_requests")
          .update({
            status: "approved",
            approved_at: new Date().toISOString(),
            approved_by: user.id,
            denied_reason: null,
          })
          .eq("id", id)
          .is("deleted_at", null);
        if (error) throw error;
        await load();
      } catch (e) {
        setNotice(e instanceof Error ? e.message : "Could not approve swap request.");
      } finally {
        setActionId(null);
      }
    },
    [supabase, load, user?.id],
  );

  const submitDenySwap = useCallback(async () => {
    if (!denyTargetId) return;
    const reason = denyReason.trim();
    if (!reason) {
      setNotice("Enter a short reason for denial.");
      return;
    }
    setActionId(denyTargetId);
    setNotice(null);
    try {
      if (!user?.id) {
        setNotice("You must be signed in to deny.");
        return;
      }
      const { error } = await supabase
        .from("shift_swap_requests")
        .update({
          status: "denied",
          denied_reason: reason,
          approved_at: null,
          approved_by: null,
        })
        .eq("id", denyTargetId)
        .is("deleted_at", null);
      if (error) throw error;
      setDenyTargetId(null);
      setDenyReason("");
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not deny swap request.");
    } finally {
      setActionId(null);
    }
  }, [denyTargetId, denyReason, supabase, load, user?.id]);

  const approvePunch = useCallback(
    async (id: string) => {
      setActionId(id);
      setNotice(null);
      try {
        if (!user?.id) {
          setNotice("You must be signed in to approve.");
          return;
        }
        const { error } = await supabase
          .from("time_records")
          .update({
            approved: true,
            approved_at: new Date().toISOString(),
            approved_by: user.id,
            updated_by: user.id,
          })
          .eq("id", id)
          .eq("approved", false)
          .not("clock_out", "is", null)
          .is("deleted_at", null);
        if (error) throw error;
        await load();
      } catch (e) {
        setNotice(e instanceof Error ? e.message : "Could not approve time record.");
      } finally {
        setActionId(null);
      }
    },
    [supabase, load, user?.id],
  );

  const approveMileage = useCallback(
    async (id: string) => {
      if (!canApproveMileage) return;
      setActionId(id);
      setNotice(null);
      try {
        if (!user?.id) {
          setNotice("You must be signed in to approve.");
          return;
        }
        const { error } = await supabase
          .from("mileage_logs")
          .update({
            approved_at: new Date().toISOString(),
            approved_by: user.id,
            updated_by: user.id,
          })
          .eq("id", id)
          .is("approved_at", null);
        if (error) throw error;
        await load();
      } catch (e) {
        setNotice(e instanceof Error ? e.message : "Could not approve mileage log.");
      } finally {
        setActionId(null);
      }
    },
    [supabase, canApproveMileage, load, user?.id],
  );

  const totalWaiting = swaps.length + punches.length + mileage.length + kbDocs.length;
  const isEmpty = !isLoading && !loadError && totalWaiting === 0;

  const summaryCards = useMemo(
    () => [
      { label: "Shift swaps", count: swaps.length, icon: ArrowLeftRight, href: "/admin/shift-swaps" },
      { label: "Time punches", count: punches.length, icon: Clock, href: "/admin/time-records" },
      {
        label: "Mileage",
        count: mileage.length,
        icon: CircleDollarSign,
        href: "/admin/transportation/mileage-approvals",
      },
      { label: "KB publish reviews", count: kbDocs.length, icon: BookOpen, href: "/admin/knowledge/admin" },
    ],
    [swaps.length, punches.length, mileage.length, kbDocs.length],
  );

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6">
        <header className="mb-6">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-3">
            <ListChecks className="h-8 w-8 text-primary shrink-0" aria-hidden />
            Approvals inbox
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Everything waiting on an approver, in one queue: shift swaps, completed time punches,
            mileage reimbursements, and knowledge-base publish reviews. Actions here write the same
            records as the source hubs (RLS-scoped).
            {facilityScoped
              ? " Staff queues follow your facility selector; KB reviews are organization-wide."
              : " Showing all facilities your role can access."}
          </p>
        </header>

        <KineticGrid className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-2" staggerMs={60}>
          <div className="h-[120px]">
            <V2Card hoverColor="orange" className="p-5">
              <MonolithicWatermark value={totalWaiting} className="text-warning/10 opacity-50" />
              <div className="relative z-10 flex h-full flex-col justify-center">
                <h3 className="text-[10px] font-medium tracking-wider uppercase text-warning">
                  Waiting on me
                </h3>
                <p className="text-3xl font-mono tracking-tighter text-warning tabular-nums">
                  {totalWaiting}
                </p>
              </div>
            </V2Card>
          </div>
          {summaryCards.map((card) => {
            const Icon = card.icon;
            return (
              <div key={card.label} className="h-[120px]">
                <V2Card hoverColor="blue" className="p-5">
                  <div className="relative z-10 flex h-full flex-col justify-center gap-1">
                    <h3 className="text-[10px] font-medium tracking-wider uppercase text-muted-foreground flex items-center gap-2">
                      <Icon className="h-3.5 w-3.5" aria-hidden /> {card.label}
                    </h3>
                    <p className="text-3xl font-mono tracking-tighter text-foreground tabular-nums">
                      {card.count}
                    </p>
                    <Link
                      href={card.href}
                      className="text-[11px] font-medium text-info hover:text-info/80"
                    >
                      Open hub
                    </Link>
                  </div>
                </V2Card>
              </div>
            );
          })}
        </KineticGrid>

        {notice ? (
          <div
            className="rounded-[var(--radius)] border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning"
            role="status"
          >
            {notice}
          </div>
        ) : null}

        {isLoading ? <AdminTableLoadingState /> : null}
        {!isLoading && loadError ? (
          <AdminLiveDataFallbackNotice message={loadError} onRetry={() => void load()} />
        ) : null}
        {isEmpty ? (
          <AdminEmptyState
            title="Nothing waiting on you"
            description="No pending shift swaps, time punches, mileage logs, or KB publish reviews in this scope."
          />
        ) : null}

        {!isLoading && !loadError && swaps.length > 0 ? (
          <section aria-labelledby="approvals-swaps-heading" className="space-y-3">
            <div className="flex items-center justify-between gap-3 px-[13px] py-2 rounded-[var(--radius)] border border-border bg-card/60">
              <h3 id="approvals-swaps-heading" className="text-lg font-semibold text-foreground flex items-center gap-2">
                <ArrowLeftRight className="h-4 w-4 text-info" aria-hidden />
                Shift swaps
                <span className="text-sm font-normal text-muted-foreground tabular-nums">{swaps.length}</span>
              </h3>
              <Link href="/admin/shift-swaps" className="text-xs font-medium text-info hover:text-info/80">
                Open shift swaps hub
              </Link>
            </div>
            <MotionList className="space-y-3">
              {swaps.map((row) => (
                <MotionItem key={row.id}>
                  <div className="flex flex-col gap-3 min-h-[36px] px-[13px] py-2 rounded-[9px] border border-border bg-card hover:bg-muted/40 hover:-translate-y-px transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] lg:flex-row lg:items-center lg:justify-between w-full">
                    <div className="flex flex-col gap-1 min-w-0 flex-1">
                      <span className="font-semibold text-foreground truncate">
                        {row.requestingName}
                        <span className="text-muted-foreground font-normal"> → </span>
                        {row.coveringName ?? "—"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(row.createdAt)} · {row.swapType}
                      </span>
                      {row.reason ? (
                        <span className="text-xs text-muted-foreground line-clamp-2">{row.reason}</span>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <Button
                        type="button"
                        size="sm"
                        className="font-medium text-[10px] uppercase tracking-wider"
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
                        className="font-medium text-[10px] uppercase tracking-wider"
                        disabled={actionId !== null}
                        onClick={() => {
                          setDenyTargetId(row.id);
                          setDenyReason("");
                          setNotice(null);
                        }}
                      >
                        Deny
                      </Button>
                    </div>
                  </div>
                </MotionItem>
              ))}
            </MotionList>
          </section>
        ) : null}

        {!isLoading && !loadError && punches.length > 0 ? (
          <section aria-labelledby="approvals-punches-heading" className="space-y-3">
            <div className="flex items-center justify-between gap-3 px-[13px] py-2 rounded-[var(--radius)] border border-border bg-card/60">
              <h3 id="approvals-punches-heading" className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Clock className="h-4 w-4 text-warning" aria-hidden />
                Time punches
                <span className="text-sm font-normal text-muted-foreground tabular-nums">{punches.length}</span>
              </h3>
              <Link href="/admin/time-records" className="text-xs font-medium text-info hover:text-info/80">
                Open time records hub
              </Link>
            </div>
            <MotionList className="space-y-3">
              {punches.map((row) => (
                <MotionItem key={row.id}>
                  <div className="flex flex-col gap-3 min-h-[36px] px-[13px] py-2 rounded-[9px] border border-border bg-card hover:bg-muted/40 hover:-translate-y-px transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] lg:flex-row lg:items-center lg:justify-between w-full">
                    <div className="flex flex-col gap-1 min-w-0 flex-1">
                      <span className="font-semibold text-foreground truncate">{row.staffName}</span>
                      <span className="text-xs text-muted-foreground font-mono tabular-nums">
                        {formatDateTime(row.clockIn)} → {formatDateTime(row.clockOut)}
                        {row.actualHours != null ? ` · ${row.actualHours.toFixed(2)} h` : ""}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <Button
                        type="button"
                        size="sm"
                        className="font-medium text-[10px] uppercase tracking-wider"
                        disabled={actionId !== null}
                        onClick={() => void approvePunch(row.id)}
                      >
                        {actionId === row.id ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />
                        ) : null}
                        Approve
                      </Button>
                    </div>
                  </div>
                </MotionItem>
              ))}
            </MotionList>
          </section>
        ) : null}

        {!isLoading && !loadError && mileage.length > 0 ? (
          <section aria-labelledby="approvals-mileage-heading" className="space-y-3">
            <div className="flex items-center justify-between gap-3 px-[13px] py-2 rounded-[var(--radius)] border border-border bg-card/60">
              <h3 id="approvals-mileage-heading" className="text-lg font-semibold text-foreground flex items-center gap-2">
                <CircleDollarSign className="h-4 w-4 text-success" aria-hidden />
                Mileage reimbursements
                <span className="text-sm font-normal text-muted-foreground tabular-nums">{mileage.length}</span>
              </h3>
              <Link
                href="/admin/transportation/mileage-approvals"
                className="text-xs font-medium text-info hover:text-info/80"
              >
                Open mileage approvals
              </Link>
            </div>
            {!canApproveMileage && appRole !== null ? (
              <p className="text-sm text-warning rounded-[var(--radius)] border border-warning/30 bg-warning/10 px-4 py-3">
                Your role ({appRole.replace(/_/g, " ")}) can view mileage rows; approval is limited to
                owner, org admin, facility admin, and nurse.
              </p>
            ) : null}
            <MotionList className="space-y-3">
              {mileage.map((row) => (
                <MotionItem key={row.id}>
                  <div className="flex flex-col gap-3 min-h-[36px] px-[13px] py-2 rounded-[9px] border border-border bg-card hover:bg-muted/40 hover:-translate-y-px transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] lg:flex-row lg:items-center lg:justify-between w-full">
                    <div className="flex flex-col gap-1 min-w-0 flex-1">
                      <span className="font-semibold text-foreground truncate">{row.staffName}</span>
                      <span className="text-xs text-muted-foreground">
                        {format(parseISO(`${row.tripDate}T12:00:00.000Z`), "MMM d, yyyy")} · {row.purpose}
                      </span>
                      <span className="text-xs font-mono text-foreground tabular-nums">
                        {row.miles} mi · {formatUsd(row.reimbursementCents)}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {canApproveMileage ? (
                        <Button
                          type="button"
                          size="sm"
                          className="font-medium text-[10px] uppercase tracking-wider"
                          disabled={actionId !== null}
                          onClick={() => void approveMileage(row.id)}
                        >
                          {actionId === row.id ? (
                            <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />
                          ) : null}
                          Approve
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </MotionItem>
              ))}
            </MotionList>
          </section>
        ) : null}

        {!isLoading && !loadError && kbDocs.length > 0 ? (
          <section aria-labelledby="approvals-kb-heading" className="space-y-3">
            <div className="flex items-center justify-between gap-3 px-[13px] py-2 rounded-[var(--radius)] border border-border bg-card/60">
              <h3 id="approvals-kb-heading" className="text-lg font-semibold text-foreground flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-info" aria-hidden />
                KB publish reviews
                <span className="text-sm font-normal text-muted-foreground tabular-nums">{kbDocs.length}</span>
              </h3>
              <Link href="/admin/knowledge/admin" className="text-xs font-medium text-info hover:text-info/80">
                Open KB admin
              </Link>
            </div>
            <p className="text-xs text-muted-foreground px-[13px]">
              Publishing requires the full review workflow (draft → review → publish), so these rows
              open the KB review surface rather than approving in place. Organization-wide scope.
            </p>
            <MotionList className="space-y-3">
              {kbDocs.map((doc) => (
                <MotionItem key={doc.id}>
                  <div className="flex flex-col gap-3 min-h-[36px] px-[13px] py-2 rounded-[9px] border border-border bg-card hover:bg-muted/40 hover:-translate-y-px transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] lg:flex-row lg:items-center lg:justify-between w-full">
                    <div className="flex flex-col gap-1 min-w-0 flex-1">
                      <span className="font-semibold text-foreground truncate">{doc.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {doc.reviewDueAt
                          ? `Review due ${format(parseISO(doc.reviewDueAt), "MMM d, yyyy")}`
                          : "No review due date"}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <Link
                        href={`/admin/knowledge/admin/review/${doc.id}`}
                        className={cn(
                          buttonVariants({ variant: "outline", size: "sm" }),
                          "font-medium text-[10px] uppercase tracking-wider",
                        )}
                      >
                        Open review
                      </Link>
                    </div>
                  </div>
                </MotionItem>
              ))}
            </MotionList>
          </section>
        ) : null}

        {denyTargetId ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="inbox-deny-swap-title"
          >
            <div className="w-full max-w-md rounded-[var(--radius)] border border-border bg-card p-5 shadow-lg">
              <h3 id="inbox-deny-swap-title" className="text-lg font-semibold text-foreground">
                Deny swap request
              </h3>
              <p className="text-sm text-muted-foreground mt-1 mb-3">
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
                  onClick={() => void submitDenySwap()}
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
