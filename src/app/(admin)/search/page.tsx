"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

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
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          Search
        </h1>
        <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">
          Lexical index over linked records (residents today; more sources as triggers land). Minimum 2
          characters.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Find in Haven</CardTitle>
          <p className="text-sm text-slate-700 dark:text-slate-300">
            Results respect your org and facility access (RLS). Uses the platform search index (
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">search_documents</code>
            ).
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="admin-search-q">Query</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600 dark:text-slate-400" />
                <Input
                  id="admin-search-q"
                  className="pl-9 placeholder:text-slate-600 dark:placeholder:text-slate-400"
                  placeholder="Name or keywords…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <Button type="button" variant="secondary" onClick={() => void runSearch()} disabled={loading}>
                {loading ? "Searching…" : "Search"}
              </Button>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          {loading && debounced.length >= 2 && (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          )}

          {!loading && debounced.length >= 2 && rows.length === 0 && !error && (
            <p className="text-sm text-slate-700 dark:text-slate-300">No matches.</p>
          )}

          {!loading && rows.length > 0 && (
            <ul className="divide-y divide-slate-200 rounded-md border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
              {rows.map((r) => {
                const href = hrefForSource(r.source_table, r.source_id);
                const title = r.label?.trim() || `${r.source_table} ${r.source_id.slice(0, 8)}…`;
                return (
                  <li key={r.id} className="flex flex-col gap-1 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
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
        </CardContent>
      </Card>
    </div>
  );
}
