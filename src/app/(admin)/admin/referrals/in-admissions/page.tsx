"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Home, Loader2, UserPlus } from "lucide-react";

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
  "id" | "status" | "updated_at" | "target_move_in_date"
>;

type QueueRow = {
  lead: LeadRow;
  admissionCase: AdmissionMini;
};

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
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        .select("id, referral_lead_id, status, updated_at, target_move_in_date")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .in("referral_lead_id", leadIds)
        .not("status", "eq", "cancelled");

      if (admissionErr) throw admissionErr;
      const admissionMap = new Map(
        ((admissionCases ?? []) as Array<AdmissionMini & { referral_lead_id: string | null }>)
          .filter((row) => !!row.referral_lead_id)
          .map((row) => [row.referral_lead_id as string, row]),
      );

      setRows(
        leadRows
          .filter((row) => admissionMap.has(row.id))
          .map((row) => ({
            lead: row,
            admissionCase: admissionMap.get(row.id)!,
          })),
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
            {rows.length} active handoff{rows.length === 1 ? "" : "s"}
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
        <div className="grid gap-4">
          {rows.map(({ lead, admissionCase }) => (
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
                <div className="flex flex-wrap gap-2">
                  <Link href={`/admin/referrals/${lead.id}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                    Referral detail
                  </Link>
                  <Link href={`/admin/admissions/${admissionCase.id}`} className={cn(buttonVariants({ size: "sm" }))}>
                    Open admission case
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
