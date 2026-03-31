"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Building2 } from "lucide-react";

import { AdminEmptyState, AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { BillingHubNav } from "../billing-hub-nav";
import { billingCurrency } from "../billing-invoice-ledger";

const OPEN = ["draft", "sent", "partial", "overdue"] as const;

type Row = { entityId: string; entityName: string; totalCents: number };

type SupabaseInv = {
  entity_id: string;
  balance_due: number;
  status: string;
  deleted_at: string | null;
};

type SupabaseEntity = { id: string; name: string };

type QueryListResult<T> = { data: T[] | null; error: { message: string } | null };

export default function AdminOrgArAgingPage() {
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
        .select("entity_id, balance_due, status, deleted_at")
        .is("deleted_at", null)
        .gt("balance_due", 0)
        .in("status", [...OPEN])
        .limit(800);
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
      const agg = new Map<string, number>();
      for (const inv of invs) {
        agg.set(inv.entity_id, (agg.get(inv.entity_id) ?? 0) + Math.max(0, inv.balance_due));
      }
      const entityIds = [...agg.keys()];
      const eres = (await supabase
        .from("entities" as never)
        .select("id, name")
        .in("id", entityIds)) as unknown as QueryListResult<SupabaseEntity>;
      if (eres.error) throw eres.error;
      const nameBy = new Map((eres.data ?? []).map((e) => [e.id, e.name] as const));
      setRows(
        [...agg.entries()]
          .map(([entityId, totalCents]) => ({
            entityId,
            entityName: nameBy.get(entityId) ?? "Entity",
            totalCents,
          }))
          .sort((a, b) => b.totalCents - a.totalCents),
      );
    } catch {
      setRows([]);
      setError("Could not load org-level AR.");
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
            Org AR aging
          </h2>
          <p className="mt-1 text-slate-500 dark:text-slate-400">
            Open invoice balances rolled up to legal entity (useful when a facility filter narrows the slice).
          </p>
        </div>
        <Building2 className="hidden h-8 w-8 text-slate-300 dark:text-slate-600 lg:block" aria-hidden />
      </header>

      {error ? (
        <Card className="border-amber-200/80 bg-amber-50/40 dark:border-amber-900/60 dark:bg-amber-950/20">
          <CardContent className="py-3 text-sm text-amber-700 dark:text-amber-300">{error}</CardContent>
        </Card>
      ) : null}

      {isLoading ? <AdminTableLoadingState /> : null}
      {!isLoading && rows.length === 0 && !error ? (
        <AdminEmptyState title="No open entity AR" description="Zero-balance and closed statuses are excluded." />
      ) : null}
      {!isLoading && rows.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">By entity</CardTitle>
            <CardDescription>Sum of balance_due on open invoices.</CardDescription>
          </CardHeader>
          <CardContent className="p-0 sm:p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Entity</TableHead>
                  <TableHead className="text-right">Open AR</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.entityId}>
                    <TableCell className="font-medium">{r.entityName}</TableCell>
                    <TableCell className="text-right tabular-nums">{billingCurrency.format(r.totalCents / 100)}</TableCell>
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
