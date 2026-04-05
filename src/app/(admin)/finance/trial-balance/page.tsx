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
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { formatCents } from "@/lib/finance/format-cents";

type EntityMini = { id: string; name: string };

type TrialBalanceRow = {
  gl_account_id: string;
  code: string;
  name: string;
  account_type: string;
  total_debits: number;
  total_credits: number;
  net: number;
};

function firstOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function TrialBalancePage() {
  const supabase = createClient();
  const [entities, setEntities] = useState<EntityMini[]>([]);
  const [entityId, setEntityId] = useState("");
  const [dateFrom, setDateFrom] = useState(firstOfMonth);
  const [dateTo, setDateTo] = useState(todayIso);
  const [rows, setRows] = useState<TrialBalanceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const init = useCallback(async () => {
    const c = await loadFinanceRoleContext(supabase);
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

  async function runReport() {
    if (!entityId) return;
    setLoading(true);
    setError(null);
    try {
      const { data: posted, error: pErr } = await supabase
        .from("journal_entries")
        .select("id")
        .eq("entity_id", entityId)
        .eq("status", "posted")
        .gte("entry_date", dateFrom)
        .lte("entry_date", dateTo)
        .is("deleted_at", null);

      if (pErr) {
        setError(pErr.message);
        return;
      }

      const jeIds = (posted ?? []).map((j) => (j as { id: string }).id);
      if (jeIds.length === 0) {
        setRows([]);
        return;
      }

      const { data: lines, error: lErr } = await supabase
        .from("journal_entry_lines")
        .select("gl_account_id, debit_cents, credit_cents")
        .in("journal_entry_id", jeIds)
        .is("deleted_at", null);

      if (lErr) {
        setError(lErr.message);
        return;
      }

      const accIds = [...new Set((lines ?? []).map((l) => (l as { gl_account_id: string }).gl_account_id))];
      if (accIds.length === 0) {
        setRows([]);
        return;
      }

      const { data: accs } = await supabase
        .from("gl_accounts")
        .select("id, code, name, account_type")
        .in("id", accIds);

      const accMap = new Map(
        (accs ?? []).map((a) => {
          const acc = a as { id: string; code: string; name: string; account_type: string };
          return [acc.id, acc];
        }),
      );

      const agg = new Map<string, { debits: number; credits: number }>();
      for (const l of lines ?? []) {
        const line = l as { gl_account_id: string; debit_cents: number; credit_cents: number };
        const prev = agg.get(line.gl_account_id) ?? { debits: 0, credits: 0 };
        prev.debits += line.debit_cents;
        prev.credits += line.credit_cents;
        agg.set(line.gl_account_id, prev);
      }

      const result: TrialBalanceRow[] = [];
      for (const [accId, totals] of agg) {
        const acc = accMap.get(accId);
        if (!acc) continue;
        result.push({
          gl_account_id: accId,
          code: acc.code,
          name: acc.name,
          account_type: acc.account_type,
          total_debits: totals.debits,
          total_credits: totals.credits,
          net: totals.debits - totals.credits,
        });
      }
      result.sort((a, b) => a.code.localeCompare(b.code));
      setRows(result);
    } finally {
      setLoading(false);
    }
  }

  function exportCsv() {
    const header = "Account Code,Account Name,Type,Total Debits,Total Credits,Net";
    const csvRows = rows.map(
      (r) =>
        `"${r.code}","${r.name}","${r.account_type}",${(r.total_debits / 100).toFixed(2)},${(r.total_credits / 100).toFixed(2)},${(r.net / 100).toFixed(2)}`,
    );
    const csv = [header, ...csvRows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trial-balance-${dateFrom}-to-${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const totalDebits = rows.reduce((s, r) => s + r.total_debits, 0);
  const totalCredits = rows.reduce((s, r) => s + r.total_credits, 0);
  const balanced = totalDebits === totalCredits;

  const selectClass = cn(
    "flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950",
  );

  return (
    <div className="space-y-6">
      <FinanceHubNav />
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Trial balance</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Aggregated debits and credits by account for posted entries within a date range.
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
              <Label htmlFor="tb-entity">Entity</Label>
              <select
                id="tb-entity"
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
              <Label htmlFor="tb-from">From</Label>
              <Input id="tb-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tb-to">To</Label>
              <Input id="tb-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button type="button" onClick={() => void runReport()} disabled={loading || !entityId}>
                {loading ? "Loading…" : "Run report"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {rows.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Results</CardTitle>
              <CardDescription>
                {rows.length} accounts · {dateFrom} to {dateTo}
                {balanced ? (
                  <span className="ml-2 text-emerald-600 dark:text-emerald-400">(balanced)</span>
                ) : (
                  <span className="ml-2 text-amber-600 dark:text-amber-400">(not balanced — check data)</span>
                )}
              </CardDescription>
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
                  <TableHead className="text-right">Debits</TableHead>
                  <TableHead className="text-right">Credits</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.gl_account_id}>
                    <TableCell className="font-mono">{r.code}</TableCell>
                    <TableCell>{r.name}</TableCell>
                    <TableCell>{r.account_type}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatCents(r.total_debits)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatCents(r.total_credits)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatCents(r.net)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 font-semibold">
                  <TableCell colSpan={3}>Total</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatCents(totalDebits)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatCents(totalCredits)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatCents(totalDebits - totalCredits)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {!loading && rows.length === 0 && ready && (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No posted entries in the selected range. Run the report to see results.
        </p>
      )}
    </div>
  );
}
