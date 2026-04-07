"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";

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

export default function AdminSearchPage() {
  const availableFacilities = useFacilityStore((s) => s.availableFacilities);

  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [rows, setRows] = useState<SearchDocRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 320);
    return () => window.clearTimeout(t);
  }, [q]);

  const runSearch = useCallback(async () => {
    const query = debounced;
    if (query.length < 2) {
      setRows([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data, error: qErr } = await supabase
        .from("search_documents")
        .select("id, source_table, source_id, label, facility_id, updated_at")
        .textSearch("search_tsv", query, { type: "websearch", config: "english" })
        .limit(40);
      if (qErr) throw qErr;
      setRows((data ?? []) as SearchDocRow[]);
    } catch (e) {
      setRows([]);
      setError(e instanceof Error ? e.message : "Search failed.");
    } finally {
      setLoading(false);
    }
  }, [debounced]);

  useEffect(() => {
    void runSearch();
  }, [runSearch]);

  const facName = (facilityId: string | null) => {
    if (!facilityId) return "Organization";
    return availableFacilities.find((f) => f.id === facilityId)?.name ?? "Facility";
  };

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix hasCriticals={false} 
        primaryClass="bg-indigo-700/10"
        secondaryClass="bg-slate-900/10"
      />
      
      <div className="relative z-10 space-y-6">
        <header className="mb-8">
          <div>
            <p className="text-[10px] uppercase font-mono tracking-widest text-slate-500 mb-2">SYS: Module 00 / Global Index</p>
            <h2 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-3">
              Unified Search
            </h2>
          </div>
        </header>

        <KineticGrid className="grid-cols-1" staggerMs={75}>
          <div className="col-span-1 min-h-[160px]">
            <V2Card hoverColor="slate">
              <MonolithicWatermark value={loading ? "?" : rows.length} className="text-slate-800/5 dark:text-white/5 opacity-50" />
              <div className="relative z-10 flex flex-col h-full">
            <div className="mb-6">
              <h3 className="text-[10px] font-mono tracking-widest uppercase text-slate-500 mb-1 flex items-center gap-2">
                Search the Platform
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">Lexical index over linked records.</p>
            </div>
            <div className="space-y-6 max-w-3xl">
              <div className="flex gap-2">
                <div className="relative flex-1 group">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
                  <Input
                    id="admin-search-q"
                    className="pl-9 placeholder:text-slate-400 border-slate-200 dark:border-slate-800 shadow-none focus-visible:ring-indigo-500 h-11"
                    placeholder="Search query (min 2 chars)…"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <Button type="button" className="tap-responsive bg-indigo-600 hover:bg-indigo-700 text-white dark:bg-indigo-500 dark:hover:bg-indigo-600 border-none min-w-[100px] h-11" onClick={() => void runSearch()} disabled={loading}>
                  {loading ? "Searching…" : "Search"}
                </Button>
              </div>

              {error && <p className="text-sm text-rose-500">{error}</p>}

              {loading && debounced.length >= 2 && (
                <div className="space-y-2">
                  <Skeleton className="h-14 w-full rounded-md" />
                  <Skeleton className="h-14 w-full rounded-md" />
                  <Skeleton className="h-14 w-full rounded-md" />
                </div>
              )}

              {!loading && debounced.length >= 2 && rows.length === 0 && !error && (
                <div className="py-8 text-center text-sm font-mono text-slate-500">
                  NO MATCHES FOUND
                </div>
              )}

          {!loading && rows.length > 0 && (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800 rounded-md border border-slate-100 dark:border-slate-800">
              {rows.map((r) => {
                const href = hrefForSource(r.source_table, r.source_id);
                const title = r.label?.trim() || `${r.source_table} ${r.source_id.slice(0, 8)}…`;
                return (
                  <li key={r.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between group hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors cursor-pointer">
                    <div className="min-w-0">
                      {href ? (
                        <Link
                          href={href}
                          className="font-medium text-primary underline-offset-4 hover:underline"
                        >
                          {title}
                        </Link>
                      ) : (
                        <span className="font-medium text-slate-800 dark:text-slate-200">{title}</span>
                      )}
                      <p className="text-xs text-slate-700 dark:text-slate-300">
                        {r.source_table}
                        {href ? null : " — open record link not configured for this source yet."}
                      </p>
                    </div>
                    <div className="shrink-0 text-xs text-slate-700 dark:text-slate-300">
                      {facName(r.facility_id)}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
              </div>
            </div>
            </V2Card>
          </div>
        </KineticGrid>
      </div>
    </div>
  );
}
