"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Clock, MapPin, CheckCircle2 } from "lucide-react";

import { ExecutiveHubNav } from "../executive-hub-nav";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { createClient } from "@/lib/supabase/client";
import { fetchExecutiveAlerts, acknowledgeExecutiveAlert, type ExecutiveAlertRow } from "@/lib/exec-alerts";
import {
  resolveExecutiveFetchErrorBannerMessage,
  resolveExecutiveOrganizationGapMessage,
} from "@/lib/executive/executive-auth-page-state";
import { cn } from "@/lib/utils";
import { getRoleDashboardConfig } from "@/lib/auth/dashboard-routing";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { V2Card } from "@/components/ui/v2-card";
import { KineticGrid } from "@/components/ui/kinetic-grid";

import type { Database } from "@/types/database";

type AppRole = Database["public"]["Enums"]["app_role"];

interface AlertWithFacility extends ExecutiveAlertRow {
  facilities?: { name: string } | null;
}

export default function ExecutiveAlertsPage() {
  const supabase = useMemo(() => createClient(), []);
  const { user, organizationId, appRole, loading: authLoading } = useHavenAuth();
  const roleConfig = getRoleDashboardConfig(appRole as AppRole);
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<ExecutiveAlertRow[]>([]);
  const [fetching, setFetching] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const organizationGapMessage = resolveExecutiveOrganizationGapMessage({
    authLoading,
    organizationId,
    hasOrgScopedData: rows.length > 0,
  });
  const fetchErrorBannerMessage = resolveExecutiveFetchErrorBannerMessage({
    authLoading,
    fetchError,
  });
  const loading = authLoading || fetching;

  const load = useCallback(async () => {
    if (authLoading) {
      return;
    }

    if (!organizationId) {
      setRows([]);
      setFetchError(null);
      setFetching(false);
      return;
    }

    setFetching(true);
    setFetchError(null);
    try {
      const data = await fetchExecutiveAlerts(supabase, organizationId, selectedFacilityId, 100);
      setRows(data);
    } catch (e) {
      setRows([]);
      setFetchError(e instanceof Error ? e.message : "Unable to load alerts.");
    } finally {
      setFetching(false);
    }
  }, [authLoading, supabase, selectedFacilityId, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onAck(alert: ExecutiveAlertRow) {
    setBusyId(alert.id);
    setFetchError(null);
    try {
      if (!user) {
        setFetchError("Sign in required.");
        return;
      }
      await acknowledgeExecutiveAlert(supabase, alert.id, user.id);
      await load();
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Acknowledge failed.");
    } finally {
      setBusyId(null);
    }
  }

  const criticals = rows.filter(r => r.severity === 'critical');
  const warnings = rows.filter(r => r.severity === 'warning');
  const infos = rows.filter(r => r.severity === 'info');
  const decisionLinks = [
    {
      title: "Finance review",
      description: "Check whether a financial exception or posting delay is amplifying the alert.",
      href: "/admin/finance",
    },
    {
      title: "Insurance & risk",
      description: "Open policy, renewal, and claims posture when the alert has risk implications.",
      href: "/admin/insurance",
    },
    {
      title: "High-severity incidents",
      description: "Jump into open incident exceptions when the alert needs operational intervention.",
      href: "/admin/incidents?scope=open&severity=level_4",
    },
  ];

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <></>

      <div className="relative z-10 space-y-6">
        <header className="mb-6 mt-2">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-border pb-6 mb-4">
            <div>
              
              <h2 className="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-3">
                Executive Alerts
              </h2>
              <p className="text-sm text-muted-foreground mt-1">Workflow routing and leadership intervention queue</p>
              <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                {roleConfig.roleLabel} drill-in: review open exceptions, decide the intervention lane, and move into finance, insurance, or incident risk without dropping back to the operator home.
              </p>
            </div>
            <div className="hidden md:block">
              <ExecutiveHubNav />
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {decisionLinks.map((item) => (
            <Link
              key={item.title}
              href={item.href}
              className="rounded-[var(--radius)] border border-border bg-card p-5 shadow-[var(--shadow-card)] transition-all duration-[var(--motion-duration)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)] hover:border-primary/20"
            >
              <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {item.title}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-foreground">{item.description}</p>
            </Link>
          ))}
        </div>

        {organizationGapMessage ? (
          <Card className="rounded-lg border border-dashed border-muted-foreground/35 bg-muted/30 shadow-sm">
            <CardContent className="p-4 text-sm text-muted-foreground">{organizationGapMessage}</CardContent>
          </Card>
        ) : null}

        {fetchErrorBannerMessage ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {fetchErrorBannerMessage}
          </p>
        ) : null}

        {/* Action Center Dash */}
        <KineticGrid className="grid-cols-1 md:grid-cols-3 gap-4 mb-6" staggerMs={50}>
          <div className="h-[140px]">
             <V2Card hoverColor="rose" className="border-destructive/20 bg-destructive/10 items-center justify-center flex flex-col text-center">
               <h3 className="text-[10px] font-medium tracking-wider uppercase text-destructive mb-2">
                 Critical Thresholds
               </h3>
               <p className="text-2xl font-semibold tabular-nums text-destructive">{criticals.length}</p>
             </V2Card>
          </div>
          <div className="h-[140px]">
             <V2Card hoverColor="amber" className="border-warning/20 bg-warning/10 items-center justify-center flex flex-col text-center">
               <h3 className="text-[10px] font-medium tracking-wider uppercase text-warning mb-2">
                 Active Warnings
               </h3>
               <p className="text-2xl font-semibold tabular-nums text-warning">{warnings.length}</p>
             </V2Card>
          </div>
          <div className="h-[140px]">
             <V2Card hoverColor="indigo" className="border-info/20 bg-info/10 items-center justify-center flex flex-col text-center">
               <h3 className="text-[10px] font-medium tracking-wider uppercase text-info mb-2">
                 Routing Actions
               </h3>
               <p className="text-2xl font-semibold tabular-nums text-info">{infos.length}</p>
             </V2Card>
          </div>
        </KineticGrid>

        <div className="flex justify-between items-center mb-4 mt-8">
           <h3 className="text-lg font-semibold tracking-tight text-foreground flex items-center gap-2">
             Decision Queue
           </h3>
           <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            Refresh Queue
          </Button>
        </div>

        {loading ? (
           <div className="flex items-center justify-center py-20 text-muted-foreground text-sm uppercase tracking-wider animate-pulse">
             Syncing Exception Engine...
           </div>
        ) : rows.length === 0 ? (
           <Card className="border-success/20 bg-success/10">
            <CardContent className="flex flex-col items-center justify-center p-16 text-center text-success">
              <CheckCircle2 className="h-12 w-12 mb-4 opacity-50" />
              <p className="text-lg font-semibold">Triage Queue Clear</p>
              <p className="text-sm mt-2 opacity-80">All interventions routed and resolved.</p>
            </CardContent>
          </Card>
        ) : (
           <div className="space-y-4">
              {rows.map((a) => {
                 const isCrit = a.severity === 'critical';
                 const isWarn = a.severity === 'warning';
                 const colorTag = isCrit ? 'rose' : isWarn ? 'amber' : 'slate';
                 
                 return (
                    <V2Card 
                       key={a.id} 
                       hoverColor={colorTag} 
                       className={cn(
                          "p-0 overflow-hidden",
                          isCrit ? "border-destructive/30" : isWarn ? "border-warning/30" : "border-border"
                       )}
                    >
                       <div id={`alert-${a.id}`} className="flex flex-col md:flex-row">
                          <div className={cn(
                             "md:w-64 p-5 flex flex-col justify-center border-b md:border-b-0 md:border-r",
                             isCrit ? "bg-destructive/10 border-destructive/20" : isWarn ? "bg-warning/10 border-warning/20" : "bg-muted/40 border-border"
                          )}>
                             <div className="flex items-center gap-2 mb-3">
                                <></>
                                <span className={cn(
                                   "text-[10px] uppercase font-semibold tracking-wider px-2 py-0.5 rounded",
                                   isCrit ? "bg-destructive/10 text-destructive" : isWarn ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground"
                                )}>
                                   {a.severity}
                                </span>
                             </div>
                             <p className={cn("text-xs font-medium uppercase tracking-wider opacity-70", isCrit ? "text-destructive" : isWarn ? "text-warning" : "text-muted-foreground")}>
                                Module • {a.source_module.replace(/_/g, " ")}
                             </p>
                          </div>
                          
                          <div className="flex-1 p-5 flex flex-col justify-between">
                             <div>
                                <h4 className="text-base font-semibold text-foreground mb-1">{a.title}</h4>
                                {a.body && <p className="text-sm text-muted-foreground max-w-3xl">{a.body}</p>}
                             </div>
                             
                             <div className="flex items-center justify-between mt-6">
                                <div className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase flex items-center gap-4">
                                   <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {format(new Date(a.created_at), 'MMM d, h:mm a')}</span>
                                   {(a as AlertWithFacility).facilities?.name && (
                                     <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {(a as AlertWithFacility).facilities!.name}</span>
                                   )}
                                </div>
                                
                                <div className="flex items-center gap-2">
                                   {a.deep_link_path && (
                                      <Link href={a.deep_link_path} className="text-xs font-semibold px-3 py-1.5 rounded bg-info/10 text-info hover:bg-info/20 transition-colors duration-[var(--motion-duration-micro)]">
                                         Inspect Source
                                      </Link>
                                   )}
                                   <Button
                                      size="sm"
                                      variant={a.acknowledged_at ? "outline" : isCrit ? "destructive" : "default"}
                                      disabled={busyId === a.id || !!a.acknowledged_at}
                                      onClick={() => void onAck(a)}
                                      className={cn(
                                         "h-8 text-xs font-semibold px-4",
                                         isWarn && !a.acknowledged_at ? "bg-warning hover:bg-warning/90" : ""
                                      )}
                                    >
                                      {a.acknowledged_at ? "Acknowledged" : busyId === a.id ? "Working…" : "Acknowledge"}
                                    </Button>
                                </div>
                             </div>
                          </div>
                       </div>
                    </V2Card>
                 )
              })}
           </div>
        )}

      </div>
    </div>
  );
}
