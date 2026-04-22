"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Lock, LockOpen, RefreshCw } from "lucide-react";

import { FinanceHubNav } from "@/app/(admin)/finance/finance-hub-nav";
import { AdminLiveDataFallbackNotice } from "@/components/common/admin-list-patterns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/client";
import { loadPeriodCloseData, type PeriodRow } from "@/lib/finance/load-period-close-data";
import type { EntityMini } from "@/lib/finance/load-trial-balance-data";

const MONTHS = [
  { v: 1, label: "January" },
  { v: 2, label: "February" },
  { v: 3, label: "March" },
  { v: 4, label: "April" },
  { v: 5, label: "May" },
  { v: 6, label: "June" },
  { v: 7, label: "July" },
  { v: 8, label: "August" },
  { v: 9, label: "September" },
  { v: 10, label: "October" },
  { v: 11, label: "November" },
  { v: 12, label: "December" },
];

type FinancePeriodClosePageClientProps = {
  initialEntities: EntityMini[];
  initialEntityId: string;
  initialPeriodYear: number;
  initialPeriodMonth: number;
  initialHistory: PeriodRow[];
  initialSelectedPeriod: PeriodRow | null;
  initialImplicitOpen: boolean;
  initialOrgId: string | null;
  initialCanMutate: boolean;
  initialError: string | null;
  initialReady: boolean;
};

export default function FinancePeriodClosePageClient({
  initialEntities,
  initialEntityId,
  initialPeriodYear,
  initialPeriodMonth,
  initialHistory,
  initialSelectedPeriod,
  initialImplicitOpen,
  initialOrgId,
  initialCanMutate,
  initialError,
  initialReady,
}: FinancePeriodClosePageClientProps) {
  const supabase = createClient();
  const initialEntityRef = useRef(initialEntityId);
  const [entities] = useState<EntityMini[]>(initialEntities);
  const [entityId, setEntityId] = useState(initialEntityId);
  const [periodYear, setPeriodYear] = useState(initialPeriodYear);
  const [periodMonth, setPeriodMonth] = useState(initialPeriodMonth);
  const [history, setHistory] = useState<PeriodRow[]>(initialHistory);
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodRow | null>(initialSelectedPeriod);
  const [implicitOpen, setImplicitOpen] = useState(initialImplicitOpen);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [orgId] = useState<string | null>(initialOrgId);
  const [canMutate] = useState(initialCanMutate);
  const [ready] = useState(initialReady);

  const refreshHistory = useCallback(async (nextEntityId = entityId) => {
    if (!nextEntityId || !orgId) return;
    setLoading(true);
    setError(null);
    try {
      const snapshot = await loadPeriodCloseData(
        supabase,
        orgId,
        nextEntityId,
        periodYear,
        periodMonth,
      );
      setHistory(snapshot.history);
      setSelectedPeriod(snapshot.selectedPeriod);
      setImplicitOpen(snapshot.implicitOpen);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Failed to load period close data.");
      setHistory([]);
      setSelectedPeriod(null);
      setImplicitOpen(true);
    } finally {
      setLoading(false);
    }
  }, [entityId, orgId, periodMonth, periodYear, supabase]);

  useEffect(() => {
    if (!ready || !entityId || !orgId) return;
    if (entityId === initialEntityRef.current && periodYear === initialPeriodYear && periodMonth === initialPeriodMonth) {
      initialEntityRef.current = "";
      return;
    }
    void refreshHistory(entityId);
  }, [
    ready,
    entityId,
    orgId,
    periodYear,
    periodMonth,
    initialPeriodYear,
    initialPeriodMonth,
    refreshHistory,
  ]);

  async function closePeriod() {
    if (!canMutate || !orgId || !entityId) return;
    setSaving(true);
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.id) {
        setError("Sign in required.");
        return;
      }
      const now = new Date().toISOString();
      const { error: uErr } = await supabase.from("gl_period_closes").upsert(
        {
          organization_id: orgId,
          entity_id: entityId,
          period_year: periodYear,
          period_month: periodMonth,
          status: "closed",
          closed_at: now,
          closed_by: user.id,
        },
        { onConflict: "entity_id,period_year,period_month" },
      );
      if (uErr) {
        setError(uErr.message);
        return;
      }
      await refreshHistory();
    } finally {
      setSaving(false);
    }
  }

  async function reopenPeriod() {
    if (!canMutate || !selectedPeriod?.id) return;
    setSaving(true);
    setError(null);
    try {
      const { error: uErr } = await supabase
        .from("gl_period_closes")
        .update({
          status: "open",
          closed_at: null,
          closed_by: null,
        })
        .eq("id", selectedPeriod.id);
      if (uErr) {
        setError(uErr.message);
        return;
      }
      await refreshHistory();
    } finally {
      setSaving(false);
    }
  }

  const periodLabel = `${periodYear}-${String(periodMonth).padStart(2, "0")}`;
  const isClosed = selectedPeriod?.status === "closed";

  return (
    <div className="space-y-6">
      <FinanceHubNav />
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Period close</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Month-end GL period status per legal entity (Module 17 Enhanced). Owner and org admin only.
        </p>
      </div>

      {!canMutate && ready ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">View-only</CardTitle>
            <CardDescription>
              Period close records are managed by organization administrators. Switch to an owner or org admin account
              to close or reopen periods.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {error ? <AdminLiveDataFallbackNotice message={error} onRetry={() => void refreshHistory()} /> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Select period</CardTitle>
          <CardDescription>
            Close blocks posting journal entries and billing-to-GL posts dated in a closed month (reopen to post).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="entity">Entity</Label>
            <select
              id="entity"
              className="h-9 min-w-[200px] rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none dark:bg-input/30"
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
            >
              {entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="yr">Year</Label>
            <input
              id="yr"
              type="number"
              min={2000}
              max={2100}
              className="h-9 w-24 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none dark:bg-input/30"
              value={periodYear}
              onChange={(e) => setPeriodYear(Number(e.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mo">Month</Label>
            <select
              id="mo"
              className="h-9 min-w-[140px] rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none dark:bg-input/30"
              value={periodMonth}
              onChange={(e) => setPeriodMonth(Number(e.target.value))}
            >
              {MONTHS.map((m) => (
                <option key={m.v} value={m.v}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void refreshHistory()} disabled={loading}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Refresh
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Status for {periodLabel}</CardTitle>
          <CardDescription>
            {implicitOpen && !selectedPeriod
              ? "No close record yet — period is treated as open."
              : null}
            {selectedPeriod?.status === "closed" ? "This period is closed." : null}
            {selectedPeriod?.status === "open" ? "Explicitly reopened — still open for posting." : null}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {canMutate ? (
            <>
              {!isClosed ? (
                <Button type="button" size="sm" onClick={() => void closePeriod()} disabled={saving || !entityId}>
                  <Lock className="mr-1.5 h-3.5 w-3.5" />
                  {saving ? "Saving…" : "Close period"}
                </Button>
              ) : (
                <Button type="button" variant="outline" size="sm" onClick={() => void reopenPeriod()} disabled={saving}>
                  <LockOpen className="mr-1.5 h-3.5 w-3.5" />
                  {saving ? "Saving…" : "Reopen period"}
                </Button>
              )}
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent periods</CardTitle>
          <CardDescription>Latest period close rows for the selected entity.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-slate-500">No period records yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Closed at</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-sm">
                      {r.period_year}-{String(r.period_month).padStart(2, "0")}
                    </TableCell>
                    <TableCell>{r.status}</TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-400">
                      {r.closed_at
                        ? new Intl.DateTimeFormat("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          }).format(new Date(r.closed_at))
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
