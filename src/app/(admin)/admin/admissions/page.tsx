"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ClipboardList, Home } from "lucide-react";

import { AdmissionsHubNav } from "./admissions-hub-nav";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";

type CaseRow = Pick<
  Database["public"]["Tables"]["admission_cases"]["Row"],
  "id" | "status" | "updated_at" | "target_move_in_date"
> & {
  residents: { first_name: string; last_name: string } | null;
};

function formatStatus(s: string) {
  return s.replace(/_/g, " ");
}

export default function AdminAdmissionsHubPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rows, setRows] = useState<CaseRow[]>([]);
  const [counts, setCounts] = useState({
    pending: 0,
    reserved: 0,
    moveIn: 0,
    cancelled: 0,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setRows([]);
      setCounts({ pending: 0, reserved: 0, moveIn: 0, cancelled: 0 });
      setLoading(false);
      return;
    }

    try {
      const { data: list, error: listErr } = await supabase
        .from("admission_cases")
        .select("id, status, updated_at, target_move_in_date, residents(first_name, last_name)")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(50);

      if (listErr) throw listErr;
      setRows((list ?? []) as CaseRow[]);

      const base = () =>
        supabase
          .from("admission_cases")
          .select("id", { count: "exact", head: true })
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null);

      const [cPend, cRes, cMove, cCan] = await Promise.all([
        base().eq("status", "pending_clearance"),
        base().eq("status", "bed_reserved"),
        base().eq("status", "move_in"),
        base().eq("status", "cancelled"),
      ]);

      setCounts({
        pending: cPend.count ?? 0,
        reserved: cRes.count ?? 0,
        moveIn: cMove.count ?? 0,
        cancelled: cCan.count ?? 0,
      });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load admission cases.");
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
          Admissions
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Clearance, bed reservation, and move-in tracking for prospects already on file as residents.
        </p>
      </div>

      <AdmissionsHubNav />

      {noFacility ? (
        <p className="rounded-lg border border-amber-200/80 bg-amber-50/50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
          Select a facility in the header to load admission cases.
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-300">Pending clearance</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-2xl font-semibold tabular-nums">
              {noFacility ? "—" : loading ? "—" : counts.pending}
            </p>
          </CardContent>
        </Card>
        <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-300">Bed reserved</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-2xl font-semibold tabular-nums">
              {noFacility ? "—" : loading ? "—" : counts.reserved}
            </p>
          </CardContent>
        </Card>
        <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-300">Move-in</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-2xl font-semibold tabular-nums">
              {noFacility ? "—" : loading ? "—" : counts.moveIn}
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

      <Link href="/admin/admissions/new" className="group block">
        <Card className="border-slate-200/80 shadow-soft transition-colors hover:border-brand-500/40 dark:border-slate-800">
          <CardHeader className="flex flex-row items-start gap-3 space-y-0">
            <div className="rounded-md bg-slate-100 p-2 dark:bg-slate-900">
              <Home className="h-5 w-5 text-brand-600 dark:text-brand-400" />
            </div>
            <div>
              <CardTitle className="font-display text-base group-hover:text-brand-700 dark:group-hover:text-brand-300">
                New admission case
              </CardTitle>
              <p className="text-xs text-slate-600 dark:text-slate-300">Link a resident prospect to clearance and bed planning.</p>
            </div>
          </CardHeader>
        </Card>
      </Link>

      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
          <ClipboardList className="h-4 w-4 shrink-0" />
          Cases
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
                <TableHead>Target move-in</TableHead>
                <TableHead className="text-right">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {noFacility ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={4} className="py-10 text-center text-sm text-slate-600 dark:text-slate-300">
                    Select a facility to view cases.
                  </TableCell>
                </TableRow>
              ) : loading ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={4} className="py-10 text-center text-sm text-slate-600 dark:text-slate-300">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={4} className="py-10 text-center text-sm text-slate-600 dark:text-slate-300">
                    No cases yet. Start with <strong>New admission case</strong>.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id} className="hover:bg-transparent">
                    <TableCell className="font-medium">
                      <Link
                        href={`/admin/admissions/${r.id}`}
                        className="text-brand-700 hover:underline dark:text-brand-300"
                      >
                        {r.residents ? `${r.residents.first_name} ${r.residents.last_name}` : "—"}
                      </Link>
                    </TableCell>
                    <TableCell className="capitalize">{formatStatus(r.status)}</TableCell>
                    <TableCell>{r.target_move_in_date ?? "—"}</TableCell>
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
        <span>Upstream:</span>
        <Link href="/admin/referrals" className={cn(buttonVariants({ variant: "link", size: "sm" }), "h-auto p-0 text-xs")}>
          Referrals
        </Link>
      </div>
    </div>
  );
}
