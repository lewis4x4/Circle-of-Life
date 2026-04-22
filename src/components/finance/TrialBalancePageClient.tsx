"use client";

import { useState } from "react";
import { Download } from "lucide-react";

import { FinanceHubNav } from "@/app/(admin)/finance/finance-hub-nav";
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
import { formatCents } from "@/lib/finance/format-cents";
import { loadTrialBalanceData, type EntityMini, type TrialBalanceRow } from "@/lib/finance/load-trial-balance-data";

type TrialBalancePageClientProps = {
  initialEntities: EntityMini[];
  initialEntityId: string;
  initialDateFrom: string;
  initialDateTo: string;
  initialRows: TrialBalanceRow[];
  initialError: string | null;
  initialReady: boolean;
};

export default function TrialBalancePageClient({
  initialEntities,
  initialEntityId,
  initialDateFrom,
  initialDateTo,
  initialRows,
  initialError,
  initialReady,
}: TrialBalancePageClientProps) {
  const supabase = createClient();
  const [entities] = useState<EntityMini[]>(initialEntities);
  const [entityId, setEntityId] = useState(initialEntityId);
  const [dateFrom, setDateFrom] = useState(initialDateFrom);
  const [dateTo, setDateTo] = useState(initialDateTo);
  const [rows, setRows] = useState<TrialBalanceRow[]>(initialRows);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const ready = initialReady;

  async function runReport() {
    if (!entityId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await loadTrialBalanceData(supabase, entityId, dateFrom, dateTo);
      setRows(result);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Failed to run trial balance.");
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
