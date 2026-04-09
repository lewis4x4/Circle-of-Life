"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Utensils } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { csvEscapeCell, triggerCsvDownload } from "@/lib/csv-export";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { Sparkline } from "@/components/ui/moonshot/sparkline";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { PulseDot } from "@/components/ui/moonshot/pulse-dot";

type DietRow = Database["public"]["Tables"]["diet_orders"]["Row"] & {
  residents: { first_name: string; last_name: string } | null;
};

function fluidIsThickened(level: string): boolean {
  return level.includes("mildly") || level.includes("moderately") || level.includes("extremely");
}

function dietOrderNeedsAttention(row: DietRow): boolean {
  if (row.status === "draft") return true;
  if (row.requires_swallow_eval) return true;
  if (row.medication_texture_review_notes?.trim()) return true;
  return Boolean(row.aspiration_notes?.trim());
}

function attentionBadge(row: DietRow): { label: string; barClass: string; badgeClass: string } {
  if (row.status === "draft") {
    return {
      label: "Draft order",
      barClass: "bg-amber-500",
      badgeClass: "text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20",
    };
  }
  if (row.requires_swallow_eval) {
    return {
      label: "Swallow eval",
      barClass: "bg-rose-500",
      badgeClass: "text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20",
    };
  }
  if (row.medication_texture_review_notes?.trim()) {
    return {
      label: "Med / texture review",
      barClass: "bg-violet-500",
      badgeClass: "text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-500/10 border-violet-200 dark:border-violet-500/20",
    };
  }
  return {
    label: "Aspiration notes",
    barClass: "bg-orange-500",
    badgeClass: "text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-500/10 border-orange-200 dark:border-orange-500/20",
  };
}

function attentionSummary(row: DietRow): string {
  const med = row.medication_texture_review_notes?.trim();
  if (med) return med;
  const note = row.aspiration_notes?.trim();
  if (note) return note;
  if (row.status === "draft") return "Diet order is still in draft and needs activation.";
  if (row.requires_swallow_eval) return "Marked for swallow evaluation follow-up.";
  return "Review diet order details.";
}

function formatRelativeShort(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diffMs = Date.now() - t;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(iso));
}

function buildDietOrdersCsv(rows: DietRow[]): string {
  const header = [
    "id",
    "organization_id",
    "facility_id",
    "resident_id",
    "resident_first_name",
    "resident_last_name",
    "status",
    "iddsi_food_level",
    "iddsi_fluid_level",
    "requires_swallow_eval",
    "allergy_constraints",
    "texture_constraints",
    "aspiration_notes",
    "medication_texture_review_notes",
    "effective_from",
    "effective_to",
    "created_at",
    "updated_at",
  ].join(",");
  const body = rows.map((row) => {
    const allergy = row.allergy_constraints?.join(" | ") ?? "";
    const texture = row.texture_constraints?.join(" | ") ?? "";
    return [
      csvEscapeCell(row.id),
      csvEscapeCell(row.organization_id),
      csvEscapeCell(row.facility_id),
      csvEscapeCell(row.resident_id),
      csvEscapeCell(row.residents?.first_name ?? ""),
      csvEscapeCell(row.residents?.last_name ?? ""),
      csvEscapeCell(row.status),
      csvEscapeCell(row.iddsi_food_level),
      csvEscapeCell(row.iddsi_fluid_level),
      csvEscapeCell(String(row.requires_swallow_eval)),
      csvEscapeCell(allergy),
      csvEscapeCell(texture),
      csvEscapeCell(row.aspiration_notes ?? ""),
      csvEscapeCell(row.medication_texture_review_notes ?? ""),
      csvEscapeCell(row.effective_from ?? ""),
      csvEscapeCell(row.effective_to ?? ""),
      csvEscapeCell(row.created_at),
      csvEscapeCell(row.updated_at),
    ].join(",");
  });
  return [header, ...body].join("\r\n");
}

