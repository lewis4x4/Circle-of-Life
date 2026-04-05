"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Download } from "lucide-react";

import { FinanceHubNav } from "../finance-hub-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { canMutateFinance, loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { formatCents, parseDollarsToCents } from "@/lib/finance/format-cents";

type EntityMini = { id: string; name: string };
type GlMini = { id: string; code: string; name: string; account_type: string };
type BudgetRow = { id: string; gl_account_id: string; period_start: string; amount_cents: number };

type VarianceRow = {
  gl_account_id: string;
  code: string;
  name: string;
  account_type: string;
  budget_cents: number;
  actual_cents: number;
  variance_cents: number;
};

function firstOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function lastOfMonth(): string {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return last.toISOString().slice(0, 10);
}

export default function BudgetPage() {
  const supabase = createClient();
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof loadFinanceRoleContext>> | null>(null);
  const [entities, setEntities] = useState<EntityMini[]>([]);
  const [entityId, setEntityId] = useState("");
  const [accounts, setAccounts] = useState<GlMini[]>([]);
  const [period, setPeriod] = useState(firstOfMonth);
  const [dateTo, setDateTo] = useState(lastOfMonth);
  const [budgets, setBudgets] = useState<BudgetRow[]>([]);
  const [variance, setVariance] = useState<VarianceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [addAccountId, setAddAccountId] = useState("");
  const [addAmount, setAddAmount] = useState("");
  const [saving, setSaving] = useState(false);

  const init = useCallback(async () => {
    const c = await loadFinanceRoleContext(supabase);
    setCtx(c);
    if (!c.ok) {
      setError(c.error);
      return;
    }
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

  const loadData = useCallback(async () => {
    if (!entityId || !period) return;
    const [{ data: accs }, { data: bRows }] = await Promise.all([
      supabase
        .from("gl_accounts")
        .select("id, code, name, account_type")
        .eq("entity_id", entityId)
        .is("deleted_at", null)
        .order("code"),
      supabase
        .from("gl_budget_lines")
        .select("id, gl_account_id, period_start, amount_cents")
        .eq("entity_id", entityId)
        .eq("period_start", period)
        .is("deleted_at", null),
    ]);
    setAccounts((accs ?? []) as GlMini[]);
    setBudgets((bRows ?? []) as BudgetRow[]);
  }, [supabase, entityId, period]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function runVariance() {
    if (!entityId) return;
    setLoading(true);
    setError(null);
    try {
      const { data: posted } = await supabase
        .from("journal_entries")
        .select("id")
        .eq("entity_id", entityId)
        .eq("status", "posted")
        .gte("entry_date", period)
        .lte("entry_date", dateTo)
        .is("deleted_at", null);

      const jeIds = (posted ?? []).map((j) => (j as { id: string }).id);
      const actualMap = new Map<string, number>();

      if (jeIds.length > 0) {
        const { data: lines } = await supabase
          .from("journal_entry_lines")
          .select("gl_account_id, debit_cents, credit_cents")
          .in("journal_entry_id", jeIds)
          .is("deleted_at", null);

        for (const l of lines ?? []) {
          const line = l as { gl_account_id: string; debit_cents: number; credit_cents: number };
          const net = line.debit_cents - line.credit_cents;
          actualMap.set(line.gl_account_id, (actualMap.get(line.gl_account_id) ?? 0) + net);
        }
      }

      const budgetMap = new Map<string, number>();
      for (const b of budgets) {
        budgetMap.set(b.gl_account_id, (budgetMap.get(b.gl_account_id) ?? 0) + b.amount_cents);
      }

      const allIds = new Set([...actualMap.keys(), ...budgetMap.keys()]);
      const accMap = new Map(accounts.map((a) => [a.id, a]));
      const rows: VarianceRow[] = [];
      for (const accId of allIds) {
        const acc = accMap.get(accId);
        if (!acc) continue;
        const budget = budgetMap.get(accId) ?? 0;
        const actual = actualMap.get(accId) ?? 0;
        rows.push({
          gl_account_id: accId,
          code: acc.code,
          name: acc.name,
          account_type: acc.account_type,
          budget_cents: budget,
          actual_cents: actual,
          variance_cents: actual - budget,
        });
      }
      rows.sort((a, b) => a.code.localeCompare(b.code));
      setVariance(rows);
    } finally {
      setLoading(false);
    }
  }

  async function addBudgetLine() {
    if (!ctx?.ok || !entityId || !addAccountId) return;
    const cents = parseDollarsToCents(addAmount);
    if (cents == null) {
      setError("Enter a valid dollar amount.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { error: iErr } = await supabase.from("gl_budget_lines").insert({
        organization_id: ctx.ctx.organizationId,
        entity_id: entityId,
        gl_account_id: addAccountId,
        period_start: period,
        amount_cents: cents,
      });
      if (iErr) {
        setError(iErr.message);
        return;
      }
      setAddAccountId("");
      setAddAmount("");
      await loadData();
    } finally {
      setSaving(false);
    }
  }

  function exportCsv() {
    const header = "Account Code,Account Name,Type,Budget,Actual,Variance";
    const csvRows = variance.map(
      (r) =>
        `"${r.code}","${r.name}","${r.account_type}",${(r.budget_cents / 100).toFixed(2)},${(r.actual_cents / 100).toFixed(2)},${(r.variance_cents / 100).toFixed(2)}`,
    );
    const csv = [header, ...csvRows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `budget-vs-actual-${period}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const canWrite = ctx?.ok && canMutateFinance(ctx.ctx.appRole);
  const selectClass = cn(
    "flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950",
  );

  return (
    <div className="space-y-6">
      <FinanceHubNav />
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Budget vs actual</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Set budget amounts per account, then compare to posted GL actuals.
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}

      {ready && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Parameters</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="bva-entity">Entity</Label>
              <select
                id="bva-entity"
                className={selectClass}
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
            <div className="space-y-2">
              <Label htmlFor="bva-period">Budget period (first of month)</Label>
              <Input
                id="bva-period"
                type="date"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bva-to">Actual through</Label>
              <Input id="bva-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button type="button" onClick={() => void runVariance()} disabled={loading || !entityId}>
                {loading ? "Loading…" : "Run variance"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {canWrite && accounts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add budget line</CardTitle>
            <CardDescription>Budget for period {period}. One entry per account per period.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-4">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="bva-acc">Account</Label>
                <select
                  id="bva-acc"
                  className={selectClass}
                  value={addAccountId}
                  onChange={(e) => setAddAccountId(e.target.value)}
                >
                  <option value="">Select…</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="bva-amt">Amount ($)</Label>
                <Input
                  id="bva-amt"
                  inputMode="decimal"
                  value={addAmount}
                  onChange={(e) => setAddAmount(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="flex items-end">
                <Button type="button" onClick={() => void addBudgetLine()} disabled={saving || !addAccountId}>
                  {saving ? "Saving…" : "Add"}
                </Button>
              </div>
            </div>
            {budgets.length > 0 && (
              <div className="mt-4">
                <p className="text-sm text-slate-500">{budgets.length} budget line(s) for {period}.</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {variance.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Variance</CardTitle>
              <CardDescription>{variance.length} accounts</CardDescription>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={exportCsv}>
              <Download className="mr-1 h-4 w-4" />
              CSV
            </Button>
          </CardHeader>
          <CardContent className="p-0 sm:p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Budget</TableHead>
                  <TableHead className="text-right">Actual</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {variance.map((r) => (
                  <TableRow key={r.gl_account_id}>
                    <TableCell className="font-mono">{r.code}</TableCell>
                    <TableCell>{r.name}</TableCell>
                    <TableCell>{r.account_type}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatCents(r.budget_cents)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatCents(r.actual_cents)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-mono tabular-nums",
                        r.variance_cents > 0 && "text-red-600 dark:text-red-400",
                        r.variance_cents < 0 && "text-emerald-600 dark:text-emerald-400",
                      )}
                    >
                      {formatCents(r.variance_cents)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
