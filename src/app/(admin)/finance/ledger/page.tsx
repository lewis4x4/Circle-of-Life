"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { FinanceHubNav } from "../finance-hub-nav";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { ArrowRight, CircleDollarSign } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import type { Database } from "@/types/database";

type JournalRow = Database["public"]["Tables"]["journal_entries"]["Row"];

export default function LedgerPage() {
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
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

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
          {/* Header row */}
          <div className="flex items-center gap-3 px-[13px] py-2 border-b border-border bg-card/60 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span className="flex-1 min-w-0">Memo</span>
            <span className="w-[140px] shrink-0">Entry date</span>
            <span className="w-[160px] shrink-0 text-right">
              {loading ? "Loading…" : `${rows.length} rows`}
            </span>
          </div>
          
          {rows.length === 0 && !loading ? (
            <div className="p-16 text-center rounded-lg border-0">
              <p className="font-semibold text-lg text-foreground">No entries yet</p>
              <p className="text-sm text-muted-foreground mt-1">Period close processes or active journals will populate here.</p>
            </div>
          ) : (
            <MotionList className="space-y-1">
              {rows.map((r) => (
                <MotionItem key={r.id}>
                  <Link
                    href={`/admin/finance/journal-entries/${r.id}`}
                    className="group flex items-center gap-3 min-h-[36px] px-[13px] py-2 rounded-lg border border-border bg-card hover:bg-muted/40 hover:-translate-y-0.5 transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
                  >
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
                  </Link>
                </MotionItem>
              ))}
            </MotionList>
          )}
        </div>
      </div>
    </div>
  );
}
