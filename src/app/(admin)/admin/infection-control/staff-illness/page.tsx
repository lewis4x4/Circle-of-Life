"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { buttonVariants } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { TableRow, TableRowHeader } from "@/components/ui/table-row";
import { cn } from "@/lib/utils";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { format, parseISO } from "date-fns";

type Row = {
  id: string;
  staff_id: string;
  reported_date: string;
  illness_type: string;
  absent_from: string;
  absent_to: string | null;
  return_cleared: boolean;
  staff: { first_name: string; last_name: string } | null;
};

export default function StaffIllnessListPage() {
  const { selectedFacilityId } = useFacilityStore();
  const supabase = createClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
        setRows([]);
        return;
      }
      const { data, error } = await supabase
        .from("staff_illness_records")
        .select("id, staff_id, reported_date, illness_type, absent_from, absent_to, return_cleared, staff(first_name, last_name)")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("reported_date", { ascending: false })
        .limit(50);
      if (error) throw error;
      setRows((data ?? []) as unknown as Row[]);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6 pb-12">
      <div className="space-y-6 max-w-5xl mx-auto">
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-card p-8 rounded-lg border border-border mt-4">
          <div className="space-y-2">
            <Link href="/admin/infection-control" className={cn(buttonVariants({ variant: "link", size: "sm" }), "h-auto p-0 text-xs text-muted-foreground mb-2 uppercase tracking-wider")}>
              ← Infection control
            </Link>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground flex items-center gap-4">
              Staff Illness {rows.some(r => !r.return_cleared) && <></>}
            </h1>
            <p className="mt-2 text-[13px] text-muted-foreground max-w-2xl">
              Track absences, symptoms, and return-to-work clearances for your workforce.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/admin/infection-control/staff-illness/new" className={cn(buttonVariants({ size: "default" }), "h-9 px-4 text-[10px] font-semibold uppercase tracking-wider bg-destructive hover:bg-destructive/90 text-destructive-foreground")} >
               + Log Illness
            </Link>
          </div>
        </header>

        <div className="p-6 rounded-lg border border-border bg-card/60">
           <div className="flex items-center justify-between pb-4 mb-4 border-b border-border pl-2">
             <h3 className="text-[12px] font-semibold uppercase tracking-wider text-foreground">
               Recent Surveillance Records
             </h3>
             <span className="text-[12px] text-muted-foreground">{loading ? "Loading…" : `${rows.length} shown`}</span>
           </div>

           {loading ? (
             <p className="text-[13px] text-muted-foreground pl-2">Loading records…</p>
           ) : rows.length === 0 ? (
             <div className="p-12 text-center text-muted-foreground bg-muted/40 rounded-lg border border-dashed border-border">
                <p className="font-semibold text-[13px] text-foreground">All Clear</p>
               <p className="text-[12px] opacity-80 mt-1">No staff illnesses reported recently.</p>
             </div>
           ) : (
             <>
               <TableRowHeader>
                 <span className="w-[220px] shrink-0">Status</span>
                 <span className="flex-[2] min-w-0">Staff</span>
                 <span className="flex-1 min-w-0">Illness type</span>
                 <span className="flex-[1.5] min-w-0">Absence</span>
                 <span className="w-[110px] shrink-0">Reported</span>
                 <span className="w-[110px] shrink-0 text-right">Action</span>
               </TableRowHeader>
               <MotionList className="space-y-1 mt-2">
                 {rows.map((r) => {
                   const name = r.staff ? `${r.staff.first_name} ${r.staff.last_name}` : "Unknown Staff";
                   const stillOut = !r.return_cleared;
                   const formatD = (d: string) => format(parseISO(d.length <= 10 ? `${d}T12:00:00.000Z` : d), "MMM d, yyyy");
                   return (
                     <MotionItem key={r.id}>
                       <TableRow>
                         <div className="w-[220px] shrink-0">
                           {stillOut ? (
                             <StatusPill tone="danger">Absent / Pending Clearance</StatusPill>
                           ) : (
                             <StatusPill tone="muted">Cleared to work</StatusPill>
                           )}
                         </div>
                         <span className="flex-[2] min-w-0 truncate text-[13px] font-medium text-foreground">
                           {name}
                         </span>
                         <span className="flex-1 min-w-0 truncate text-[12px] text-muted-foreground capitalize">
                           {r.illness_type}
                         </span>
                         <span className="flex-[1.5] min-w-0 truncate font-mono text-[12px] tabular-nums text-muted-foreground">
                           {formatD(r.absent_from)} {r.absent_to ? `→ ${formatD(r.absent_to)}` : "→ Present"}
                         </span>
                         <span className="w-[110px] shrink-0 font-mono text-[12px] tabular-nums text-muted-foreground">
                           {formatD(r.reported_date)}
                         </span>
                         <div className="w-[110px] shrink-0 flex justify-end">
                           <Link
                             href={`/admin/staff/${r.staff_id}`}
                             className={cn(
                               buttonVariants({ variant: "outline", size: "sm" }),
                               "h-7 px-2.5 text-[10px] font-semibold uppercase tracking-wider"
                             )}
                           >
                             View Staff
                           </Link>
                         </div>
                       </TableRow>
                     </MotionItem>
                   );
                 })}
               </MotionList>
             </>
           )}
        </div>
      </div>
    </div>
  );
}
