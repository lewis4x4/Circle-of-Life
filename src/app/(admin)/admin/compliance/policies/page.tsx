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
import { formatCompliancePolicyPublishedDate } from "@/lib/compliance/policies-display-copy";

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
            <Link href="/admin/compliance/policies/new" className={cn(buttonVariants({ size: "default" }), "h-9 px-4 text-[10px] font-semibold bg-primary hover:bg-primary/90 text-primary-foreground")} >
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
             <>
               <TableRowHeader>
                 <span className="w-[112px] shrink-0">Status</span>
                 <span className="flex-[2] min-w-0">Title</span>
                 <span className="flex-1 min-w-0">Category</span>
                 <span className="w-[60px] shrink-0">Version</span>
                 <span className="w-[160px] shrink-0">Published</span>
                 <span className="w-[88px] shrink-0 text-right">Action</span>
               </TableRowHeader>
               <MotionList className="space-y-1 mt-2">
                 {rows.map((r) => {
                   const isDraft = r.status === "draft";
                   return (
                     <MotionItem key={r.id}>
                       <TableRow>
                         <div className="w-[112px] shrink-0">
                           <StatusPill tone={isDraft ? "warning" : "muted"}>
                             {r.status}
                           </StatusPill>
                         </div>
                         <span className="flex-[2] min-w-0 truncate text-[13px] font-medium text-foreground">
                           {r.title}
                         </span>
                         <span className="flex-1 min-w-0 truncate text-[12px] text-muted-foreground capitalize">
                           {r.category}
                         </span>
                         <span className="w-[60px] shrink-0 font-mono text-[12px] tabular-nums text-muted-foreground">
                           v{r.version}
                         </span>
                         <span className="w-[160px] shrink-0 font-mono text-[12px] tabular-nums text-muted-foreground">
                           {formatCompliancePolicyPublishedDate(r.published_at)}
                         </span>
                         <div className="w-[88px] shrink-0 flex justify-end">
                           <Link
                             href={`/admin/compliance/policies/${r.id}/edit`}
                             className={cn(
                               buttonVariants({ variant: "outline", size: "sm" }),
                               "h-7 px-2.5 text-[10px] font-semibold"
                             )}
                           >
                             Manage
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
