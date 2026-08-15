"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  formatVitalsBloodPressure,
  formatVitalsOxygenSaturation,
  formatVitalsPulse,
  formatVitalsRespiration,
  formatVitalsTemperature,
  formatVitalsWeight,
} from "@/lib/clinical/vitals-display-copy";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { RecordDetailSection } from "@/design-system/components/record-detail";

export default function ResidentVitalsPage() {
  const params = useParams<{ id: string }>();
  const residentId = params?.id ?? "";
  const supabase = createClient();
  const [logs, setLogs] = useState<
    {
      id: string;
      log_date: string;
      shift: string;
      temperature: number | null;
      blood_pressure_systolic: number | null;
      blood_pressure_diastolic: number | null;
      pulse: number | null;
      respiration: number | null;
      oxygen_saturation: number | null;
      weight_lbs: number | null;
    }[]
  >([]);
  const [alerts, setAlerts] = useState<{ id: string; vital_type: string; status: string; created_at: string }[]>([]);

  const load = useCallback(async () => {
    const [daily, va] = await Promise.all([
      supabase
        .from("daily_logs")
        .select(
          "id, log_date, shift, temperature, blood_pressure_systolic, blood_pressure_diastolic, pulse, respiration, oxygen_saturation, weight_lbs",
        )
        .eq("resident_id", residentId)
        .is("deleted_at", null)
        .order("log_date", { ascending: false })
        .limit(30),
      supabase
        .from("vital_sign_alerts")
        .select("id, vital_type, status, created_at")
        .eq("resident_id", residentId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    setLogs((daily.data ?? []) as never);
    setAlerts((va.data ?? []) as never);
  }, [supabase, residentId]);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6 animate-in fade-in duration-[var(--motion-duration)] ease-[var(--motion-ease)]">
        <div className="flex justify-end">
          <a
            href={`/admin/residents/${residentId}/vitals/thresholds`}
            className={cn(
              buttonVariants({ size: "sm", variant: "outline" }),
              "font-medium",
            )}
          >
            Alert thresholds
          </a>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <RecordDetailSection
              title="Recent daily logs"
              description="Temp, BP, Pulse, RR, O₂, Wt"
            >
              <div className="w-full overflow-hidden">
                <div className="hidden md:grid grid-cols-[1fr_0.5fr_1fr_1fr_1fr] gap-4 px-2 pb-3 border-b border-border text-left">
                  <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Date/Shift</div>
                  <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">BP / Pulse</div>
                  <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">O₂ / RR</div>
                  <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Temp</div>
                  <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground text-right">Weight</div>
                </div>

                <div className="space-y-2 mt-3">
                  <MotionList className="space-y-2">
                    {logs.map((r) => (
                      <MotionItem key={r.id}>
                        <div className="grid grid-cols-1 md:grid-cols-[1fr_0.5fr_1fr_1fr_1fr] gap-4 md:items-center p-[14px] rounded-[8px] bg-card border border-border shadow-[var(--shadow-card)] tap-responsive group hover:border-primary/20 hover:-translate-y-0.5 transition-all duration-[var(--motion-duration)] w-full outline-none">

                          <div className="flex flex-col">
                            <span className="md:hidden text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Date/Shift</span>
                            <span className="font-semibold text-base tabular-nums text-foreground">{r.log_date}</span>
                            <span className="text-xs tabular-nums text-muted-foreground mt-0.5">{r.shift}</span>
                          </div>

                          <div className="flex flex-col">
                            <span className="md:hidden text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">BP / Pulse</span>
                            <span className="tabular-nums text-sm text-foreground">
                              {formatVitalsBloodPressure(
                                r.blood_pressure_systolic,
                                r.blood_pressure_diastolic,
                              )}
                            </span>
                            <span className="text-xs tabular-nums text-muted-foreground mt-0.5">
                              {formatVitalsPulse(r.pulse)}
                            </span>
                          </div>

                          <div className="flex flex-col">
                            <span className="md:hidden text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">O₂ / RR</span>
                            <span className="tabular-nums text-sm text-foreground">
                              {formatVitalsOxygenSaturation(r.oxygen_saturation)}
                            </span>
                            <span className="text-xs tabular-nums text-muted-foreground mt-0.5">
                              {formatVitalsRespiration(r.respiration)}
                            </span>
                          </div>

                          <div className="flex flex-col">
                            <span className="md:hidden text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Temp</span>
                            <span className="tabular-nums text-sm text-foreground">
                              {formatVitalsTemperature(r.temperature)}
                            </span>
                          </div>

                          <div className="flex flex-col md:items-end">
                            <span className="md:hidden text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Weight</span>
                            <span className="tabular-nums text-sm text-foreground">
                              {formatVitalsWeight(r.weight_lbs)}
                            </span>
                          </div>

                        </div>
                      </MotionItem>
                    ))}
                    {logs.length === 0 && (
                      <div className="p-8 text-center text-muted-foreground">No logs found.</div>
                    )}
                  </MotionList>
                </div>
              </div>
            </RecordDetailSection>
          </div>

          <div className="h-fit">
            <RecordDetailSection
              title="Vital alerts"
              className="border-destructive/20 bg-destructive/10"
            >
              <ul className="space-y-3">
                {alerts.map((a) => (
                  <li key={a.id} className="p-[14px] rounded-[8px] bg-card border border-destructive/20 shadow-[var(--shadow-card)] flex flex-col gap-1">
                    <div className="flex justify-between items-center">
                      <span className="font-medium uppercase tracking-wider text-[11px] text-destructive">{a.vital_type}</span>
                      <Badge className="bg-destructive text-primary-foreground uppercase tracking-wider font-bold text-[9px] px-2 shadow-none border-none">{a.status}</Badge>
                    </div>
                    <span className="text-xs tabular-nums text-destructive/70 mt-2">{new Date(a.created_at).toLocaleString()}</span>
                  </li>
                ))}
                {alerts.length === 0 && (
                  <li className="text-destructive/70 text-sm font-medium p-4 text-center">No alerts.</li>
                )}
              </ul>
            </RecordDetailSection>
          </div>
        </div>
      </div>
    </div>
  );
}
