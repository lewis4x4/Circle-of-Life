"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Timer } from "lucide-react";

import {
  AdminEmptyState,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { BillingHubNav } from "../billing-hub-nav";
import { billingCurrency } from "../billing-invoice-ledger";

const OPEN = ["draft", "sent", "partial", "overdue"] as const;

type Row = {
  residentId: string;
  residentName: string;
  totalCents: number;
  b0_30: number;
  b31_60: number;
  b61_90: number;
  b91: number;
};

type SupabaseInv = {
  id: string;
  resident_id: string;
  due_date: string;
  balance_due: number;
  status: string;
  deleted_at: string | null;
};

type SupabaseRes = { id: string; first_name: string | null; last_name: string | null };

type QueryListResult<T> = { data: T[] | null; error: { message: string } | null };

function daysPastDue(dueDate: string): number {
  const due = new Date(`${dueDate}T23:59:59`);
  if (Number.isNaN(due.getTime())) return 0;
  const now = new Date();
  const ms = now.getTime() - due.getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

export default function AdminArAgingPage() {
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<Row[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      let q = supabase
        .from("invoices" as never)
        .select("id, resident_id, due_date, balance_due, status, deleted_at")
        .is("deleted_at", null)
        .gt("balance_due", 0)
        .in("status", [...OPEN])
        .limit(500);
      if (isValidFacilityIdForQuery(selectedFacilityId)) {
        q = q.eq("facility_id", selectedFacilityId);
      }
      const res = (await q) as unknown as QueryListResult<SupabaseInv>;
      if (res.error) throw res.error;
      const invs = res.data ?? [];
      if (invs.length === 0) {
        setRows([]);
        setIsLoading(false);
        return;
      }
      const resIds = [...new Set(invs.map((i) => i.resident_id))];
      const rres = (await supabase
        .from("residents" as never)
        .select("id, first_name, last_name")
        .in("id", resIds)) as unknown as QueryListResult<SupabaseRes>;
      if (rres.error) throw rres.error;
      const nameBy = new Map<string, string>();
      for (const r of rres.data ?? []) {
        const fn = r.first_name?.trim() ?? "";
        const ln = r.last_name?.trim() ?? "";
        nameBy.set(r.id, `${fn} ${ln}`.trim() || "Resident");
      }

      const agg = new Map<string, Row>();
      for (const inv of invs) {
        const bal = Math.max(0, inv.balance_due);
        const days = daysPastDue(inv.due_date);
        let bucket: keyof Pick<Row, "b0_30" | "b31_60" | "b61_90" | "b91"> = "b0_30";
        if (days > 90) bucket = "b91";
        else if (days > 60) bucket = "b61_90";
        else if (days > 30) bucket = "b31_60";

        const cur =
          agg.get(inv.resident_id) ??
          ({
            residentId: inv.resident_id,
            residentName: nameBy.get(inv.resident_id) ?? "Resident",
            totalCents: 0,
            b0_30: 0,
            b31_60: 0,
            b61_90: 0,
            b91: 0,
          } satisfies Row);
        cur.totalCents += bal;
        cur[bucket] += bal;
        agg.set(inv.resident_id, cur);
      }
      setRows([...agg.values()].sort((a, b) => b.totalCents - a.totalCents));
    } catch {
      setRows([]);
      setError("Could not load AR aging.");
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => ({
        total: acc.total + r.totalCents,
        b0_30: acc.b0_30 + r.b0_30,
        b31_60: acc.b31_60 + r.b31_60,
        b61_90: acc.b61_90 + r.b61_90,
        b91: acc.b91 + r.b91,
      }),
      { total: 0, b0_30: 0, b31_60: 0, b61_90: 0, b91: 0 },
    );
  }, [rows]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <BillingHubNav />
      <header className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            AR aging
          </h2>
          <p className="mt-1 text-slate-500 dark:text-slate-400">
            Open balances bucketed by days past due date (per invoice, rolled up by resident).
          </p>
        </div>
      </header>

      {error ? <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} /> : null}

      {!isLoading && rows.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {(
            [
              ["Total AR", totals.total, true],
              ["0–30 days", totals.b0_30, false],
              ["31–60 days", totals.b31_60, false],
              ["61–90 days", totals.b61_90, false],
              ["91+ days", totals.b91, false],
            ] as const
          ).map(([label, cents, showIcon]) => (
            <Card key={label}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-1 text-sm font-medium text-slate-500 dark:text-slate-400">
                  {showIcon ? <Timer className="h-4 w-4" /> : null}
                  {label}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                {billingCurrency.format(cents / 100)}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      {isLoading ? <AdminTableLoadingState /> : null}
      {!isLoading && rows.length === 0 && !error ? (
        <AdminEmptyState title="No open AR" description="Paid, void, and zero-balance invoices are excluded." />
      ) : null}
      {!isLoading && rows.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">By resident</CardTitle>
            <CardDescription>Highest balance first.</CardDescription>
          </CardHeader>
          <CardContent className="p-0 sm:p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Resident</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="hidden text-right md:table-cell">0–30</TableHead>
                  <TableHead className="hidden text-right md:table-cell">31–60</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">61–90</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">91+</TableHead>
                  <TableHead className="w-10 pr-4 text-right"> </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.residentId}>
                    <TableCell className="font-medium">{r.residentName}</TableCell>
                    <TableCell className="text-right tabular-nums">{billingCurrency.format(r.totalCents / 100)}</TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">
                      {billingCurrency.format(r.b0_30 / 100)}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">
                      {billingCurrency.format(r.b31_60 / 100)}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums lg:table-cell">
                      {billingCurrency.format(r.b61_90 / 100)}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums lg:table-cell">
                      {billingCurrency.format(r.b91 / 100)}
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <Link
                        href={`/admin/residents/${r.residentId}/billing`}
                        className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}
                        aria-label={`Open billing for ${r.residentName}`}
                      >
                        →
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
