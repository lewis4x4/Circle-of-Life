"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Percent } from "lucide-react";

import {
  AdminEmptyState,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { BillingHubNav } from "../billing-hub-nav";
import { billingCurrency } from "../billing-invoice-ledger";

type RateRow = {
  id: string;
  name: string;
  effectiveDate: string;
  endDate: string | null;
  basePrivateCents: number;
  current: boolean;
};

type SupabaseRateRow = {
  id: string;
  name: string;
  effective_date: string;
  end_date: string | null;
  base_rate_private: number;
  deleted_at: string | null;
};

type QueryError = { message: string };
type QueryListResult<T> = { data: T[] | null; error: QueryError | null };

function formatDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d);
}

export default function AdminBillingRatesPage() {
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<RateRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      let q = supabase
        .from("rate_schedules" as never)
        .select("id, name, effective_date, end_date, base_rate_private, deleted_at")
        .is("deleted_at", null)
        .order("effective_date", { ascending: false })
        .limit(100);
      if (isValidFacilityIdForQuery(selectedFacilityId)) {
        q = q.eq("facility_id", selectedFacilityId);
      }
      const res = (await q) as unknown as QueryListResult<SupabaseRateRow>;
      if (res.error) throw res.error;
      const list = res.data ?? [];
      setRows(
        list.map((r) => ({
          id: r.id,
          name: r.name,
          effectiveDate: r.effective_date,
          endDate: r.end_date,
          basePrivateCents: r.base_rate_private,
          current: r.end_date == null,
        })),
      );
    } catch {
      setRows([]);
      setError("Live rate schedules are unavailable.");
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <BillingHubNav />
      <header className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Rate schedules
          </h2>
          <p className="mt-1 text-slate-500 dark:text-slate-400">
            Private base rate and surcharges live on each schedule row (detail editing comes later).
          </p>
        </div>
        <Badge variant="outline" className="w-fit">
          <Percent className="mr-1 h-3.5 w-3.5" />
          {rows.filter((r) => r.current).length} current
        </Badge>
      </header>

      {error ? <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} /> : null}

      {isLoading ? <AdminTableLoadingState /> : null}
      {!isLoading && rows.length === 0 && !error ? (
        <AdminEmptyState
          title="No rate schedules"
          description="Create schedules in Supabase or pick a facility that has pricing configured."
        />
      ) : null}
      {!isLoading && rows.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Schedules</CardTitle>
            <CardDescription>Effective dating controls which schedule applies to new invoices.</CardDescription>
          </CardHeader>
          <CardContent className="p-0 sm:p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Effective</TableHead>
                  <TableHead className="hidden sm:table-cell">End</TableHead>
                  <TableHead className="text-right">Base private</TableHead>
                  <TableHead> </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>{formatDate(row.effectiveDate)}</TableCell>
                    <TableCell className="hidden text-slate-500 sm:table-cell">
                      {row.endDate ? formatDate(row.endDate) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {billingCurrency.format(row.basePrivateCents / 100)}
                    </TableCell>
                    <TableCell>
                      {row.current ? (
                        <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                          Current
                        </Badge>
                      ) : (
                        <Badge variant="outline">Historical</Badge>
                      )}
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
