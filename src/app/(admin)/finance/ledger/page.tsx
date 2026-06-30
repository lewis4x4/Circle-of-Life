"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { FinanceHubNav } from "../finance-hub-nav";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { ArrowRight, CircleDollarSign } from "lucide-react";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { createClient } from "@/lib/supabase/client";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { TableRow, TableRowHeader } from "@/components/ui/table-row";
import type { Database } from "@/types/database";

type JournalRow = Database["public"]["Tables"]["journal_entries"]["Row"];

export default function LedgerPage() {
  const supabase = createClient();
  const { organizationId, loading: authLoading } = useHavenAuth();
  const selectedFacilityId = useFacilityStore((s) => s.selectedFacilityId);
  const [rows, setRows] = useState<JournalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) {
      setRows([]);
      setLoading(authLoading);
      if (!authLoading) setError("Organization missing on profile.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let q = supabase
        .from("journal_entries")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("status", "posted")
        .is("deleted_at", null)
        .order("entry_date", { ascending: false })
        .limit(200);
      if (selectedFacilityId != null) {
        q = q.or(`facility_id.eq.${selectedFacilityId},facility_id.is.null`);
      }
      const { data, error: qErr } = await q;
      if (qErr) setError(qErr.message);
      else setRows((data ?? []) as JournalRow[]);
    } finally {
      setLoading(false);
    }
  }, [supabase, organizationId, selectedFacilityId, authLoading]);

  useEffect(() => {
    void load();
  }, [load]);

  const showLoading = authLoading || loading;

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6">
        <FinanceHubNav />
        
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-card p-8 rounded-lg border border-border shadow-sm mt-4">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              General Ledger
            </h1>
            <p className="mt-2 font-medium tracking-wide text-muted-foreground max-w-2xl">
              Posted journal headers across the selected operational facility boundaries. Open an entry for line details.
            </p>
          </div>
        </header>

        {error ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-6 py-4 text-sm text-destructive shadow-sm font-medium" role="alert">
            {error}
          </p>
        ) : null}

        <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
          <TableRowHeader>
            <span className="flex-1 min-w-0">Memo</span>
            <span className="w-[140px] shrink-0">Entry date</span>
            <span className="w-[160px] shrink-0 text-right">
              {showLoading ? "Loading…" : `${rows.length} rows`}
            </span>
          </TableRowHeader>
          
          {rows.length === 0 && !showLoading ? (
            <div className="p-16 text-center rounded-lg border-0">
              <p className="font-semibold text-lg text-foreground">No entries yet</p>
              <p className="text-sm text-muted-foreground mt-1">Period close processes or active journals will populate here.</p>
            </div>
          ) : (
            <MotionList className="space-y-1 p-1">
              {rows.map((r) => (
                <MotionItem key={r.id}>
                  <TableRow render={<Link href={`/admin/finance/journal-entries/${r.id}`} />}>
                    <div className="flex-1 min-w-0 flex items-center gap-3">
                      <CircleDollarSign className="w-4 h-4 text-muted-foreground shrink-0 group-hover:text-success transition-colors" />
                      <span className="text-[13px] font-medium text-foreground truncate">
                        {r.memo ?? <span className="italic text-muted-foreground">No memo</span>}
                      </span>
                    </div>
                    <span className="w-[140px] shrink-0 font-mono text-[12px] text-muted-foreground tabular-nums">
                      {r.entry_date}
                    </span>
                    <div className="w-[160px] shrink-0 flex items-center justify-end gap-2">
                      <span className="text-[12px] font-mono text-muted-foreground tabular-nums">
                        {r.posted_at ? r.posted_at.slice(0, 19).replace("T", " ") : "Pending"}
                      </span>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-success transition-colors shrink-0" />
                    </div>
                  </TableRow>
                </MotionItem>
              ))}
            </MotionList>
          )}
        </div>
      </div>
    </div>
  );
}
