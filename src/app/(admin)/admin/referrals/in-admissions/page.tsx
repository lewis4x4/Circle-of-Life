"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, DoorOpen, Home, Loader2, UserPlus } from "lucide-react";

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

type LeadRow = Pick<
  Database["public"]["Tables"]["referral_leads"]["Row"],
  | "id"
  | "first_name"
  | "last_name"
  | "preferred_name"
  | "status"
  | "updated_at"
> & {
  referral_sources: { name: string } | null;
};

type AdmissionMini = Pick<
  Database["public"]["Tables"]["admission_cases"]["Row"],
  | "id"
  | "status"
  | "updated_at"
  | "target_move_in_date"
  | "resident_id"
  | "financial_clearance_at"
  | "physician_orders_received_at"
  | "bed_id"
>;

type HandoffPhase = "blocked" | "ready" | "onboarding" | "complete";

type QueueRow = {
  lead: LeadRow;
  admissionCase: AdmissionMini;
  handoffPhase: HandoffPhase;
  nextActionLabel: string;
  nextActionHref: string;
  onboardingMissing: string[];
  readinessMissing: string[];
};

type PhaseFilter = "all" | HandoffPhase;

function formatStatus(value: string): string {
  return value.replace(/_/g, " ");
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

export default function AdminReferralsInAdmissionsPage() {
  const supabase = useMemo(() => createClient(), []);
  const { selectedFacilityId } = useFacilityStore();
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [phaseFilter, setPhaseFilter] = useState<PhaseFilter>("all");
  const requestedPhase = searchParams.get("phase");

  useEffect(() => {
    if (requestedPhase === "blocked" || requestedPhase === "ready" || requestedPhase === "onboarding" || requestedPhase === "complete") {
      setPhaseFilter(requestedPhase);
      return;
    }
    setPhaseFilter("all");
  }, [requestedPhase]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setRows([]);
      setLoading(false);
      return;
    }

    try {
      const { data: leads, error: leadErr } = await supabase
        .from("referral_leads")
        .select("id, first_name, last_name, preferred_name, status, updated_at, referral_sources(name)")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .not("status", "in", "(converted,lost,merged)")
        .order("updated_at", { ascending: false });

      if (leadErr) throw leadErr;
      const leadRows = (leads ?? []) as LeadRow[];
      const leadIds = leadRows.map((row) => row.id);
      if (leadIds.length === 0) {
        setRows([]);
        return;
      }

      const { data: admissionCases, error: admissionErr } = await supabase
        .from("admission_cases")
        .select("id, referral_lead_id, status, updated_at, target_move_in_date, resident_id, financial_clearance_at, physician_orders_received_at, bed_id")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .in("referral_lead_id", leadIds)
        .not("status", "eq", "cancelled");

      if (admissionErr) throw admissionErr;
      const admissionRows = (admissionCases ?? []) as Array<AdmissionMini & { referral_lead_id: string | null }>;
      const residentIds = Array.from(
        new Set(
          admissionRows
            .map((row) => row.resident_id)
            .filter((value): value is string => typeof value === "string" && value.length > 0),
        ),
      );
      const [carePlansRes, medsRes, payersRes, consentsRes] =
        residentIds.length > 0
          ? await Promise.all([
              supabase.from("care_plans").select("resident_id").in("resident_id", residentIds).is("deleted_at", null),
              supabase.from("resident_medications").select("resident_id").in("resident_id", residentIds).is("deleted_at", null),
              supabase.from("resident_payers").select("resident_id").in("resident_id", residentIds).is("deleted_at", null),
              supabase.from("family_consent_records").select("resident_id").in("resident_id", residentIds).is("deleted_at", null),
            ])
          : [
              { data: [], error: null },
              { data: [], error: null },
              { data: [], error: null },
              { data: [], error: null },
            ];

      if (carePlansRes.error) throw carePlansRes.error;
      if (medsRes.error) throw medsRes.error;
      if (payersRes.error) throw payersRes.error;
      if (consentsRes.error) throw consentsRes.error;

      const carePlanIds = new Set((carePlansRes.data ?? []).map((row) => row.resident_id));
      const medIds = new Set((medsRes.data ?? []).map((row) => row.resident_id));
      const payerIds = new Set((payersRes.data ?? []).map((row) => row.resident_id));
      const consentIds = new Set((consentsRes.data ?? []).map((row) => row.resident_id));

      const admissionMap = new Map(
        admissionRows
          .filter((row) => !!row.referral_lead_id)
          .map((row) => [row.referral_lead_id as string, row]),
      );

      setRows(
        leadRows
          .filter((row) => admissionMap.has(row.id))
          .map((row) => {
            const admissionCase = admissionMap.get(row.id)!;
            const readinessMissing = [
              !admissionCase.financial_clearance_at ? "financial clearance" : null,
              !admissionCase.physician_orders_received_at ? "physician orders" : null,
              !admissionCase.bed_id ? "bed assignment" : null,
              !admissionCase.target_move_in_date ? "move-in date" : null,
            ].filter((value): value is string => Boolean(value));

            const onboardingMissing =
              admissionCase.status === "move_in" && admissionCase.resident_id
                ? [
                    !carePlanIds.has(admissionCase.resident_id) ? "care plan" : null,
                    !medIds.has(admissionCase.resident_id) ? "medications" : null,
                    !payerIds.has(admissionCase.resident_id) ? "billing" : null,
                    !consentIds.has(admissionCase.resident_id) ? "family consent" : null,
                  ].filter((value): value is string => Boolean(value))
                : [];

            let handoffPhase: HandoffPhase = "complete";
            let nextActionLabel = "Open admission case";
            let nextActionHref = `/admin/admissions/${admissionCase.id}`;

            if (readinessMissing.length > 0) {
              handoffPhase = "blocked";
              nextActionLabel = "Clear blockers";
              nextActionHref = "/admin/admissions/blocked";
            } else if (admissionCase.status !== "move_in") {
              handoffPhase = "ready";
              nextActionLabel = "Advance move-in";
              nextActionHref = "/admin/admissions/move-in-ready";
            } else if (onboardingMissing.length > 0) {
              handoffPhase = "onboarding";
              nextActionLabel = "Finish onboarding";
              nextActionHref = "/admin/admissions/onboarding";
            }

            return {
              lead: row,
              admissionCase,
              handoffPhase,
              nextActionLabel,
              nextActionHref,
              onboardingMissing,
              readinessMissing,
            };
          }),
      );
    } catch (loadError) {
      setRows([]);
      setError(loadError instanceof Error ? loadError.message : "Could not load referral handoff queue.");
    } finally {
      setLoading(false);
    }
  }, [selectedFacilityId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleRows = rows.filter((row) => phaseFilter === "all" || row.handoffPhase === phaseFilter);
  const phaseCounts = {
    all: rows.length,
    blocked: rows.filter((row) => row.handoffPhase === "blocked").length,
    ready: rows.filter((row) => row.handoffPhase === "ready").length,
    onboarding: rows.filter((row) => row.handoffPhase === "onboarding").length,
    complete: rows.filter((row) => row.handoffPhase === "complete").length,
  };

  function phaseBadge(row: QueueRow) {
    if (row.handoffPhase === "blocked") {
      return <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">Blocked</Badge>;
    }
    if (row.handoffPhase === "ready") {
      return <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">Move-in ready</Badge>;
    }
    if (row.handoffPhase === "onboarding") {
      return <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700">Onboarding pending</Badge>;
    }
    return <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">Handoff stable</Badge>;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="space-y-2">
        <Link href="/admin/referrals" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}>
          <ArrowLeft className="h-4 w-4" />
          Referral CRM
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-zinc-100">Referral Handoff Queue</h1>
            <p className="text-sm text-slate-500 dark:text-zinc-400">
              Referral leads already handed off into admissions work.
            </p>
          </div>
          <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
            {phaseFilter === "all" ? rows.length : visibleRows.length} {phaseFilter === "all" ? "active" : "visible"} handoff{(phaseFilter === "all" ? rows.length : visibleRows.length) === 1 ? "" : "s"}
          </Badge>
        </div>
      </div>

      {loading ? (
        <AdminTableLoadingState />
      ) : error ? (
        <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} />
      ) : rows.length === 0 ? (
        <AdminEmptyState
          title="No active admissions handoffs"
          description="No referral leads in this facility are currently tied to a live admission case."
        />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {([
              { value: "all", label: `All (${phaseCounts.all})` },
              { value: "blocked", label: `Blocked (${phaseCounts.blocked})` },
              { value: "ready", label: `Ready (${phaseCounts.ready})` },
              { value: "onboarding", label: `Onboarding (${phaseCounts.onboarding})` },
              { value: "complete", label: `Stable (${phaseCounts.complete})` },
            ] as Array<{ value: PhaseFilter; label: string }>).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setPhaseFilter(option.value)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                  phaseFilter === option.value
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          {phaseFilter !== "all" ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700">
                Phase filter: {phaseFilter === "complete" ? "stable" : phaseFilter.replace(/_/g, " ")}
              </Badge>
              <Link href="/admin/referrals/in-admissions" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-8 px-2 text-xs")}>
                Clear phase filter
              </Link>
            </div>
          ) : null}

        <div className="grid gap-4">
          {visibleRows.length === 0 ? (
            <AdminEmptyState
              title="No handoffs in this filter"
              description="Try another handoff filter to inspect the rest of the referral-to-admissions bridge."
            />
          ) : visibleRows.map((row) => {
            const { lead, admissionCase } = row;
            return (
            <Card key={lead.id} className="border-slate-200/70 shadow-soft dark:border-slate-800">
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-lg font-semibold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
                      <UserPlus className="h-4 w-4 text-indigo-500" />
                      {lead.first_name} {lead.last_name}
                      {lead.preferred_name ? (
                        <span className="text-base font-normal text-slate-500 dark:text-zinc-400">({lead.preferred_name})</span>
                      ) : null}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      Source: {lead.referral_sources?.name ?? "—"} · Lead status: {formatStatus(lead.status)}
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                      In admissions
                    </Badge>
                    {phaseBadge(row)}
                    <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700">
                      {formatStatus(admissionCase.status)}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-400">Lead updated</div>
                    <div className="mt-1 text-slate-900 dark:text-zinc-100">{formatRelative(lead.updated_at)}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-400">Case target move-in</div>
                    <div className="mt-1 text-slate-900 dark:text-zinc-100">{admissionCase.target_move_in_date ?? "—"}</div>
                  </div>
                </div>
                {row.readinessMissing.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {row.readinessMissing.map((item) => (
                      <Badge key={item} variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                        {item}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                {row.onboardingMissing.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {row.onboardingMissing.map((item) => (
                      <Badge key={item} variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700">
                        {item}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Link href={`/admin/referrals/${lead.id}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                    Referral detail
                  </Link>
                  <Link href={row.nextActionHref} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                    {row.handoffPhase === "blocked" ? <DoorOpen className="mr-2 h-4 w-4" /> : row.handoffPhase === "onboarding" ? <CheckCircle2 className="mr-2 h-4 w-4" /> : <Home className="mr-2 h-4 w-4" />}
                    {row.nextActionLabel}
                  </Link>
                  <Link href={`/admin/admissions/${admissionCase.id}`} className={cn(buttonVariants({ size: "sm" }))}>
                    Open admission case
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </div>
              </CardContent>
            </Card>
          )})}
        </div>
        </div>
      )}
    </div>
  );
}
