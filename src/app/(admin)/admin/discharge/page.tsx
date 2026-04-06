"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ClipboardList, DoorOpen } from "lucide-react";

import { DischargeHubNav } from "./discharge-hub-nav";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";

type RowT = Pick<
  Database["public"]["Tables"]["discharge_med_reconciliation"]["Row"],
  "id" | "status" | "updated_at"
> & {
  residents: { first_name: string; last_name: string } | null;
};

function formatStatus(s: string) {
  return s.replace(/_/g, " ");
}

export default function AdminDischargeHubPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rows, setRows] = useState<RowT[]>([]);
  const [counts, setCounts] = useState({
    draft: 0,
    review: 0,
    complete: 0,
    cancelled: 0,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setRows([]);
      setCounts({ draft: 0, review: 0, complete: 0, cancelled: 0 });
      setLoading(false);
      return;
    }

    try {
      const { data: list, error: listErr } = await supabase
        .from("discharge_med_reconciliation")
        .select("id, status, updated_at, residents(first_name, last_name)")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(50);

      if (listErr) throw listErr;
      setRows((list ?? []) as RowT[]);

      const base = () =>
        supabase
          .from("discharge_med_reconciliation")
          .select("id", { count: "exact", head: true })
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null);

      const [cDraft, cRev, cDone, cCan] = await Promise.all([
        base().eq("status", "draft"),
        base().eq("status", "pharmacist_review"),
        base().eq("status", "complete"),
        base().eq("status", "cancelled"),
      ]);

      setCounts({
        draft: cDraft.count ?? 0,
        review: cRev.count ?? 0,
        complete: cDone.count ?? 0,
        cancelled: cCan.count ?? 0,
      });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load reconciliations.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const noFacility = !selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          Discharge & transition
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Medication reconciliation records and linkage to resident discharge planning fields.
        </p>
      </div>

      <DischargeHubNav />

      {noFacility ? (
        <p className="rounded-lg border border-amber-200/80 bg-amber-50/50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
          Select a facility in the header to load reconciliation rows.
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-300">Draft</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-2xl font-semibold tabular-nums">
              {noFacility ? "—" : loading ? "—" : counts.draft}
            </p>
          </CardContent>
        </Card>
        <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-300">Pharmacist review</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-2xl font-semibold tabular-nums">
              {noFacility ? "—" : loading ? "—" : counts.review}
            </p>
          </CardContent>
        </Card>
        <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-300">Complete</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-2xl font-semibold tabular-nums">
              {noFacility ? "—" : loading ? "—" : counts.complete}
            </p>
          </CardContent>
        </Card>
        <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-300">Cancelled</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-2xl font-semibold tabular-nums">
              {noFacility ? "—" : loading ? "—" : counts.cancelled}
            </p>
          </CardContent>
        </Card>
      </div>

      <Link href="/admin/discharge/new" className="group block">
        <Card className="border-slate-200/80 shadow-soft transition-colors hover:border-brand-500/40 dark:border-slate-800">
          <CardHeader className="flex flex-row items-start gap-3 space-y-0">
            <div className="rounded-md bg-slate-100 p-2 dark:bg-slate-900">
              <DoorOpen className="h-5 w-5 text-brand-600 dark:text-brand-400" />
            </div>
            <div>
              <CardTitle className="font-display text-base group-hover:text-brand-700 dark:group-hover:text-brand-300">
                New med reconciliation
              </CardTitle>
              <p className="text-xs text-slate-600 dark:text-slate-300">Opens a draft row for a resident in this facility.</p>
            </div>
          </CardHeader>
        </Card>
      </Link>

      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
          <ClipboardList className="h-4 w-4 shrink-0" />
          Reconciliations
        </div>
        {loadError ? (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">
            {loadError}
          </p>
        ) : null}
        <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Resident</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {noFacility ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={3} className="py-10 text-center text-sm text-slate-600 dark:text-slate-300">
                    Select a facility to view reconciliations.
                  </TableCell>
                </TableRow>
              ) : loading ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={3} className="py-10 text-center text-sm text-slate-600 dark:text-slate-300">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={3} className="py-10 text-center text-sm text-slate-600 dark:text-slate-300">
                    No rows yet. Start with <strong>New med reconciliation</strong>.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id} className="hover:bg-transparent">
                    <TableCell className="font-medium">
                      <Link
                        href={`/admin/discharge/${r.id}`}
                        className="text-brand-700 hover:underline dark:text-brand-300"
                      >
                        {r.residents ? `${r.residents.first_name} ${r.residents.last_name}` : "—"}
                      </Link>
                    </TableCell>
                    <TableCell className="capitalize">{formatStatus(r.status)}</TableCell>
                    <TableCell className="text-right text-slate-600 dark:text-slate-400">
                      {new Date(r.updated_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-sm text-slate-600 dark:text-slate-300">
        <span>Related:</span>
        <Link href="/admin/admissions" className={cn(buttonVariants({ variant: "link", size: "sm" }), "h-auto p-0 text-xs")}>
          Admissions
        </Link>
      </div>
    </div>
  );
}
