"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ShieldAlert } from "lucide-react";

import { AdminTableLoadingState, AdminEmptyState, AdminLiveDataFallbackNotice } from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import {
  formatMedicationPrescriber,
  formatMedicationStrength,
} from "@/lib/clinical/medications-display-copy";
import { formatLiveDataLoadError } from "@/lib/live-data-fallback";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { RecordDetailSection } from "@/design-system/components/record-detail";

type Med = {
  id: string;
  medication_name: string;
  strength: string | null;
  route: string;
  frequency: string;
  scheduled_times: string[] | null;
  status: string;
  prescriber_name: string | null;
  start_date: string;
  controlled_schedule: string;
};

export default function AdminResidentMedicationsPage() {
  const params = useParams();
  const rawId = params?.id;
  const residentId = typeof rawId === "string" ? rawId : Array.isArray(rawId) ? rawId[0] : "";
  const supabase = useMemo(() => createClient(), []);
  const [tab, setTab] = useState<"active" | "discontinued" | "all">("active");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Med[]>([]);

  const load = useCallback(async () => {
    if (!residentId) return;
    setLoading(true);
    setError(null);
    try {
      const q = supabase
        .from("resident_medications")
        .select(
          "id, medication_name, strength, route, frequency, scheduled_times, status, prescriber_name, start_date, controlled_schedule",
        )
        .eq("resident_id", residentId)
        .is("deleted_at", null)
        .order("medication_name");

      const res = await q;
      if (res.error) throw res.error;
      setRows((res.data ?? []) as Med[]);
    } catch (e: unknown) {
      setError(formatLiveDataLoadError(e, "Failed to load medications"));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, residentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (tab === "all") return rows;
    if (tab === "active") return rows.filter((m) => m.status === "active");
    return rows.filter((m) => m.status === "discontinued");
  }, [rows, tab]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-[var(--motion-duration)]">
        <div className="flex justify-end">
          <Link
            href="/admin/medications/verbal-orders/new"
            className={cn(buttonVariants({ size: "sm" }), "font-medium")}
          >
            New verbal order
          </Link>
        </div>

        <div className="flex gap-2">
          {(["active", "discontinued", "all"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "rounded-[8px] px-4 py-2 text-[11px] font-medium uppercase tracking-wider transition-colors duration-[var(--motion-duration-micro)]",
                tab === t
                  ? "bg-foreground text-background shadow-[var(--shadow-card)]"
                  : "bg-card text-muted-foreground hover:bg-muted border border-border",
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {error ? <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} /> : null}

        {loading ? (
          <AdminTableLoadingState />
        ) : (
          <RecordDetailSection
            title="Medication list"
            description="Active orders and schedules"
          >
            <div className="w-full overflow-hidden">
              {filtered.length === 0 ? (
                <AdminEmptyState title="No medications found" description="No medications match the current filter." />
              ) : (
                <>
                  <div className="hidden lg:grid grid-cols-[1.5fr_1fr_2fr_1fr_1fr] gap-4 px-2 pb-3 border-b border-border text-left">
                    <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Medication</div>
                    <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Route</div>
                    <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Frequency &amp; Schedule</div>
                    <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Prescriber</div>
                    <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Dates</div>
                  </div>

                  <div className="space-y-2 mt-3">
                    <MotionList className="space-y-2">
                      {filtered.map((m) => (
                        <MotionItem key={m.id}>
                          <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr_2fr_1fr_1fr] gap-4 lg:items-center p-[14px] rounded-[8px] bg-card border border-border shadow-[var(--shadow-card)] tap-responsive group hover:border-primary/20 hover:-translate-y-0.5 transition-all duration-[var(--motion-duration)] w-full outline-none">

                            <div className="flex flex-col relative w-full">
                              <span className="lg:hidden text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Medication</span>
                              {m.controlled_schedule !== "non_controlled" && (
                                <ShieldAlert className="absolute -top-2 -left-2 lg:static lg:mb-1 w-4 h-4 text-destructive" />
                              )}
                              <span className="font-semibold text-base text-foreground tracking-tight leading-tight">{m.medication_name}</span>
                              <span className="text-xs font-medium text-muted-foreground mt-1">
                                {formatMedicationStrength(m.strength)}
                              </span>
                            </div>

                            <div className="flex flex-col">
                              <span className="lg:hidden text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Route</span>
                              <span className="text-sm font-medium capitalize text-foreground">{m.route.replace(/_/g, " ")}</span>
                            </div>

                            <div className="flex flex-col">
                              <span className="lg:hidden text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Frequency &amp; Schedule</span>
                              <span className="tabular-nums text-sm text-foreground">{m.frequency.replace(/_/g, " ")}</span>
                              {m.scheduled_times?.length ? (
                                <div className="flex flex-wrap gap-1 mt-1.5">
                                  {m.scheduled_times.map((t) => (
                                    <span key={t} className="px-1.5 py-0.5 bg-muted rounded text-[9px] tabular-nums tracking-wider text-muted-foreground">{t}</span>
                                  ))}
                                </div>
                              ) : null}
                            </div>

                            <div className="flex flex-col">
                              <span className="lg:hidden text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Prescriber</span>
                              <span className="text-xs font-medium text-muted-foreground">
                                {formatMedicationPrescriber(m.prescriber_name)}
                              </span>
                            </div>

                            <div className="flex flex-col lg:items-end">
                              <span className="lg:hidden text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Dates</span>
                              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">START</span>
                              <span className="tabular-nums text-sm font-semibold text-foreground mt-0.5">{m.start_date}</span>
                              {m.status !== "active" && (
                                <Badge className="mt-2 bg-muted text-muted-foreground border-none shadow-none uppercase font-bold text-[9px] tracking-wider">{m.status}</Badge>
                              )}
                            </div>

                          </div>
                        </MotionItem>
                      ))}
                    </MotionList>
                  </div>
                </>
              )}
            </div>
          </RecordDetailSection>
        )}
      </div>
    </div>
  );
}
