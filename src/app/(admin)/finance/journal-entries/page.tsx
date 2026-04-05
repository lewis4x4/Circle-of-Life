"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { FinanceHubNav } from "../finance-hub-nav";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database";

type JournalRow = Database["public"]["Tables"]["journal_entries"]["Row"];

export default function JournalEntriesListPage() {
  const supabase = createClient();
  const selectedFacilityId = useFacilityStore((s) => s.selectedFacilityId);
  const [rows, setRows] = useState<JournalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) {
        setError(ctx.error);
        return;
      }
      let q = supabase
        .from("journal_entries")
        .select("*")
        .eq("organization_id", ctx.ctx.organizationId)
        .is("deleted_at", null)
        .order("entry_date", { ascending: false })
        .limit(100);
      if (selectedFacilityId != null) {
        q = q.or(`facility_id.eq.${selectedFacilityId},facility_id.is.null`);
      }
      const { data, error: qErr } = await q;
      if (qErr) setError(qErr.message);
      else setRows((data ?? []) as JournalRow[]);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const facilityNote = useMemo(
    () =>
      selectedFacilityId == null
        ? "All facilities"
        : "Filtered to selected facility (and entity-level rows with no facility).",
    [selectedFacilityId],
  );

  return (
    <div className="space-y-6">
      <FinanceHubNav />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Journal entries</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">{facilityNote}</p>
        </div>
        <Link className={cn(buttonVariants({ size: "sm" }))} href="/admin/finance/journal-entries/new">
          New journal
        </Link>
      </div>

      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent entries</CardTitle>
          <CardDescription>{loading ? "Loading…" : `${rows.length} shown`}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Memo</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.entry_date}</TableCell>
                  <TableCell>{r.status}</TableCell>
                  <TableCell className="max-w-md truncate">{r.memo ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <Link
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                      href={`/admin/finance/journal-entries/${r.id}`}
                    >
                      Open
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && !loading ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-slate-500">
                    No journal entries yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
