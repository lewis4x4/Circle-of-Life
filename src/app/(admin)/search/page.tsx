"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  BookOpen,
  Building2,
  Loader2,
  Search,
  ShieldAlert,
  MessageSquare,
  Truck,
  UserCog,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";

type SearchDocRow = Pick<
  Database["public"]["Tables"]["search_documents"]["Row"],
  "id" | "source_table" | "source_id" | "label" | "facility_id" | "updated_at"
>;

function hrefForSource(sourceTable: string, sourceId: string): string | null {
  switch (sourceTable) {
    case "residents":
      return `/admin/residents/${sourceId}`;
    case "staff":
      return `/admin/staff/${sourceId}`;
    case "vendors":
      return `/admin/vendors/${sourceId}`;
    case "incidents":
      return `/admin/incidents/${sourceId}`;
    default:
      return null;
  }
}

// The repository maintains only resident index rows. Other sources remain
// available through their existing modules until transactional indexing ships.
const INDEXED_SOURCE = "residents";
const SEARCH_SOURCES = [
  { icon: Users, label: "Residents", source: INDEXED_SOURCE, mode: "indexed", href: "/admin/residents", hint: "Search names here or open resident directory" },
  { icon: UserCog, label: "Staff", source: "staff", mode: "module", href: "/admin/staff", hint: "Open staff search" },
  { icon: Truck, label: "Vendors", source: "vendors", mode: "module", href: "/admin/vendors/directory", hint: "Open vendor directory" },
  { icon: ShieldAlert, label: "Incidents", source: "incidents", mode: "module", href: "/admin/incidents", hint: "Open incident records" },
] as const;

function sourceLabel(table: string): string {
  const map: Record<string, string> = {
    residents: "Resident",
    staff: "Staff",
    vendors: "Vendor",
    incidents: "Incident",
  };
  return map[table] ?? table.replace(/_/g, " ");
}

