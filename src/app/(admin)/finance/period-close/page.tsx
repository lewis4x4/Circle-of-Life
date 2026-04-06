"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Lock, LockOpen, RefreshCw } from "lucide-react";

import { FinanceHubNav } from "../finance-hub-nav";
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
import {
  canMutateFinance,
  loadFinanceRoleContext,
} from "@/lib/finance/load-finance-context";

type EntityMini = { id: string; name: string };

type PeriodRow = {
  id: string;
  period_year: number;
  period_month: number;
  status: string;
  closed_at: string | null;
  closed_by: string | null;
};

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

function currentYearMonth(): { y: number; m: number } {
  const d = new Date();
  return { y: d.getFullYear(), m: d.getMonth() + 1 };
}

export default function FinancePeriodClosePage() {
  const supabase = createClient();
  const [entities, setEntities] = useState<EntityMini[]>([]);
  const [entityId, setEntityId] = useState("");
  const [periodYear, setPeriodYear] = useState(() => currentYearMonth().y);
  const [periodMonth, setPeriodMonth] = useState(() => currentYearMonth().m);
  const [history, setHistory] = useState<PeriodRow[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodRow | null>(null);
  const [implicitOpen, setImplicitOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [canMutate, setCanMutate] = useState(false);
  const [ready, setReady] = useState(false);

  const refreshHistory = useCallback(async () => {
    if (!entityId || !orgId) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: qErr } = await supabase
        .from("gl_period_closes")
        .select("id, period_year, period_month, status, closed_at, closed_by")
        .eq("organization_id", orgId)
        .eq("entity_id", entityId)
        .is("deleted_at", null)
        .order("period_year", { ascending: false })
        .order("period_month", { ascending: false })
        .limit(36);

      if (qErr) {
        setError(qErr.message);
        setHistory([]);
        return;
      }
      setHistory((data ?? []) as PeriodRow[]);

      const hit = (data ?? []).find(
        (r) =>
          (r as PeriodRow).period_year === periodYear && (r as PeriodRow).period_month === periodMonth,
      ) as PeriodRow | undefined;
      setSelectedPeriod(hit ?? null);
      setImplicitOpen(!hit);
    } finally {
      setLoading(false);
    }
  }, [supabase, entityId, orgId, periodYear, periodMonth]);

  const init = useCallback(async () => {
    const c = await loadFinanceRoleContext(supabase);
    if (!c.ok) {
      setError(c.error);
      return;
    }
    setCanMutate(canMutateFinance(c.ctx.appRole));
    setOrgId(c.ctx.organizationId);

    const { data: ent } = await supabase
      .from("entities")
      .select("id, name")
      .eq("organization_id", c.ctx.organizationId)
      .is("deleted_at", null)
      .order("name");
    const list = (ent ?? []) as EntityMini[];
    setEntities(list);
    if (list[0]) setEntityId((prev) => prev || list[0].id);
    setReady(true);
  }, [supabase]);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    if (!ready || !entityId || !orgId) return;
    void refreshHistory();
  }, [ready, entityId, orgId, periodYear, periodMonth, refreshHistory]);

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
