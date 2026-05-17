"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { format, parseISO } from "date-fns";

type Row = {
  id: string;
  title: string;
  category: string;
  version: number;
  status: string;
  published_at: string | null;
};

export default function PoliciesListPage() {
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
        .from("policy_documents")
        .select("id, title, category, version, status, published_at")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false });
      if (!error && data) setRows(data as Row[]);
      else setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const ready = !!(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));

  return (
    <div className="space-y-6 pb-12">
      <div className="space-y-6 max-w-5xl mx-auto">
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-card p-8 rounded-lg border border-border mt-4">
          <div className="space-y-2">
            <Link href="/admin/compliance" className={cn(buttonVariants({ variant: "link", size: "sm" }), "h-auto p-0 text-xs text-muted-foreground mb-2 uppercase tracking-wider")}>
              ← Compliance
            </Link>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground flex items-center gap-4">
              Policy Library
            </h1>
            <p className="mt-2 text-[13px] text-muted-foreground max-w-2xl">
              Versioned policies and acknowledgment tracking for your facility.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/admin/compliance/policies/new" className={cn(buttonVariants({ size: "default" }), "h-9 px-4 text-[10px] font-semibold uppercase tracking-wider bg-primary hover:bg-primary/90 text-primary-foreground")} >
               + New Policy
            </Link>
          </div>
        </header>

        <div className="p-6 rounded-lg border border-border bg-card/60">
           <div className="flex items-center justify-between pb-4 mb-4 border-b border-border pl-2">
             <h3 className="text-[12px] font-semibold uppercase tracking-wider text-foreground">
               Active Policies
             </h3>
             <span className="text-[12px] text-muted-foreground">{loading ? "Loading…" : `${rows.length} shown`}</span>
           </div>

           {!ready ? (
             <div className="p-12 text-center text-warning bg-warning/10 rounded-lg border border-warning/20">
               <p className="font-semibold text-[13px]">Select a facility</p>
               <p className="text-[12px] opacity-80 mt-1">Policies are managed per facility.</p>
             </div>
           ) : loading ? (
             <p className="text-[13px] text-muted-foreground pl-2">Loading policies…</p>
           ) : rows.length === 0 ? (
             <div className="p-12 text-center text-muted-foreground bg-muted/40 rounded-lg border border-dashed border-border">
                <p className="font-semibold text-[13px] text-foreground">No policies</p>
               <p className="text-[12px] opacity-80 mt-1">Upload and version your operational policies.</p>
             </div>
           ) : (
             <MotionList className="space-y-3">
               {rows.map((r) => {
                 const isDraft = r.status === "draft";
                 return (
                   <MotionItem
                     key={r.id}
                     className={cn(
                       "flex items-center gap-3 min-h-[36px] px-[13px] py-2 rounded-lg border border-border bg-card hover:bg-muted/40 hover:-translate-y-0.5 transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 overflow-hidden relative",
                       "flex-col sm:flex-row sm:items-center justify-between",
                       isDraft 
                         ? "border-warning/30 hover:bg-warning/10"
                         : "border-border hover:bg-muted/40"
                     )}
                   >
                     {isDraft && <div className="absolute left-0 top-0 w-1.5 h-full bg-warning" />}
                     <div className="flex-1 min-w-0 pl-1">
                       <div className="flex items-center gap-3 mb-1">
                         <span className={cn(
                           "text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-[4px] border",
                           isDraft 
                             ? "bg-warning/10 text-warning border-warning/20" 
                             : "bg-success/10 text-success border-success/20"
                         )}>
                           {r.status}
                         </span>
                         <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                           {r.published_at ? `Published ${format(parseISO(r.published_at.length <= 10 ? `${r.published_at}T12:00:00.000Z` : r.published_at), "MMM d, yyyy")}` : "Not Published"}
                         </span>
                       </div>
                       <p className="text-[13px] font-semibold text-foreground tracking-tight mt-2">{r.title}</p>
                       <p className="text-[12px] text-muted-foreground mt-1 flex items-center gap-2">
                         <span className="text-muted-foreground bg-muted px-2 py-0.5 rounded-[4px] text-[11px]">{r.category}</span>
                         <span className="tabular-nums text-[11px]">v{r.version}</span>
                       </p>
                     </div>
                     <div className="shrink-0 flex items-center gap-3 pl-1 sm:pl-0">
                       <Link
                         href={`/admin/compliance/policies/${r.id}/edit`}
                         className={cn(
                           buttonVariants({ variant: "outline", size: "sm" }),
                           "h-8 px-3 text-[10px] font-semibold uppercase tracking-wider"
                         )}
                       >
                         Manage
                       </Link>
                     </div>
                   </MotionItem>
                 );
               })}
             </MotionList>
           )}
        </div>
      </div>
    </div>
  );
}
