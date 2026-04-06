"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { GraduationCap } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { PulseDot } from "@/components/ui/moonshot/pulse-dot";
import { Sparkline } from "@/components/ui/moonshot/sparkline";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";

type DemoRow = Database["public"]["Tables"]["competency_demonstrations"]["Row"] & {
  staff: { first_name: string; last_name: string } | null;
};

function formatStatus(s: string) {
  return s.replace(/_/g, " ");
}

export default function AdminTrainingHubPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<DemoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        .from("competency_demonstrations")
        .select("*, staff(first_name, last_name)")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("demonstrated_at", { ascending: false })
        .limit(50);
      if (qErr) throw qErr;
      setRows((data ?? []) as DemoRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load competency demonstrations.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const facilityReady = Boolean(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix hasCriticals={false} 
        primaryClass="bg-indigo-700/10"
        secondaryClass="bg-slate-900/10"
      />
      
      <div className="relative z-10 space-y-6">
        <header className="mb-8">
          <div>
            <p className="text-[10px] uppercase font-mono tracking-widest text-slate-500 mb-2">SYS: Module 05 / Academy</p>
            <h2 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-3">
              Training & Competency
            </h2>
          </div>
        </header>

        <KineticGrid className="grid-cols-1 md:grid-cols-3 gap-4 mb-6" staggerMs={75}>
          <div className="h-[160px]">
            <V2Card hoverColor="indigo" className="border-indigo-500/20 dark:border-indigo-500/20 shadow-[inset_0_0_15px_rgba(99,102,241,0.05)]">
              <Sparkline colorClass="text-indigo-500" variant={3} />
              <MonolithicWatermark value={rows.length} className="text-indigo-600/5 dark:text-indigo-400/5 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] font-mono tracking-widest uppercase text-indigo-600 dark:text-indigo-400 flex items-center gap-2">
                  <GraduationCap className="h-3.5 w-3.5" /> Demos Completed
                </h3>
                <p className="text-4xl font-mono tracking-tighter text-indigo-600 dark:text-indigo-400 pb-1">{rows.length}</p>
              </div>
            </V2Card>
          </div>
          <div className="col-span-1 md:col-span-2 h-[160px]">
            <V2Card hoverColor="blue" className="flex flex-col justify-center items-start lg:items-end">
              <div className="relative z-10 text-left lg:text-right w-full">
                 <p className="hidden lg:block text-xs font-mono text-slate-500 mb-4">Documented skills demonstrations for the selected facility.</p>
                 <div className="flex gap-2 justify-start lg:justify-end">
                   <Link href="/admin/training/new" className={cn(buttonVariants({ size: "default" }), "font-mono uppercase tracking-widest text-[10px] tap-responsive bg-indigo-600 hover:bg-indigo-700 text-white dark:bg-indigo-500 dark:hover:bg-indigo-600 border-none")} >
                     + New Demonstration
                   </Link>
                 </div>
              </div>
            </V2Card>
          </div>
        </KineticGrid>

      {!facilityReady && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          Select a facility to load competency demonstrations.
        </p>
      )}

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
          {error}
        </p>
      )}

      <div className="relative overflow-hidden rounded-2xl border border-white/10 dark:border-white/5 bg-white/40 dark:bg-[#0A0A0A]/50 backdrop-blur-2xl shadow-2xl">
        <div className="absolute inset-0 bg-gradient-to-b from-white/40 to-white/10 dark:from-white/5 dark:to-transparent pointer-events-none" />
        <div className="relative z-10 border-b border-white/20 dark:border-white/10 bg-white/20 dark:bg-black/20 p-6 flex flex-col gap-1">
          <h3 className="text-lg font-display font-semibold text-slate-900 dark:text-slate-100">Demonstrations</h3>
          <p className="text-sm font-mono text-slate-500 dark:text-slate-400">
            Skills checklist JSON and attachment paths are stored on each row; file uploads are Enhanced.
          </p>
        </div>
        <div className="relative z-10 overflow-x-auto p-4 sm:p-6">
          {loading ? (
            <p className="text-sm font-mono text-slate-500">Loading…</p>
          ) : !facilityReady ? null : rows.length === 0 ? (
            <p className="text-sm font-mono text-slate-500">No competency demonstrations for this facility yet.</p>
          ) : (
            <Table>
              <TableHeader className="bg-white/40 dark:bg-black/40 border-b border-white/20 dark:border-white/10">
                <TableRow className="border-none hover:bg-transparent">
                  <TableHead>Staff</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Demonstrated</TableHead>
                  <TableHead>Evaluator</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} className="border-slate-100 dark:border-slate-800 hover:bg-indigo-500/5 dark:hover:bg-indigo-500/10 transition-colors cursor-pointer group">
                    <TableCell>
                      {row.staff ? `${row.staff.first_name} ${row.staff.last_name}` : "—"}
                    </TableCell>
                    <TableCell className="capitalize">{formatStatus(row.status)}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {format(new Date(row.demonstrated_at), "MMM d, yyyy p")}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-600 dark:text-slate-300">
                      {row.evaluator_user_id.slice(0, 8)}…
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
