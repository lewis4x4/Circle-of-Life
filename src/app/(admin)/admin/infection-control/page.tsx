"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, ClipboardList, Users } from "lucide-react";

import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";
import { V2Card } from "@/components/ui/v2-card";

export default function AdminInfectionControlHubPage() {
  const { selectedFacilityId } = useFacilityStore();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [activeInf, setActiveInf] = useState(0);
  const [activeOut, setActiveOut] = useState(0);
  const [openAlerts, setOpenAlerts] = useState(0);
  const [staffOut, setStaffOut] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
        setActiveInf(0);
        setActiveOut(0);
        setOpenAlerts(0);
        setStaffOut(0);
        return;
      }
      const [inf, out, va, ill] = await Promise.all([
        supabase
          .from("infection_surveillance")
          .select("id", { count: "exact", head: true })
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .in("status", ["suspected", "confirmed"]),
        supabase
          .from("infection_outbreaks")
          .select("id", { count: "exact", head: true })
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .eq("status", "active"),
        supabase
          .from("vital_sign_alerts")
          .select("id", { count: "exact", head: true })
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .eq("status", "open"),
        supabase
          .from("staff_illness_records")
          .select("id", { count: "exact", head: true })
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .is("absent_to", null),
      ]);
      setActiveInf(inf.count ?? 0);
      setActiveOut(out.count ?? 0);
      setOpenAlerts(va.count ?? 0);
      setStaffOut(ill.count ?? 0);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6 pb-12">
      <div className="space-y-6 max-w-6xl mx-auto">
        <header className="mb-8 flex items-start justify-between">
          <div>
            
            <h2 className="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-3">
              Infection Control {activeOut > 0 && <></>}
            </h2>
          </div>
        </header>

        <KineticGrid className="grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6" staggerMs={75}>
          <div className="h-[160px]">
            <V2Card className="border-destructive/20" hoverColor="red">
              <></>
              <MonolithicWatermark value={loading ? 0 : activeInf} className="text-destructive/10 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] tracking-wider uppercase text-destructive flex items-center gap-2">
                   Active Infections
                </h3>
                <p className="text-4xl font-mono tracking-tighter text-destructive pb-1">{loading ? "—" : activeInf}</p>
              </div>
            </V2Card>
          </div>

          <div className="h-[160px]">
            <V2Card className={activeOut > 0 ? "border-warning/30" : "border-border"} hoverColor="amber">
              <></>
              <MonolithicWatermark value={loading ? 0 : activeOut} className="text-warning/10 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <div className="flex items-center justify-between">
                  <h3 className="text-[10px] tracking-wider uppercase text-warning flex items-center gap-2">
                     Active Outbreaks
                  </h3>
                  {activeOut > 0 && <></>}
                </div>
                <p className="text-4xl font-mono tracking-tighter text-warning pb-1">{loading ? "—" : activeOut}</p>
              </div>
            </V2Card>
          </div>

          <div className="h-[160px]">
            <V2Card hoverColor="blue" className="border-info/20">
              <></>
              <MonolithicWatermark value={loading ? 0 : openAlerts} className="text-info/10 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] tracking-wider uppercase text-info">
                  Open Vital Alerts
                </h3>
                <p className="text-4xl font-mono tracking-tighter text-info pb-1">{loading ? "—" : openAlerts}</p>
              </div>
            </V2Card>
          </div>

          <div className="h-[160px]">
            <V2Card hoverColor="slate" className="border-border">
              <></>
              <MonolithicWatermark value={loading ? 0 : staffOut} className="text-muted-foreground/10 opacity-30" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] tracking-wider uppercase text-muted-foreground">
                  Staff Out Sick
                </h3>
                <p className="text-4xl font-mono tracking-tighter text-foreground pb-1">{loading ? "—" : staffOut}</p>
              </div>
            </V2Card>
          </div>
        </KineticGrid>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/admin/infection-control/new" className="group block focus-visible:outline-none">
          <div className="h-full flex p-6 items-center gap-5 rounded-lg border border-border bg-card transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:border-destructive/20 hover:bg-destructive/10 cursor-pointer">
            <div className="rounded-lg bg-destructive/10 p-4 border border-destructive/20">
              <ClipboardList className="h-6 w-6 text-destructive" />
            </div>
            <div>
              <h3 className="text-[13px] font-semibold tracking-tight text-foreground group-hover:text-destructive">
                New Surveillance
              </h3>
              <p className="text-[12px] text-muted-foreground">Record a suspected or confirmed infection</p>
            </div>
          </div>
        </Link>
        <Link href="/admin/infection-control/staff-illness" className="group block focus-visible:outline-none">
          <div className="h-full flex p-6 items-center gap-5 rounded-lg border border-border bg-card transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:border-info/20 hover:bg-info/10 cursor-pointer">
            <div className="rounded-lg bg-info/10 p-4 border border-info/20">
              <Users className="h-6 w-6 text-info" />
            </div>
            <div>
              <h3 className="text-[13px] font-semibold tracking-tight text-foreground group-hover:text-info">
                Staff Illness
              </h3>
              <p className="text-[12px] text-muted-foreground">Absences and return-to-work clearance</p>
            </div>
          </div>
        </Link>
      </div>

      <div className="flex flex-wrap gap-2 text-[13px] text-muted-foreground">
        <Activity className="h-4 w-4 shrink-0" />
        <span>
          Configure per-resident thresholds from a resident →{" "}
          <Link href="/admin/residents" className={cn(buttonVariants({ variant: "link", size: "sm" }), "h-auto p-0 text-xs")}>
            Residents
          </Link>{" "}
          → Vitals / thresholds.
        </span>
      </div>

      {activeOut > 0 && !loading && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/20 bg-warning/10 px-4 py-3 text-[13px] text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>There is an active outbreak in this facility scope. Open the related surveillance record to jump into the outbreak detail workflow.</span>
        </div>
      )}
      </div>
    </div>
  );
}
