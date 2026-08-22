"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { FinanceHubNav } from "../finance-hub-nav";
import { AdminEmptyState } from "@/components/common/admin-list-patterns";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { ArrowRight, BookOpenText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { createClient } from "@/lib/supabase/client";
import {
  JOURNAL_ENTRIES_EMPTY_LIST_DESCRIPTION,
  JOURNAL_ENTRIES_EMPTY_LIST_TITLE,
  JOURNAL_ENTRIES_LOADING_COPY,
  JOURNAL_ENTRIES_LOADING_PROFILE_COPY,
} from "@/lib/finance/journal-entries-display-copy";
import {
  resolveJournalEntriesFetchErrorBannerMessage,
  resolveJournalEntriesOrganizationGapMessage,
} from "@/lib/finance/journal-entries-page-state";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database";

type JournalRow = Database["public"]["Tables"]["journal_entries"]["Row"];

export default function JournalEntriesListPage() {
  const supabase = createClient();
  const { organizationId, loading: authLoading } = useHavenAuth();
  const selectedFacilityId = useFacilityStore((s) => s.selectedFacilityId);

  const {
    data: rows = [],
    isPending,
    error,
  } = useQuery({
    queryKey: ["finance", "journal-entries", organizationId, selectedFacilityId],
    enabled: !!organizationId,
    queryFn: async (): Promise<JournalRow[]> => {
      let q = supabase
        .from("journal_entries")
        .select("*")
        .eq("organization_id", organizationId as string)
        .is("deleted_at", null)
        .order("entry_date", { ascending: false })
        .limit(100);
      if (selectedFacilityId != null) {
        q = q.or(`facility_id.eq.${selectedFacilityId},facility_id.is.null`);
      }
      const { data, error: qErr } = await q;
      if (qErr) throw new Error(qErr.message);
      return (data ?? []) as JournalRow[];
    },
  });

  const organizationGapMessage = resolveJournalEntriesOrganizationGapMessage({
    authLoading,
    organizationId,
    hasOrgScopedData: rows.length > 0,
  });
  const fetchErrorBannerMessage = resolveJournalEntriesFetchErrorBannerMessage({
    authLoading,
    fetchError: error?.message ?? null,
  });

  const showLoadingEntries = !!organizationId && !authLoading && isPending;
  const showEmptyList =
    !organizationGapMessage &&
    !authLoading &&
    !!organizationId &&
    !isPending &&
    !fetchErrorBannerMessage &&
    rows.length === 0;

  const facilityNote = useMemo(
    () =>
      selectedFacilityId == null
        ? "All facilities"
        : "Filtered to selected facility (and entity-level rows with no facility).",
    [selectedFacilityId],
  );

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
        <FinanceHubNav />

        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-primary-50/20 p-8 rounded-lg border border-primary-200/50 dark:border-white/5 shadow-sm mt-4">
          <div className="space-y-3">
            <h1 className="text-4xl md:text-2xl font-semibold tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
              Journal Entries
            </h1>
            <p className="mt-2 font-medium tracking-wide text-slate-600 dark:text-zinc-400 max-w-2xl">
              {facilityNote}
            </p>
          </div>
          <div className="flex shrink-0">
            <Link
              className={cn(
                buttonVariants({ size: "lg" }),
                "rounded-full font-bold uppercase tracking-wider text-[10px] shadow-lg bg-primary-600 hover:bg-primary-700 text-white border border-primary-500",
              )}
              href="/admin/finance/journal-entries/new"
            >
              + New Journal
            </Link>
          </div>
        </header>

        {authLoading ? (
          <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
            {JOURNAL_ENTRIES_LOADING_PROFILE_COPY}
          </p>
        ) : null}

        {organizationGapMessage ? (
          <Card className="rounded-lg border border-dashed border-muted-foreground/35 bg-muted/30 shadow-sm">
            <CardContent className="p-4 text-sm text-muted-foreground">{organizationGapMessage}</CardContent>
          </Card>
        ) : null}

        {fetchErrorBannerMessage ? (
          <p
            className="rounded-lg border border-red-200 bg-red-50 px-6 py-4 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100 shadow-sm font-medium"
            role="alert"
          >
            {fetchErrorBannerMessage}
          </p>
        ) : null}

        {!organizationGapMessage && !authLoading ? (
          <div className="p-6 sm:p-8 rounded-lg border border-slate-200/60 dark:border-white/5 bg-slate-50/50 shadow-sm relative overflow-hidden transition-all">
            <div className="mb-6 border-b border-slate-200 dark:border-white/5 pb-4 flex items-center justify-between">
              <h3 className="text-xl font-semibold text-slate-900 dark:text-white mt-1">Recent Entries</h3>
              <p className="text-[10px] font-mono tracking-wider text-slate-400 mt-1 uppercase">
                {showLoadingEntries ? JOURNAL_ENTRIES_LOADING_COPY : `${rows.length} rows`}
              </p>
            </div>

            <div className="relative z-10">
              {showLoadingEntries ? (
                <p className="px-2 py-6 text-sm text-muted-foreground" role="status" aria-live="polite">
                  {JOURNAL_ENTRIES_LOADING_COPY}
                </p>
              ) : showEmptyList ? (
                <div className="p-4">
                  <AdminEmptyState
                    title={JOURNAL_ENTRIES_EMPTY_LIST_TITLE}
                    description={JOURNAL_ENTRIES_EMPTY_LIST_DESCRIPTION}
                  />
                </div>
              ) : (
                <MotionList className="space-y-3">
                  {rows.map((r) => (
                    <MotionItem key={r.id}>
                      <Link
                        href={`/admin/finance/journal-entries/${r.id}`}
                        className="group flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between p-5 rounded-lg border border-slate-200/90 bg-white dark:border-white/5 shadow-sm transform-gpu transition-all hover:border-primary-300 dark:hover:border-primary-500/40 hover:shadow-md"
                      >
                        <div className="min-w-0 flex items-start gap-4">
                          <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 flex items-center justify-center shrink-0 group-hover:bg-primary-50 dark:group-hover:bg-primary-500/10 group-hover:border-primary-200 dark:group-hover:border-primary-500/20 transition-colors mt-0.5">
                            <BookOpenText className="w-5 h-5 text-slate-400 group-hover:text-primary-500 transition-colors" />
                          </div>
                          <div className="flex flex-col gap-2">
                            <div className="flex items-center gap-3">
                              <Badge
                                className={cn(
                                  "uppercase tracking-wider font-mono text-[9px] font-bold shadow-sm px-2.5 py-1 rounded-full border",
                                  r.status === "posted"
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400"
                                    : "bg-amber-50 text-amber-700 border-amber-200 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400",
                                )}
                              >
                                {r.status}
                              </Badge>
                              <span className="text-xs font-mono tracking-wider text-slate-500 dark:text-slate-400 uppercase">
                                Entry: {r.entry_date}
                              </span>
                            </div>
                            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 tracking-tight">
                              {r.memo ? (
                                <span className="line-clamp-2 leading-snug">{r.memo}</span>
                              ) : (
                                <span className="italic text-slate-400">No memo provided</span>
                              )}
                            </p>
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center justify-end">
                          <div className="h-8 w-8 rounded-full border border-slate-200 dark:border-white/10 flex items-center justify-center group-hover:border-primary-200 dark:group-hover:border-primary-500/20 group-hover:bg-primary-50 dark:group-hover:bg-primary-500/10 transition-colors shrink-0">
                            <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors" />
                          </div>
                        </div>
                      </Link>
                    </MotionItem>
                  ))}
                </MotionList>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
