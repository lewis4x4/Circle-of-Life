"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, ClipboardList, Users } from "lucide-react";

import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

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
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          Infection control
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Surveillance, outbreaks, vital alerts, and staff illness tracking.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500 dark:text-slate-400">Active infections</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-2xl font-semibold tabular-nums">{loading ? "—" : activeInf}</p>
          </CardContent>
        </Card>
        <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500 dark:text-slate-400">Active outbreaks</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-2xl font-semibold tabular-nums text-amber-700 dark:text-amber-400">
              {loading ? "—" : activeOut}
            </p>
          </CardContent>
        </Card>
        <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500 dark:text-slate-400">Open vital alerts</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-2xl font-semibold tabular-nums">{loading ? "—" : openAlerts}</p>
          </CardContent>
        </Card>
        <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500 dark:text-slate-400">Staff out sick</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-2xl font-semibold tabular-nums">{loading ? "—" : staffOut}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/admin/infection-control/new" className="group block">
          <Card className="h-full border-slate-200/80 shadow-soft transition-colors hover:border-brand-500/40 dark:border-slate-800">
            <CardHeader className="flex flex-row items-start gap-3 space-y-0">
              <div className="rounded-md bg-slate-100 p-2 dark:bg-slate-900">
                <ClipboardList className="h-5 w-5 text-brand-600 dark:text-brand-400" />
              </div>
              <div>
                <CardTitle className="font-display text-base group-hover:text-brand-700 dark:group-hover:text-brand-300">
                  New surveillance
                </CardTitle>
                <CardDescription className="text-xs">Record a suspected or confirmed infection</CardDescription>
              </div>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/admin/infection-control/staff-illness" className="group block">
          <Card className="h-full border-slate-200/80 shadow-soft transition-colors hover:border-brand-500/40 dark:border-slate-800">
            <CardHeader className="flex flex-row items-start gap-3 space-y-0">
              <div className="rounded-md bg-slate-100 p-2 dark:bg-slate-900">
                <Users className="h-5 w-5 text-brand-600 dark:text-brand-400" />
              </div>
              <div>
                <CardTitle className="font-display text-base group-hover:text-brand-700 dark:group-hover:text-brand-300">
                  Staff illness
                </CardTitle>
                <CardDescription className="text-xs">Absences and return-to-work clearance</CardDescription>
              </div>
            </CardHeader>
          </Card>
        </Link>
      </div>

      <div className="flex flex-wrap gap-2 text-sm text-slate-600 dark:text-slate-400">
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
        <div className="flex items-start gap-2 rounded-lg border border-amber-200/80 bg-amber-50/50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>There is an active outbreak in this facility scope. Review outbreak records in Supabase-backed lists (detail views coming).</span>
        </div>
      )}
    </div>
  );
}
