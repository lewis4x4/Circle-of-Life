"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { FinanceHubNav } from "../finance-hub-nav";
import { AdminEmptyState } from "@/components/common/admin-list-patterns";
import { Card, CardContent } from "@/components/ui/card";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { ArrowRight, CircleDollarSign } from "lucide-react";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { createClient } from "@/lib/supabase/client";
import {
  LEDGER_EMPTY_LIST_DESCRIPTION,
  LEDGER_EMPTY_LIST_TITLE,
  LEDGER_LOADING_ENTRIES_COPY,
  LEDGER_LOADING_PROFILE_COPY,
} from "@/lib/finance/ledger-display-copy";
import {
  resolveLedgerFetchErrorBannerMessage,
  resolveLedgerOrganizationGapMessage,
} from "@/lib/finance/ledger-page-state";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { TableRow, TableRowHeader } from "@/components/ui/table-row";
import type { Database } from "@/types/database";

type JournalRow = Database["public"]["Tables"]["journal_entries"]["Row"];

export default function LedgerPage() {
  const supabase = useMemo(() => createClient(), []);
  const { organizationId, loading: authLoading } = useHavenAuth();
  const selectedFacilityId = useFacilityStore((s) => s.selectedFacilityId);
  const [rows, setRows] = useState<JournalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (authLoading) {
      setLoading(false);
      return;
    }
    if (!organizationId) {
      setRows([]);
      setLoading(false);
      setFetchError(null);
      return;
    }
    setLoading(true);
    setFetchError(null);
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
      if (qErr) setFetchError(qErr.message);
      else setRows((data ?? []) as JournalRow[]);
    } finally {
      setLoading(false);
    }
  }, [supabase, organizationId, selectedFacilityId, authLoading]);

  useEffect(() => {
    void load();
  }, [load]);

  const organizationGapMessage = resolveLedgerOrganizationGapMessage({
    authLoading,
    organizationId,
    hasOrgScopedData: rows.length > 0,
  });
  const fetchErrorBannerMessage = resolveLedgerFetchErrorBannerMessage({
    authLoading,
    fetchError,
  });

  const showLoading = authLoading || loading;
  const showEmptyList =
    !organizationGapMessage && !showLoading && !fetchErrorBannerMessage && rows.length === 0;

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

        {authLoading ? (
          <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
            {LEDGER_LOADING_PROFILE_COPY}
          </p>
        ) : null}

        {organizationGapMessage ? (
          <Card className="rounded-lg border border-dashed border-muted-foreground/35 bg-muted/30 shadow-sm">
            <CardContent className="p-4 text-sm text-muted-foreground">{organizationGapMessage}</CardContent>
          </Card>
        ) : null}

        {fetchErrorBannerMessage ? (
          <p
            className="rounded-lg border border-destructive/30 bg-destructive/10 px-6 py-4 text-sm text-destructive shadow-sm font-medium"
            role="alert"
          >
            {fetchErrorBannerMessage}
          </p>
        ) : null}

        {!organizationGapMessage && !authLoading ? (
          <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
            <TableRowHeader>
              <span className="flex-1 min-w-0">Memo</span>
              <span className="w-[140px] shrink-0">Entry date</span>
              <span className="w-[160px] shrink-0 text-right">
                {showLoading ? LEDGER_LOADING_ENTRIES_COPY : `${rows.length} rows`}
              </span>
            </TableRowHeader>

            {showLoading ? (
              <p className="px-4 py-6 text-sm text-muted-foreground" role="status" aria-live="polite">
                {LEDGER_LOADING_ENTRIES_COPY}
              </p>
            ) : showEmptyList ? (
              <div className="p-4">
                <AdminEmptyState
                  title={LEDGER_EMPTY_LIST_TITLE}
                  description={LEDGER_EMPTY_LIST_DESCRIPTION}
                />
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
        ) : null}
      </div>
    </div>
  );
}