export default function AdminDietaryHubPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<DietRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportingCsv, setExportingCsv] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setRows([]);
      setLoading(false);
      return;
    }
    try {
      const { data, error: qErr } = await supabase
        .from("diet_orders")
        .select("*, residents(first_name, last_name)")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(50);
      if (qErr) throw qErr;
      setRows((data ?? []) as DietRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load diet orders.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportDietOrdersCsv = useCallback(async () => {
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) return;
    setExportingCsv(true);
    setError(null);
    try {
      const { data, error: qErr } = await supabase
        .from("diet_orders")
        .select("*, residents(first_name, last_name)")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(500);
      if (qErr) throw qErr;
      const exportRows = (data ?? []) as DietRow[];
      const csv = buildDietOrdersCsv(exportRows);
      triggerCsvDownload(`diet-orders_${format(new Date(), "yyyy-MM-dd")}.csv`, csv);
    } catch (e) {
      setError(e instanceof Error ? e.message : "CSV export failed.");
    } finally {
      setExportingCsv(false);
    }
  }, [selectedFacilityId, supabase]);

  const attentionRows = useMemo(
    () =>
      rows
        .filter(dietOrderNeedsAttention)
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
    [rows],
  );

  const attentionIds = useMemo(() => new Set(attentionRows.map((r) => r.id)), [attentionRows]);

  const rosterRows = useMemo(
    () => rows.filter((r) => !attentionIds.has(r.id)).slice(0, 8),
    [rows, attentionIds],
  );

  const batchStats = useMemo(() => {
    const n = rows.length;
    if (n === 0) {
      return { thickenedPct: 0, swallowPct: 0, allergyPct: 0, medTexturePct: 0 };
    }
    const thickened = rows.filter((r) => fluidIsThickened(r.iddsi_fluid_level)).length;
    const swallow = rows.filter((r) => r.requires_swallow_eval).length;
    const allergy = rows.filter((r) => r.allergy_constraints.length > 0).length;
    const medTexture = rows.filter((r) => r.medication_texture_review_notes?.trim()).length;
    return {
      thickenedPct: Math.round((thickened / n) * 100),
      swallowPct: Math.round((swallow / n) * 100),
      allergyPct: Math.round((allergy / n) * 100),
      medTexturePct: Math.round((medTexture / n) * 100),
    };
  }, [rows]);

  const facilityReady = Boolean(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix hasCriticals={false} 
        primaryClass="bg-indigo-700/10"
        secondaryClass="bg-blue-900/10"
      />
      
      <div className="relative z-10 space-y-6">
        
        {/* ─── MOONSHOT HEADER ─── */}
        <div className="flex flex-col gap-6 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
           <div className="space-y-2">
             <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 mb-2">
                 SYS: Module 14
             </div>
             <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
                Dietary & Nutrition
             </h1>
             <p className="mt-2 font-medium tracking-wide text-slate-600 dark:text-zinc-400 max-w-2xl">
               IDDSI food and fluid levels with allergy constraints. Manage therapeutic diet orders across your facility.
             </p>
           </div>
           <div className="flex flex-wrap items-center gap-3 justify-end">
              <Button
                type="button"
                variant="outline"
                disabled={!facilityReady || exportingCsv}
                className="h-12 rounded-full px-6 font-bold uppercase tracking-widest text-[10px] border-slate-200 dark:border-white/10"
                onClick={() => void exportDietOrdersCsv()}
              >
                {exportingCsv ? "Preparing…" : "Download diet orders CSV"}
              </Button>
              <Link
                href="/admin/dietary/clinical-review"
                className={cn(
                  buttonVariants({ variant: "outline", size: "default" }),
                  "h-12 px-6 rounded-full font-bold uppercase tracking-widest text-[10px] border-slate-200 dark:border-white/10",
                )}
              >
                Med / diet review
              </Link>
              <Link href="/admin/dietary/new" className={cn(buttonVariants({ size: "default" }), "h-14 px-8 rounded-full font-bold uppercase tracking-widest text-xs tap-responsive bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg")} >
                + New Diet Order
              </Link>
           </div>
        </div>

        <KineticGrid className="grid-cols-1 md:grid-cols-3 gap-4 mb-6" staggerMs={75}>
          <div className="h-[160px] md:col-span-3">
            <V2Card hoverColor="indigo" className="border-indigo-500/20 dark:border-indigo-500/20 shadow-[0_8px_30px_rgba(99,102,241,0.05)]">
              <Sparkline colorClass="text-indigo-500" variant={3} />
              <MonolithicWatermark value={rows.length} className="text-indigo-600/5 dark:text-indigo-400/5 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between p-2">
                <h3 className="text-[11px] font-bold tracking-widest uppercase text-indigo-600 dark:text-indigo-400 flex items-center gap-2">
                  <Utensils className="h-4 w-4" /> Active Diet Orders
                </h3>
                <p className="text-6xl font-display tracking-tight font-medium text-indigo-600 dark:text-indigo-400 pb-1">{rows.length}</p>
              </div>
            </V2Card>
          </div>
        </KineticGrid>

      {!facilityReady && (
        <p className="rounded-[1.5rem] border border-amber-200 bg-amber-50 px-6 py-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100 shadow-sm font-medium">
          Select a facility to load diet orders.
        </p>
      )}

      {error && (
        <p className="rounded-[1.5rem] border border-red-200 bg-red-50 px-6 py-4 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100 shadow-sm font-medium">
          {error}
        </p>
      )}

      {facilityReady && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* ACTION QUEUE: Dietary Risk Board */}
          <div className="col-span-1 lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between pb-2">
              <h3 className="text-[12px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 flex items-center gap-2">
                <PulseDot colorClass="bg-indigo-500" /> Attention Queue
              </h3>
            </div>
            
            <MotionList className="space-y-4">
              {loading ? (
                <p className="text-sm font-mono text-slate-500">Loading…</p>
              ) : rows.length === 0 ? (
                <div className="p-12 text-center text-slate-500 bg-white/50 dark:bg-white/[0.02] rounded-[2.5rem] border border-dashed border-slate-200 dark:border-white/10 backdrop-blur-md">
                   <p className="font-semibold text-lg text-slate-900 dark:text-slate-100">No diet orders</p>
                  <p className="text-sm opacity-80 mt-1">No active diet orders for this facility yet.</p>
                </div>
              ) : attentionRows.length === 0 ? (
                <div className="p-12 text-center text-slate-500 bg-white/50 dark:bg-white/[0.02] rounded-[2.5rem] border border-dashed border-slate-200 dark:border-white/10 backdrop-blur-md">
                  <p className="font-semibold text-lg text-slate-900 dark:text-slate-100">All Clear</p>
                  <p className="text-sm opacity-80 mt-1">
                    No draft orders, swallow-evaluation flags, med/texture review notes, or aspiration notes in this batch.
                  </p>
                </div>
              ) : (
                attentionRows.map((row) => {
                  const badge = attentionBadge(row);
                  return (
                    <MotionItem
                      key={row.id}
                      className="p-6 rounded-[2rem] border border-slate-200/80 dark:border-white/10 bg-white dark:bg-white/5 shadow-sm tap-responsive group hover:border-indigo-300 dark:hover:border-indigo-500/30 transition-colors relative overflow-hidden"
                    >
                      <div className={cn("absolute top-0 left-0 w-1.5 h-full", badge.barClass)} />
                      <div className="flex justify-between items-start mb-4 gap-2 pl-2">
                        <span
                          className={cn(
                            "text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-widest border",
                            badge.badgeClass,
                          )}
                        >
                          {badge.label}
                        </span>
                        <span className="text-xs text-slate-400 font-bold uppercase tracking-widest">
                          Updated: {formatRelativeShort(row.updated_at)}
                        </span>
                      </div>
                      <div className="mb-5 pl-2">
                        <p className="text-xl font-semibold text-slate-900 dark:text-slate-100 tracking-tight mb-2">
                          {row.residents ? `${row.residents.first_name} ${row.residents.last_name}` : "Resident"}
                        </p>
                        <p className="text-sm font-medium text-slate-600 dark:text-slate-400">{attentionSummary(row)}</p>
                      </div>
                      <div className="flex justify-start pl-2 mt-2">
                        <Link
                          href={`/admin/dietary/clinical-review?resident=${row.resident_id}`}
                          className={cn(
                            buttonVariants({ variant: "default", size: "sm" }),
                            "h-10 rounded-full px-6 bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:text-black dark:hover:bg-slate-200 font-bold uppercase tracking-widest text-[10px]",
                          )}
                        >
                          Clinical review
                        </Link>
                      </div>
                    </MotionItem>
                  );
                })
              )}
            </MotionList>

            {!loading && rows.length > 0 && rosterRows.length > 0 && (
              <div className="glass-panel mt-10 p-6 rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.015]">
                <h4 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 mb-4 ml-2">Other Active Diet Orders</h4>
                <MotionList className="space-y-3">
                  {rosterRows.map((row) => (
                    <MotionItem
                      key={row.id}
                      className="p-4 rounded-[1.5rem] border border-slate-200/60 dark:border-white/5 bg-white dark:bg-white/[0.03] flex flex-col md:flex-row gap-4 md:items-center justify-between group hover:border-indigo-200 dark:hover:border-indigo-500/20 transition-colors shadow-sm"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-200 tracking-tight truncate flex items-center gap-2">
                          {row.residents ? `${row.residents.first_name} ${row.residents.last_name}` : "Unknown"}
                        </p>
                        <p className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate capitalize mt-1">
                          Food: {row.iddsi_food_level.replace(/_/g, " ")} &middot; Fluids: {row.iddsi_fluid_level.replace(/_/g, " ")}
                        </p>
                      </div>
                      {fluidIsThickened(row.iddsi_fluid_level) ? (
                        <span className="text-[10px] font-bold uppercase tracking-widest text-amber-600 bg-amber-50 border border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/20 dark:text-amber-400 px-3 py-1.5 rounded-full shrink-0 h-fit">
                          Thickened
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 bg-slate-100 border border-slate-200 dark:bg-white/5 dark:border-white/10 px-3 py-1.5 rounded-full shrink-0 h-fit">
                          Standard
                        </span>
                      )}
                    </MotionItem>
                  ))}
                </MotionList>
              </div>
            )}
            
          </div>

          {/* WATCHLIST: Kitchen Operations Context */}
          <div className="col-span-1 border-l border-transparent dark:border-transparent lg:pl-6 pt-6 lg:pt-0">
            <div className="glass-panel p-6 rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02]">
              <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-200 dark:border-white/5">
                <h3 className="text-[12px] font-bold uppercase tracking-widest text-slate-800 dark:text-slate-200">
                  Therapeutic Context
                </h3>
              </div>
              
              <div className="space-y-4">
                <div className="p-5 rounded-[1.5rem] border border-slate-200/80 dark:border-white/10 bg-white dark:bg-white/[0.03] flex flex-col gap-3 shadow-sm">
                  <div className="flex justify-between items-center">
                    <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">Thickened Fluids</p>
                    <span className="text-xs font-bold text-amber-500 bg-amber-50 dark:bg-amber-500/10 px-2 py-0.5 rounded-md">{loading ? "—" : `${batchStats.thickenedPct}%`}</span>
                  </div>
                  <div className="w-full bg-slate-100 dark:bg-slate-800/60 rounded-full h-2 overflow-hidden shadow-inner">
                    <div
                      className="bg-amber-500 h-2 rounded-full transition-all duration-1000 ease-out"
                      style={{ width: `${loading ? 0 : batchStats.thickenedPct}%` }}
                    />
                  </div>
                </div>
                
                <div className="p-5 rounded-[1.5rem] border border-slate-200/80 dark:border-white/10 bg-white dark:bg-white/[0.03] flex flex-col gap-3 shadow-sm">
                  <div className="flex justify-between items-center">
                    <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">Swallow Flags</p>
                    <span className="text-xs font-bold text-rose-500 bg-rose-50 dark:bg-rose-500/10 px-2 py-0.5 rounded-md">{loading ? "—" : `${batchStats.swallowPct}%`}</span>
                  </div>
                  <div className="w-full bg-slate-100 dark:bg-slate-800/60 rounded-full h-2 overflow-hidden shadow-inner">
                    <div
                      className="bg-rose-500 h-2 rounded-full transition-all duration-1000 ease-out"
                      style={{ width: `${loading ? 0 : batchStats.swallowPct}%` }}
                    />
                  </div>
                </div>
                
                <div className="p-5 rounded-[1.5rem] border border-slate-200/80 dark:border-white/10 bg-white dark:bg-white/[0.03] flex flex-col gap-3 shadow-sm">
                  <div className="flex justify-between items-center">
                    <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">Allergy Alert</p>
                    <span className="text-xs font-bold text-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 px-2 py-0.5 rounded-md">{loading ? "—" : `${batchStats.allergyPct}%`}</span>
                  </div>
                  <div className="w-full bg-slate-100 dark:bg-slate-800/60 rounded-full h-2 overflow-hidden shadow-inner">
                    <div
                      className="bg-indigo-500 h-2 rounded-full transition-all duration-1000 ease-out"
                      style={{ width: `${loading ? 0 : batchStats.allergyPct}%` }}
                    />
                  </div>
                </div>
                
                <div className="p-5 rounded-[1.5rem] border border-slate-200/80 dark:border-white/10 bg-white dark:bg-white/[0.03] flex flex-col gap-3 shadow-sm">
                  <div className="flex justify-between items-center">
                    <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">Texture Reviews</p>
                    <span className="text-xs font-bold text-violet-500 bg-violet-50 dark:bg-violet-500/10 px-2 py-0.5 rounded-md">{loading ? "—" : `${batchStats.medTexturePct}%`}</span>
                  </div>
                  <div className="w-full bg-slate-100 dark:bg-slate-800/60 rounded-full h-2 overflow-hidden shadow-inner">
                    <div
                      className="bg-violet-500 h-2 rounded-full transition-all duration-1000 ease-out"
                      style={{ width: `${loading ? 0 : batchStats.medTexturePct}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      )}
      </div>
    </div>
  );
}