export default function AdminSearchPage() {
  const availableFacilities = useFacilityStore((s) => s.availableFacilities);

  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [rows, setRows] = useState<SearchDocRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestGeneration = useRef(0);
  const cancelPendingSearch = useCallback(() => { requestGeneration.current++; }, []);
  const normalizedQuery = q.trim();

  const runSearch = useCallback(async (query: string) => {
    const generation = ++requestGeneration.current;
    if (query.length < 2) {
      setRows([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setRows([]);
    setError(null);
    try {
      const supabase = createClient();
      const { data, error: qErr } = await supabase
        .from("search_documents")
        .select("id, source_table, source_id, label, facility_id, updated_at")
        .eq("source_table", INDEXED_SOURCE)
        .textSearch("search_tsv", query, { type: "websearch", config: "english" })
        .limit(40);
      if (generation !== requestGeneration.current) return;
      if (qErr) throw qErr;
      setRows(((data ?? []) as SearchDocRow[]).filter((row) => row.source_table === INDEXED_SOURCE));
    } catch (e) {
      if (generation !== requestGeneration.current) return;
      setRows([]);
      setError(e instanceof Error ? e.message : "Search failed.");
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Schedule from the input, even when it returns to the previous search.
    const timer = window.setTimeout(() => {
      setDebounced(normalizedQuery);
      void runSearch(normalizedQuery);
    }, 320);
    return () => {
      window.clearTimeout(timer);
      cancelPendingSearch();
    };
  }, [normalizedQuery, runSearch, cancelPendingSearch]);

  const facName = (facilityId: string | null) => {
    if (!facilityId) return "Organization";
    return availableFacilities.find((f) => f.id === facilityId)?.name ?? "Facility";
  };

  const showHero = debounced.length < 2;
  const showResultsPanel = debounced.length >= 2;

  return (
    <div className="-mx-6 -mt-6 mb-0 flex min-h-0 max-h-[calc(100dvh-7.5rem)] h-[calc(100dvh-7.5rem)] flex-1 flex-col lg:-mx-10">
      <div
        className={cn(
          "relative flex min-h-0 min-w-0 flex-1 flex-col",
          "bg-[radial-gradient(ellipse_120%_80%_at_50%_-20%,rgba(99,102,241,0.12),transparent)]",
          "dark:bg-[#050505]"
        )}
      >
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-4xl px-4 pb-8 pt-6 sm:px-6">
            {/* Wayfinding — same voice as Knowledge, not “SYS module” */}
            <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex flex-col gap-3">
                <div className="inline-flex w-fit items-center gap-2 rounded-full border border-primary-500/25 bg-primary-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-primary-200">
                  <MessageSquare className="size-3.5 text-primary-400" aria-hidden />
                  Find records
                </div>
                <h1 className="text-3xl font-semibold tracking-tight text-zinc-100 sm:text-4xl">
                  Unified Search
                </h1>
                <p className="max-w-xl text-base leading-relaxed text-zinc-400">
                  Resident names are searched here across facilities your account can access. Staff, vendors and incidents are available in their own modules below.
                </p>
              </div>
              <Link
                href="/admin/knowledge"
                className="group flex shrink-0 items-center gap-3 rounded-2xl border border-zinc-700/80 bg-zinc-900/50 px-4 py-3 transition hover:border-primary-500/40 hover:bg-primary-950/30"
              >
                <span className="flex size-10 items-center justify-center rounded-xl shadow-lg shadow-[var(--shadow-card)]">
                  <BookOpen className="size-5 text-white" aria-hidden />
                </span>
                <span className="text-left">
                  <span className="block text-xs font-semibold uppercase tracking-wide text-zinc-500">Policies &amp; docs</span>
                  <span className="flex items-center gap-1 text-sm font-medium text-zinc-200">
                    Open Knowledge Base
                    <ArrowUpRight className="size-3.5 opacity-70 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </span>
                </span>
              </Link>
            </div>

            {showHero && (
              <div className="mb-10 flex flex-col items-center gap-10">
                <div className="flex flex-col items-center gap-4 text-center">
                  <div
                    className="flex h-16 w-16 items-center justify-center rounded-2xl shadow-[0_0_32px_rgba(99,102,241,0.35)]"
                    aria-hidden
                  >
                    <Search className="size-8 text-white" strokeWidth={2} />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold text-zinc-100 sm:text-2xl">What are you looking for?</h2>
                    <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-zinc-500">
                      Type at least two characters of a resident name, or open a record module.
                    </p>
                  </div>
                </div>

                <div className="grid w-full max-w-3xl grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
                  {SEARCH_SOURCES.map((s) => {
                    const Icon = s.icon;
                    return (
                      <Link
                        key={s.label}
                        href={s.href}
                        className="group flex w-full flex-col items-start gap-2 rounded-2xl border border-zinc-700/80 bg-zinc-900/60 px-5 py-4 text-left shadow-sm  transition hover:border-primary-500/50 hover:bg-primary-950/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <div className="flex w-full items-center gap-3">
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary-500/15 text-primary-400 ring-1 ring-ring">
                            <Icon className="size-4" />
                          </span>
                          <span className="text-sm font-semibold text-zinc-200">{s.label}</span>
                        </div>
                        <p className="pl-12 text-sm font-medium leading-snug text-primary-300/90">{s.mode === "indexed" ? "Available in this search" : "Available in its module"}</p>
                        <p className="pl-12 text-xs text-zinc-500 group-hover:text-zinc-400">{s.hint}</p>
                      </Link>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-zinc-600">
                  <Building2 className="size-3.5" aria-hidden />
                  <span>Limited to records your account can access.</span>
                </div>
              </div>
            )}

            {showResultsPanel && (
              <nav aria-label="Other record modules" className="mb-5 flex flex-wrap gap-4 text-sm text-primary-300">
                {SEARCH_SOURCES.filter((source) => source.mode === "module").map((source) => (
                  <Link key={source.source} href={source.href} className="underline underline-offset-4">{source.hint}</Link>
                ))}
              </nav>
            )}

            {showResultsPanel && (
              <section className="space-y-4" aria-live="polite">
                <div className="flex items-center justify-between gap-2 border-b border-zinc-800/90 pb-3">
                  <h2 className="text-sm font-semibold text-zinc-300">Results</h2>
                  {!loading && !error && (
                    <span className="font-mono text-xs tabular-nums text-zinc-500">
                      {rows.length} match{rows.length === 1 ? "" : "es"}
                    </span>
                  )}
                </div>

                {error && (
                  <div className="rounded-xl border border-red-800/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div>
                )}

                {loading && (
                  <div className="space-y-3">
                    <Skeleton className="h-16 w-full rounded-xl border border-zinc-800/50 bg-zinc-900/80" />
                    <Skeleton className="h-16 w-full rounded-xl border border-zinc-800/50 bg-zinc-900/80" />
                    <Skeleton className="h-16 w-full rounded-xl border border-zinc-800/50 bg-zinc-900/80" />
                  </div>
                )}

                {!loading && !error && rows.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-zinc-700/80 bg-zinc-900/40 px-6 py-14 text-center">
                    <p className="font-medium text-zinc-300">No matching residents</p>
                    <p className="mx-auto mt-2 max-w-md text-sm text-zinc-500">
                      Try another spelling or a shorter resident name. Staff, vendors and incidents are searched or browsed in their own modules; this result does not check those records.
                    </p>
                  </div>
                )}

                {!loading && rows.length > 0 && (
                  <ul className="space-y-2 pb-4">
                    {rows.map((r) => {
                      const href = hrefForSource(r.source_table, r.source_id);
                      const title = r.label?.trim() || `${r.source_table} ${r.source_id.slice(0, 8)}…`;
                      return (
                        <li
                          key={r.id}
                          className="rounded-2xl border border-zinc-800/90 bg-zinc-900/50 transition hover:border-primary-500/35 hover:bg-zinc-900/90"
                        >
                          <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                            <div className="min-w-0 flex-1">
                              <div className="mb-1 flex flex-wrap items-center gap-2">
                                <span className="rounded-md bg-zinc-800/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                                  {sourceLabel(r.source_table)}
                                </span>
                              </div>
                              {href ? (
                                <Link
                                  href={href}
                                  className="font-medium text-primary-300 underline-offset-4 hover:text-primary-200 hover:underline"
                                >
                                  {title}
                                </Link>
                              ) : (
                                <>
                                  <span className="font-medium text-zinc-100">{title}</span>
                                  <p className="mt-1 text-xs text-amber-200/90">
                                    Deep link not configured for this record type yet.
                                  </p>
                                </>
                              )}
                            </div>
                            <div className="flex shrink-0 items-center gap-2 text-xs text-zinc-500">
                              <span className="inline-flex items-center gap-1 rounded-lg bg-zinc-800/80 px-2.5 py-1 text-zinc-300">
                                {facName(r.facility_id)}
                              </span>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            )}
          </div>
        </div>

        {/* Pinned composer — Knowledge Base pattern */}
        <div className="shrink-0 border-t border-zinc-800/90 bg-zinc-950/95 px-4 py-4  pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto flex w-full max-w-4xl items-end gap-2 rounded-2xl border border-zinc-700/90 bg-zinc-900/90 p-2 pl-3 shadow-[0_-4px_24px_rgba(0,0,0,0.35)] ring-1 ring-white/5">
            <div className="relative mb-0.5 flex min-w-0 flex-1 items-center gap-2 pl-1">
              <Search className="size-5 shrink-0 text-zinc-500" aria-hidden />
              <Input
                id="admin-search-q"
                className="h-11 border-0 bg-transparent px-0 text-base text-zinc-100 shadow-none placeholder:text-zinc-600 focus-visible:ring-0"
                placeholder="Search resident names…"
                value={q}
                onChange={(e) => {
                  const next = e.target.value;
                  if (next.trim() !== normalizedQuery) {
                    cancelPendingSearch();
                    setRows([]);
                    setError(null);
                    setLoading(false);
                  }
                  setQ(next);
                }}
                autoComplete="off"
                aria-label="Unified search query"
              />
            </div>
            <Button
              type="button"
              className="h-11 shrink-0 rounded-xl bg-primary-600 px-5 text-white hover:bg-primary-500 dark:bg-primary-600 dark:hover:bg-primary-500"
              onClick={() => void runSearch(q.trim())}
              disabled={loading || q.trim().length < 2}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                  Search
                </>
              ) : (
                "Search"
              )}
            </Button>
          </div>
          <p className="mx-auto mt-2 max-w-4xl px-1 text-center text-[11px] text-zinc-600">
            Minimum 2 characters. For policy questions and document-grounded answers, use{" "}
            <Link href="/admin/knowledge" className="text-primary-400 underline-offset-2 hover:text-primary-300 hover:underline">
              Knowledge Base
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
