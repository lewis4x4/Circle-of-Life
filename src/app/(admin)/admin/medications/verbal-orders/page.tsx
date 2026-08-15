"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

import { AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { formatVerbalOrderResidentName } from "@/lib/medications/verbal-orders-display-copy";

type Row = {
  id: string;
  resident_id: string;
  facility_id: string;
  order_text: string;
  prescriber_name: string;
  received_at: string;
  cosignature_due_at: string;
  cosignature_status: string;
  implemented: boolean;
  residents: { first_name: string | null; last_name: string | null } | null;
};

export default function AdminVerbalOrdersPage() {
  const supabase = useMemo(() => createClient(), []);
  const { selectedFacilityId } = useFacilityStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!isValidFacilityIdForQuery(selectedFacilityId)) {
      setRows([]);
      setLoading(false);
      setError("Select a facility to view verbal orders.");
      return;
    }
    try {
      const q = supabase
        .from("verbal_orders")
        .select(
          `
          id,
          resident_id,
          facility_id,
          order_text,
          prescriber_name,
          received_at,
          cosignature_due_at,
          cosignature_status,
          implemented,
          residents ( first_name, last_name )
        `,
        )
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("received_at", { ascending: false })
        .limit(200);

      const res = await q;
      if (res.error) throw res.error;
      setRows((res.data ?? []) as unknown as Row[]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load verbal orders");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-6 md:flex-row md:items-end justify-between bg-card p-8 rounded-[var(--radius)] border border-border shadow-sm mt-4">
        <div className="space-y-2">
          <Link
            href="/admin/medications"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "mb-2 gap-1 px-0 text-muted-foreground hover:bg-transparent hover:text-foreground")}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Medications
          </Link>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-info/10 border border-info/20 text-[10px] font-bold uppercase tracking-wider text-info mb-2 block w-fit">
              Verbal Orders
          </div>
          <h1 className="text-4xl md:text-2xl font-semibold tracking-tight text-foreground">
            Verbal Orders Hub
          </h1>
          <p className="text-sm font-medium tracking-wide text-muted-foreground mt-2">
            Co-signature tracking and implementation status.
          </p>
        </div>
        <div>
          <Link href="/admin/medications/verbal-orders/new" className={cn(buttonVariants(), "h-12 px-8 rounded-[var(--radius)] font-bold text-xs tap-responsive bg-primary hover:bg-primary/90 text-primary-foreground gap-2")}>
            <Plus className="h-4 w-4" />
            New Verbal Order
          </Link>
        </div>
      </div>

      {error ? (
        <p className="text-sm text-warning">{error}</p>
      ) : null}

      {loading ? (
        <AdminTableLoadingState />
      ) : rows.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-border bg-muted/40 p-16 text-center shadow-sm">
          <p className="text-lg font-semibold text-foreground tracking-tight">No Verbal Orders</p>
          <p className="text-sm font-medium text-muted-foreground mt-1">There are no pending verbal orders for this facility.</p>
        </div>
      ) : (
        <div className="border-border rounded-[var(--radius)] bg-card p-6 md:p-8 shadow-sm relative overflow-hidden">
          
          <div className="hidden lg:grid grid-cols-[2fr_3fr_1fr_1fr_1fr_1fr] gap-4 px-6 pb-4 border-b border-border relative z-10">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Resident</div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Order Context</div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Prescriber</div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Received</div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Co-Sign Due</div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-right">Status</div>
          </div>

          <div className="relative z-10 space-y-4 mt-6">
            <MotionList className="space-y-4">
              {rows.map((r) => {
                const name = formatVerbalOrderResidentName(r.residents);
                const due = new Date(r.cosignature_due_at);
                const now = Date.now();
                const hoursLeft = (due.getTime() - now) / 36e5;
                let urgency: "ok" | "warn" | "bad" = "ok";
                if (r.cosignature_status === "expired") urgency = "bad";
                else if (hoursLeft <= 24) urgency = "warn";

                return (
                  <MotionItem key={r.id}>
                    <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr_1fr_1fr_1fr_1fr] gap-4 items-center min-h-[36px] px-[13px] py-3 rounded-[9px] border border-border bg-card hover:bg-muted/40 hover:-translate-y-px transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] tap-responsive w-full outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0">
                      
                      <div className="flex flex-col">
                        <span className="lg:hidden text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-1">Resident</span>
                        <span className="font-semibold text-lg text-foreground tracking-tight">{name}</span>
                      </div>

                      <div className="flex flex-col min-w-0 pr-4">
                        <span className="lg:hidden text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-1">Order Context</span>
                        <span className="text-sm font-medium text-muted-foreground truncate" title={r.order_text}>
                          {r.order_text}
                        </span>
                      </div>

                      <div className="flex flex-col">
                        <span className="lg:hidden text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-1">Prescriber</span>
                        <span className="text-sm font-medium text-foreground">{r.prescriber_name}</span>
                      </div>

                      <div className="flex flex-col">
                        <span className="lg:hidden text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-1">Received</span>
                        <span className="text-[11px] font-mono tracking-wider text-muted-foreground whitespace-nowrap tabular-nums">
                          {formatDistanceToNow(new Date(r.received_at), { addSuffix: true })}
                        </span>
                      </div>

                      <div className="flex flex-col">
                        <span className="lg:hidden text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-1">Co-Sign Due</span>
                        {r.cosignature_status === "pending" || r.cosignature_status === "expired" ? (
                          <span
                            className={cn(
                              "text-[11px] font-mono font-bold tracking-wider uppercase px-2 py-0.5 rounded border block w-fit tabular-nums",
                              urgency === "bad"
                                ? "bg-destructive/10 text-destructive border-destructive/20"
                                : urgency === "warn"
                                  ? "bg-warning/10 text-warning border-warning/20"
                                  : "bg-success/10 text-success border-success/20"
                            )}
                          >
                            {due.toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-[11px] font-mono text-muted-foreground tabular-nums">—</span>
                        )}
                      </div>

                      <div className="flex flex-col lg:items-end justify-center">
                        <span className="lg:hidden text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-1">Status</span>
                        <div className="flex items-center gap-2 flex-wrap lg:justify-end">
                          <Badge variant="outline" className={cn("px-2 py-0.5 text-[9px] uppercase font-bold tracking-wider shadow-sm",
                                r.cosignature_status === "expired" && "bg-destructive/10 text-destructive border-destructive/20",
                                r.cosignature_status === "pending" && "bg-warning/10 text-warning border-warning/20",
                                r.cosignature_status === "signed" && "bg-success/10 text-success border-success/20"
                          )}>
                            {r.cosignature_status}
                          </Badge>
                          {r.implemented && (
                            <Badge variant="secondary" className="px-2 py-0.5 text-[9px] uppercase font-bold tracking-wider shadow-sm border-info/20 bg-info/10 text-info">
                              Implemented
                            </Badge>
                          )}
                        </div>
                      </div>

                    </div>
                  </MotionItem>
                );
              })}
            </MotionList>
          </div>
        </div>
      )}
    </div>
  );
}
