"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarDays, CheckCircle2, Home, Loader2 } from "lucide-react";

import {
  AdminEmptyState,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { formatColLabel } from "@/lib/col-labels";
import { formatLiveDataLoadError } from "@/lib/live-data-fallback";
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

function admissionReady(row: CaseRow): boolean {
  return Boolean(
    row.financial_clearance_at &&
      row.physician_orders_received_at &&
      row.bed_id &&
      row.target_move_in_date &&
      row.status !== "cancelled",
  );
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

export default function AdminMoveInReadyPage() {
  const supabase = useMemo(() => createClient(), []);
  const { selectedFacilityId } = useFacilityStore();
  const { user } = useHavenAuth();

  const [rows, setRows] = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

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
        .order("target_move_in_date", { ascending: true });

      if (queryError) throw queryError;
      setRows(((data ?? []) as CaseRow[]).filter(admissionReady));
    } catch (loadError) {
      setRows([]);
      setError(formatLiveDataLoadError(loadError, "Could not load move-in ready cases."));
    } finally {
      setLoading(false);
    }
  }, [selectedFacilityId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

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
    <div className="space-y-6 animate-in fade-in duration-[var(--motion-duration-micro)]">
      <div className="space-y-2">
        <Link href="/admin/admissions" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}>
          <ArrowLeft className="h-4 w-4" />
          Admissions hub
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Move-In Ready</h1>
            <p className="text-sm text-muted-foreground">
              Admission cases with core readiness items complete and ready to progress into operations.
            </p>
          </div>
          <Badge variant="outline" className="bg-success/10 text-success border-success/30">
            {rows.length} ready
          </Badge>
        </div>
      </div>

      {loading ? (
        <AdminTableLoadingState />
      ) : error ? (
        <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} />
      ) : rows.length === 0 ? (
        <AdminEmptyState
          title="No move-in ready admissions"
          description="No cases currently meet the core move-in readiness criteria in this scope."
        />
      ) : (
        <div className="space-y-4">
          {actionError ? (
            <div className="rounded-[var(--radius)] border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {actionError}
            </div>
          ) : null}
          {actionMessage ? (
            <div className="rounded-[var(--radius)] border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
              {actionMessage}
            </div>
          ) : null}
        <div className="grid gap-4">
          {rows.map((row) => (
            <Card key={row.id} className="rounded-[9px] border-border hover:-translate-y-px transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)]">
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-lg font-semibold text-foreground flex items-center gap-2">
                      <Home className="h-4 w-4 text-success" />
                      {row.residents ? `${row.residents.first_name} ${row.residents.last_name}` : "Unlinked case"}
                    </CardTitle>
                    <CardDescription className="mt-1">Admission case {row.id}</CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline" className="bg-success/10 text-success border-success/30">
                      <CheckCircle2 className="mr-1 h-3 w-3" />
                      Ready
                    </Badge>
                    {row.target_move_in_date ? (
                      <Badge variant="outline" className="bg-info/10 text-info border-info/30">
                        <CalendarDays className="mr-1 h-3 w-3" />
                        {row.target_move_in_date}
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Last updated</div>
                    <div className="mt-1 text-foreground">{formatRelative(row.updated_at)}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Current status</div>
                    <div className="mt-1 text-foreground">{formatColLabel(row.status)}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/admin/admissions/${row.id}`} className={cn(buttonVariants({ size: "sm" }))}>
                    Open case
                  </Link>
                  {row.status === "pending_clearance" ? (
                    <button
                      type="button"
                      disabled={actionLoading === row.id}
                      onClick={() => void updateCase(row.id, { status: "bed_reserved" }, "Case advanced to bed reserved.")}
                      className="rounded-[var(--radius)] border border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition-all duration-[var(--motion-duration-micro)] hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {actionLoading === row.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Advance to bed reserved"}
                    </button>
                  ) : null}
                  {row.status !== "move_in" ? (
                    <button
                      type="button"
                      disabled={actionLoading === row.id}
                      onClick={() => void updateCase(row.id, { status: "move_in" }, "Case advanced to move-in.")}
                      className="rounded-[var(--radius)] bg-success px-3 py-2 text-xs font-medium text-background transition-all duration-[var(--motion-duration-micro)] hover:bg-success/90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {actionLoading === row.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Advance to move-in"}
                    </button>
                  ) : (
                    <span className="rounded-[var(--radius)] bg-success/10 px-3 py-2 text-xs text-success">
                      Move-in status already set. Continue downstream onboarding.
                    </span>
                  )}
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
