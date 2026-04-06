"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ClipboardList, LineChart } from "lucide-react";

import { QualityHubNav } from "./quality-hub-nav";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";

type MeasureRow = Database["public"]["Tables"]["quality_measures"]["Row"];
type LatestRow = Database["public"]["Views"]["quality_latest_facility_measures"]["Row"] & {
  quality_measures?: { name: string; measure_key: string } | null;
};

export default function AdminQualityHubPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [measures, setMeasures] = useState<MeasureRow[]>([]);
  const [latest, setLatest] = useState<LatestRow[]>([]);
  const [pbjRows, setPbjRows] = useState<Database["public"]["Tables"]["pbj_export_batches"]["Row"][]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setMeasures([]);
      setLatest([]);
      setPbjRows([]);
      setLoading(false);
      return;
    }

    try {
      const { data: fac, error: facErr } = await supabase.from("facilities").select("organization_id").eq("id", selectedFacilityId).single();
      if (facErr || !fac?.organization_id) {
        setLoadError("Could not resolve organization for this facility.");
        setMeasures([]);
        setLatest([]);
        setPbjRows([]);
        return;
      }
      const [mRes, viewRes, pbjRes] = await Promise.all([
        supabase
          .from("quality_measures")
          .select("*")
          .eq("organization_id", fac.organization_id)
          .is("deleted_at", null)
          .eq("is_active", true)
          .order("name"),
        supabase.from("quality_latest_facility_measures").select("*").eq("facility_id", selectedFacilityId),
        supabase
          .from("pbj_export_batches")
          .select("*")
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(15),
      ]);

      if (mRes.error) throw mRes.error;
      setMeasures((mRes.data ?? []) as MeasureRow[]);

      if (viewRes.error) throw viewRes.error;
      const rawLatest = (viewRes.data ?? []) as LatestRow[];
      const measureIds = [...new Set(rawLatest.map((r) => r.quality_measure_id).filter(Boolean))] as string[];
      const nameById: Record<string, { name: string; measure_key: string }> = {};
      if (measureIds.length > 0) {
        const { data: mNames } = await supabase.from("quality_measures").select("id, name, measure_key").in("id", measureIds);
        for (const row of mNames ?? []) {
          nameById[row.id] = { name: row.name, measure_key: row.measure_key };
        }
      }
      setLatest(
        rawLatest.map((r) => ({
          ...r,
          quality_measures: r.quality_measure_id ? nameById[r.quality_measure_id] ?? null : null,
        })),
      );

      if (pbjRes.error) throw pbjRes.error;
      setPbjRows((pbjRes.data ?? []) as Database["public"]["Tables"]["pbj_export_batches"]["Row"][]);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load quality data.");
      setMeasures([]);
      setLatest([]);
      setPbjRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const noFacility = !selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId);

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          Quality metrics
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Measure catalog (org), latest facility results, and PBJ export batch metadata.
        </p>
      </div>

      <QualityHubNav />

      {noFacility ? (
        <p className="rounded-lg border border-amber-200/80 bg-amber-50/50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
          Select a facility in the header to load results and PBJ batches. Measures are listed for the facility&apos;s organization.
        </p>
      ) : null}

      {loadError ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {loadError}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-300">Active measures</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-2xl font-semibold tabular-nums">
              {noFacility ? "—" : loading ? "—" : measures.length}
            </p>
          </CardContent>
        </Card>
        <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-300">Latest snapshot rows</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-2xl font-semibold tabular-nums">
              {noFacility ? "—" : loading ? "—" : latest.length}
            </p>
          </CardContent>
        </Card>
        <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-300">PBJ batches</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-2xl font-semibold tabular-nums">
              {noFacility ? "—" : loading ? "—" : pbjRows.length}
            </p>
          </CardContent>
        </Card>
      </div>

      <Link href="/admin/quality/measures/new" className="group block">
        <Card className="border-slate-200/80 shadow-soft transition-colors hover:border-brand-500/40 dark:border-slate-800">
          <CardHeader className="flex flex-row items-start gap-3 space-y-0">
            <div className="rounded-md bg-slate-100 p-2 dark:bg-slate-900">
              <LineChart className="h-5 w-5 text-brand-600 dark:text-brand-400" />
            </div>
            <div>
              <CardTitle className="font-display text-base group-hover:text-brand-700 dark:group-hover:text-brand-300">
                Define a measure
              </CardTitle>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Org admins add catalog rows (<code className="text-[10px]">measure_key</code>, CMS tag optional).
              </p>
            </div>
          </CardHeader>
        </Card>
      </Link>

      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
          <ClipboardList className="h-4 w-4 shrink-0" />
          Measure catalog
        </div>
        <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Key</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Domain</TableHead>
                <TableHead>Unit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {noFacility || loading ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={4} className="py-10 text-center text-sm text-slate-600 dark:text-slate-300">
                    {noFacility ? "Select a facility." : "Loading…"}
                  </TableCell>
                </TableRow>
              ) : measures.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={4} className="py-10 text-center text-sm text-slate-600 dark:text-slate-300">
                    No measures yet. Use <strong>Define a measure</strong> (owner / org admin).
                  </TableCell>
                </TableRow>
              ) : (
                measures.map((m) => (
                  <TableRow key={m.id} className="hover:bg-transparent">
                    <TableCell className="font-mono text-xs">{m.measure_key}</TableCell>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell>{m.domain ?? "—"}</TableCell>
                    <TableCell>{m.unit ?? "—"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="space-y-3">
        <div className="text-sm font-medium text-slate-700 dark:text-slate-200">Latest result per measure (view)</div>
        <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Measure</TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {noFacility || loading ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={3} className="py-10 text-center text-sm text-slate-600 dark:text-slate-300">
                    {noFacility ? "Select a facility." : "Loading…"}
                  </TableCell>
                </TableRow>
              ) : latest.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={3} className="py-10 text-center text-sm text-slate-600 dark:text-slate-300">
                    No results for this facility yet. Import or enter results in a follow-up.
                  </TableCell>
                </TableRow>
              ) : (
                latest.map((r) => (
                  <TableRow key={r.id ?? `${r.quality_measure_id}-${r.period_end}`} className="hover:bg-transparent">
                    <TableCell className="font-medium">
                      {r.quality_measures?.name ?? r.quality_measure_id ?? "—"}
                    </TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-400">
                      {r.period_start ?? "—"} → {r.period_end ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.value_numeric != null
                        ? String(r.value_numeric)
                        : (r.value_text ?? "—")}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="space-y-3">
        <div className="text-sm font-medium text-slate-700 dark:text-slate-200">PBJ export batches</div>
        <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Period</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Rows</TableHead>
                <TableHead className="text-right">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {noFacility || loading ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={4} className="py-10 text-center text-sm text-slate-600 dark:text-slate-300">
                    {noFacility ? "Select a facility." : "Loading…"}
                  </TableCell>
                </TableRow>
              ) : pbjRows.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={4} className="py-10 text-center text-sm text-slate-600 dark:text-slate-300">
                    No PBJ batches recorded. Generation ships in Enhanced.
                  </TableCell>
                </TableRow>
              ) : (
                pbjRows.map((p) => (
                  <TableRow key={p.id} className="hover:bg-transparent">
                    <TableCell>
                      {p.period_start} → {p.period_end}
                    </TableCell>
                    <TableCell className="capitalize">{p.status.replace(/_/g, " ")}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.row_count ?? "—"}</TableCell>
                    <TableCell className="text-right text-slate-600 dark:text-slate-400">
                      {new Date(p.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-sm text-slate-600 dark:text-slate-300">
        <span>Executive KPIs:</span>
        <Link href="/admin/executive" className={cn(buttonVariants({ variant: "link", size: "sm" }), "h-auto p-0 text-xs")}>
          Command center
        </Link>
      </div>
    </div>
  );
}
