"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useId } from "react";
import { 
  Activity, Users, ShieldAlert, 
  CheckCircle, Shield, Briefcase, AlertTriangle, 
  Wallet, ArrowUpRight, Stethoscope
} from "lucide-react";

import { ExecutiveHubNav } from "./executive-hub-nav";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { fetchExecutiveKpiSnapshot, type ExecKpiPayload } from "@/lib/exec-kpi-snapshot";
import {
  arDeltaLine,
  censusDeltaLine,
  clinicalDeltaLine,
  complianceDeltaLine,
  fetchPriorExecSnapshotMetrics,
  infectionDeltaLine,
  workforceDeltaLine,
} from "@/lib/exec-prior-snapshot";
import { fetchExecutiveAlerts, type ExecutiveAlertRow } from "@/lib/exec-alerts";
import { computeTotalCostOfRisk, type TcorSnapshot } from "@/lib/insurance/compute-tcor";
import { cn } from "@/lib/utils";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function severityTheme(s: string) {
  if (s === "critical") return "text-red-500 border-red-500/20 bg-red-500/5";
  if (s === "warning") return "text-orange-500 border-orange-500/20 bg-orange-500/5";
  return "text-blue-500 border-blue-500/20 bg-blue-500/5";
}

function V2Card({ children, className, href, hoverColor = "indigo" }: { children: React.ReactNode; className?: string; href?: string; hoverColor?: string }) {
  const hoverGradient = {
    indigo: "group-hover:from-indigo-500/10",
    emerald: "group-hover:from-emerald-500/10",
    rose: "group-hover:from-rose-500/10",
    orange: "group-hover:from-orange-500/10",
    cyan: "group-hover:from-cyan-500/10",
    blue: "group-hover:from-blue-500/10",
  }[hoverColor] || "group-hover:from-slate-500/10";

  const content = (
    <div className={cn(
      "group relative h-full w-full overflow-hidden rounded-xl border border-slate-200 bg-white p-5 transition-all duration-300",
      "dark:border-slate-800/80 dark:bg-[#0A0A0A] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)]",
      href && "cursor-pointer dark:hover:border-slate-600/80 hover:border-slate-300 shadow-sm",
      className
    )}>
      {/* Subtle hover backlight radial/linear gradient */}
      <div className={cn("absolute inset-0 z-0 bg-gradient-to-br via-transparent to-transparent opacity-0 transition-opacity duration-300 pointer-events-none", hoverGradient, "opacity-0")} />
      
      {/* Content wrapper */}
      <div className="relative z-10 flex h-full flex-col">
        {children}
      </div>
    </div>
  );

  if (href) {
    return <Link href={href} className="block h-full outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-xl">{content}</Link>;
  }
  return content;
}

// Simulated SVG data sparkline
function Sparkline({ colorClass = "text-indigo-500", variant = 1 }) {
  const paths = {
    1: { fill: "M0 25 L15 15 L30 20 L45 5 L60 12 L75 2 L100 10 L100 30 L0 30 Z", stroke: "M0 25 L15 15 L30 20 L45 5 L60 12 L75 2 L100 10" },
    2: { fill: "M0 10 L20 18 L40 5 L60 22 L80 15 L100 5 L100 30 L0 30 Z", stroke: "M0 10 L20 18 L40 5 L60 22 L80 15 L100 5" },
    3: { fill: "M0 20 L25 22 L50 15 L75 18 L100 8 L100 30 L0 30 Z", stroke: "M0 20 L25 22 L50 15 L75 18 L100 8" },
    4: { fill: "M0 5 L20 10 L40 25 L60 15 L80 18 L100 5 L100 30 L0 30 Z", stroke: "M0 5 L20 10 L40 25 L60 15 L80 18 L100 5" },
  };
  const path = paths[variant as keyof typeof paths] || paths[1];
  const idValue = useId().replace(/:/g, ""); // Clean the id for SVG/CSS

  return (
    <svg className={cn("absolute bottom-0 left-0 w-full h-14 opacity-15 group-hover:opacity-30 transition-opacity duration-300 pointer-events-none", colorClass)} viewBox="0 0 100 30" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`grad-${idValue}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.4" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={path.fill} fill={`url(#grad-${idValue})`} />
      <path d={path.stroke} fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ARAgingBar() {
  return (
    <div className="mt-5 w-full">
      <div className="flex justify-between text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-1.5 dark:text-slate-400">
        <span>0-30d</span>
        <span>31-60d</span>
        <span>60-90+</span>
      </div>
      <div className="flex h-[6px] w-full overflow-hidden rounded-full gap-0.5 bg-slate-100 dark:bg-slate-800/50">
        <div className="bg-emerald-500 dark:bg-emerald-400 w-[55%] transition-all" />
        <div className="bg-amber-500 dark:bg-amber-400 w-[30%] transition-all" />
        <div className="bg-rose-500 dark:bg-rose-500 w-[15%] transition-all" />
      </div>
    </div>
  );
}

function PulseDot({ colorClass = "bg-rose-500" }: { colorClass?: string }) {
  return (
    <span className="relative flex h-2.5 w-2.5 ml-2">
      <span className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-75", colorClass)}></span>
      <span className={cn("relative inline-flex rounded-full h-2.5 w-2.5", colorClass)}></span>
    </span>
  );
}

function RadarMatrix({ alerts, loading }: { alerts: ExecutiveAlertRow[], loading: boolean }) {
  const hasCritical = alerts.some(a => a.severity === "critical");
  
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[14px] border border-slate-200 bg-black dark:border-slate-800/80 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)]">
      <div className="relative z-20 flex items-center justify-between border-b px-5 py-4 border-slate-800 bg-[#0A0A0A]/80 backdrop-blur-sm">
        <h2 className="flex items-center gap-2 text-sm font-medium text-slate-100">
          <AlertTriangle className={cn("h-4 w-4", hasCritical ? "text-rose-500" : "text-emerald-500")} /> 
          Telemetry & Risk
          {hasCritical && <PulseDot colorClass="bg-rose-500" />}
        </h2>
        <Link href="/admin/executive/alerts" className="text-[10px] font-mono uppercase tracking-wider text-slate-400 hover:text-white transition-colors">
          Log →
        </Link>
      </div>

      <div className="relative flex-1 flex flex-col xl:flex-row overflow-hidden bg-[#040405]">
        {/* SVG Radar Canvas */}
        <div className="relative flex h-64 w-full xl:w-1/2 items-center justify-center border-b xl:border-b-0 xl:border-r border-slate-800/50 overflow-hidden">
          <div className={cn("absolute inset-0 opacity-20 blur-2xl transition-colors duration-1000", hasCritical ? "bg-rose-600/30" : "bg-emerald-600/20")} />
          
          <div className="absolute inset-0 flex items-center justify-center opacity-80 mix-blend-screen">
            <div className="h-[200px] w-[200px] rounded-full border border-emerald-500/20" />
            <div className="absolute h-[140px] w-[140px] rounded-full border border-emerald-500/20" />
            <div className="absolute h-[80px] w-[80px] rounded-full border border-emerald-500/40" />
            <div className="absolute h-[250px] w-[1px] bg-emerald-500/30" />
            <div className="absolute w-[250px] h-[1px] bg-emerald-500/30" />
          </div>

          {!loading && (
            <div className="absolute inset-0 flex items-center justify-center mix-blend-screen">
              <div 
                className="h-[500px] w-[500px] rounded-full origin-center animate-[spin_4s_linear_infinite]" 
                style={{ background: "conic-gradient(from 0deg, transparent 270deg, rgba(16, 185, 129, 0.4) 360deg)" }} 
              />
            </div>
          )}

          {!loading && alerts.map((a, i) => {
            const isCrit = a.severity === "critical";
            const top = `${25 + (i * 17 % 50)}%`;
            const left = `${25 + (i * 23 % 50)}%`;
            return (
              <div key={a.id} className="absolute z-10 animate-in zoom-in duration-500" style={{ top, left, animationDelay: `${i * 100}ms` }}>
                <span className="relative flex h-2 w-2">
                  <span className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-75", isCrit ? "bg-rose-500" : "bg-emerald-500")}></span>
                  <span className={cn("relative inline-flex rounded-full h-2 w-2", isCrit ? "bg-rose-500" : "bg-emerald-500")}></span>
                </span>
                {isCrit && <div className="absolute top-3 left-3 text-[8px] font-mono text-rose-500 whitespace-nowrap bg-black/80 px-1 border border-rose-500/30">ID_{a.id.slice(0,4)}</div>}
              </div>
            );
          })}
        </div>
        
        {/* Telemetry Stream */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-[#020202] mix-blend-lighten">
          {loading ? (
            <Skeleton className="h-16 w-full rounded-md bg-slate-800/50" />
          ) : alerts.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center opacity-50">
              <CheckCircle className="h-6 w-6 text-emerald-500 mb-2" />
              <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500">System Nominal</p>
            </div>
          ) : (
            alerts.map((a, i) => (
              <Link key={a.id} href={a.deep_link_path || "#"} className={cn(
                "group flex flex-col p-3 rounded-md border text-left transition-all hover:bg-slate-900 animate-in slide-in-from-right-4 fade-in duration-500",
                severityTheme(a.severity)
              )} style={{ animationDelay: `${i * 150}ms`, animationFillMode: 'both' }}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[9px] font-mono font-bold tracking-widest uppercase opacity-80">{a.source_module}</span>
                  <span className={cn("text-[9px] font-mono font-bold tracking-widest uppercase px-1.5 py-0.5 border rounded-sm", a.severity === "critical" ? "bg-rose-500/20 border-rose-500/30 text-rose-400" : "bg-amber-500/10 border-amber-500/20 text-amber-500")}>
                    {a.severity}
                  </span>
                </div>
                <p className="text-xs font-semibold truncate text-slate-300">{a.title}</p>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default function ExecutiveCommandCenterPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const [kpis, setKpis] = useState<ExecKpiPayload | null>(null);
  const [priorKpi, setPriorKpi] = useState<ExecKpiPayload | null>(null);
  const [alerts, setAlerts] = useState<ExecutiveAlertRow[]>([]);
  const [tcor, setTcor] = useState<TcorSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) {
        setError(ctx.error);
        setKpis(null);
        setPriorKpi(null);
        setAlerts([]);
        setTcor(null);
        return;
      }
      const orgId = ctx.ctx.organizationId;

      let entityIdForTcor: string | null = null;
      if (selectedFacilityId) {
        const { data: fac } = await supabase
          .from("facilities")
          .select("entity_id")
          .eq("id", selectedFacilityId)
          .eq("organization_id", orgId)
          .is("deleted_at", null)
          .maybeSingle();
        entityIdForTcor = fac?.entity_id ?? null;
      }

      const [kpiData, priorData, alertData, tcorResult] = await Promise.all([
        fetchExecutiveKpiSnapshot(supabase, orgId, selectedFacilityId),
        fetchPriorExecSnapshotMetrics(supabase, orgId, selectedFacilityId),
        fetchExecutiveAlerts(supabase, orgId, selectedFacilityId, 10),
        computeTotalCostOfRisk(supabase, { organizationId: orgId, entityId: entityIdForTcor }),
      ]);
      setKpis(kpiData);
      setPriorKpi(priorData);
      setAlerts(alertData);
      setTcor(tcorResult.ok ? tcorResult.snapshot : null);
    } catch (e) {
      setKpis(null);
      setPriorKpi(null);
      setAlerts([]);
      setTcor(null);
      setError(e instanceof Error ? e.message : "Unable to load executive data.");
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const topAlerts = alerts.slice(0, 4);
  const hasCriticals = topAlerts.some((a) => a.severity === "critical");

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full">
      {/* Ambient Environmental Lighting Matrix */}
      <div className={cn(
        "fixed top-0 right-0 h-[800px] w-[800px] rounded-full blur-[120px] opacity-20 pointer-events-none transition-colors duration-[3000ms] ease-in-out",
        hasCriticals ? "bg-rose-700/30" : "bg-indigo-700/10"
      )} />
      <div className={cn(
        "fixed bottom-0 left-0 h-[600px] w-[600px] rounded-full blur-[100px] opacity-10 pointer-events-none transition-colors duration-[3000ms] ease-in-out",
        hasCriticals ? "bg-rose-900/20" : "bg-emerald-900/10"
      )} />

      <div className="relative z-10 space-y-8 pb-10">
        <ExecutiveHubNav />

      {/* Header - V2 Sharp Lineage */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between border-b pb-4 dark:border-slate-800">
        <div>
          <div className="mb-1.5 flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100 flex items-center">
              Command Base
              {hasCriticals && <PulseDot />}
            </h1>
          </div>
          <p className="max-w-2xl text-xs uppercase tracking-widest text-slate-500 font-mono">
            SYS: Module 24 / Matrix Sync
            {!loading && kpis && !priorKpi && (
              <span className="ml-2 text-amber-500">
                [Awaiting Nightly Batch]
              </span>
            )}
          </p>
        </div>
        <Button 
          type="button" 
          variant="outline" 
          className="gap-2 shrink-0 h-9 font-mono text-xs uppercase tracking-wider dark:hover:bg-primary/10 dark:hover:text-primary transition-colors border-slate-200 dark:border-slate-800" 
          onClick={() => void load()} 
          disabled={loading}
        >
          <Activity className={cn("h-3.5 w-3.5", loading && "animate-pulse")} />
          <span>{loading ? "Syncing..." : "Sync Matrix"}</span>
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-sm font-medium text-rose-500">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      )}

      {/* Bento Grid Layout - V2 Strict Structure */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-4 auto-rows-fr">
        
        {/* === HERO: Census & Occupancy === */}
        <div className="xl:col-span-4 h-full animate-in fade-in zoom-in-95 duration-700" style={{ animationDelay: '100ms', animationFillMode: 'both' }}>
          <V2Card href="/admin/residents" hoverColor="indigo">
            {/* Monolithic Watermark Typography */}
            {!loading && kpis && (
              <div className="absolute inset-y-0 right-0 flex items-center overflow-hidden pointer-events-none mix-blend-overlay opacity-40 dark:opacity-20 z-0">
                <span className="text-[180px] font-black tracking-tighter leading-none text-slate-800 dark:text-white -translate-y-4 translate-x-12">
                  {kpis.census.occupiedResidents}
                </span>
              </div>
            )}
            <div className="relative z-10 flex flex-col h-full justify-between">
              <div className="flex items-start justify-between mb-4">
                <h2 className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-300">
                  <Users className="h-4 w-4 text-indigo-500" /> Census & Occupancy
                </h2>
                <ArrowUpRight className="h-4 w-4 text-slate-400 opacity-0 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100" />
              </div>
              
              <div>
                {loading ? <Skeleton className="h-10 w-24 mb-2" /> : (
                  <div className="flex items-baseline gap-2">
                    <span className="text-5xl font-mono tracking-tighter tabular-nums bg-clip-text text-transparent bg-gradient-to-b from-slate-900 to-slate-500 dark:from-white dark:to-slate-400">
                      {kpis ? kpis.census.occupiedResidents : "—"}
                    </span>
                    <span className="text-sm font-mono text-slate-500 dark:text-slate-500">/ {kpis ? kpis.census.licensedBeds : "—"}</span>
                  </div>
                )}
                
                <div className="flex items-center justify-between mt-4 border-t pt-3 dark:border-slate-800/50 border-slate-100">
                  <div className="h-4 flex items-center">
                    {!loading && kpis && censusDeltaLine(kpis, priorKpi) ? (
                      <span className="text-[11px] font-mono uppercase tracking-wider text-slate-500">{censusDeltaLine(kpis, priorKpi)}</span>
                    ) : <Skeleton className="h-3 w-16" />}
                  </div>
                  {!loading && kpis && (
                    <span className="text-[11px] font-mono font-bold tracking-wider px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                      {kpis.census.occupancyPct}% RATE
                    </span>
                  )}
                </div>
              </div>
            </div>
            {/* Ambient visual effect */}
            <div className="absolute -right-10 -bottom-10 h-32 w-32 rounded-full bg-indigo-500/5 blur-3xl group-hover:bg-indigo-500/10 transition-colors duration-500 pointer-events-none" />
          </V2Card>
        </div>

        {/* === HERO: Financial (AR) === */}
        <div className="xl:col-span-4 h-full animate-in fade-in zoom-in-95 duration-700" style={{ animationDelay: '200ms', animationFillMode: 'both' }}>
          <V2Card href="/admin/billing/invoices" hoverColor="emerald">
            {/* Monolithic Watermark Typography */}
            {!loading && kpis && (
              <div className="absolute inset-y-0 right-0 flex items-center overflow-hidden pointer-events-none mix-blend-overlay opacity-40 dark:opacity-20 z-0">
                <span className="text-[160px] font-black tracking-tighter leading-none text-slate-800 dark:text-white -translate-y-[15%] translate-x-12">
                  {Math.round((kpis.financial.totalBalanceDueCents / 100) / 1000)}k
                </span>
              </div>
            )}
             <div className="relative z-10 flex flex-col h-full justify-between">
              <div className="flex items-start justify-between mb-4">
                <h2 className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-300">
                  <Wallet className="h-4 w-4 text-emerald-500" /> Accounts Receivable
                </h2>
                <ArrowUpRight className="h-4 w-4 text-slate-400 opacity-0 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100" />
              </div>
              
              <div>
                {loading ? <Skeleton className="h-10 w-32 mb-2" /> : (
                  <div className="text-5xl font-mono tracking-tighter tabular-nums bg-clip-text text-transparent bg-gradient-to-b from-slate-900 to-slate-500 dark:from-white dark:to-slate-400">
                    {kpis ? money.format(kpis.financial.totalBalanceDueCents / 100) : "—"}
                  </div>
                )}
                
                <ARAgingBar />

                <div className="flex items-center justify-between mt-4 border-t pt-3 dark:border-slate-800/50 border-slate-100">
                  <div className="h-4 flex items-center">
                    {!loading && kpis && arDeltaLine(kpis, priorKpi) ? (
                      <span className="text-[11px] font-mono uppercase tracking-wider text-slate-500">{arDeltaLine(kpis, priorKpi)}</span>
                    ) : <Skeleton className="h-3 w-16" />}
                  </div>
                  {!loading && kpis && (
                    <span className="text-[11px] font-mono tracking-wider text-slate-500">
                      {kpis.financial.openInvoicesCount} OPEN
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="absolute -left-10 -bottom-10 h-32 w-32 rounded-full bg-emerald-500/5 blur-3xl group-hover:bg-emerald-500/10 transition-colors duration-500 pointer-events-none" />
          </V2Card>
        </div>

        {/* === SIDE ALERTS PANEL -> V4 CORE REACTOR === */}
        <div className="md:col-span-2 xl:col-span-4 xl:row-span-2 h-full animate-in fade-in zoom-in-95 duration-700" style={{ animationDelay: '300ms', animationFillMode: 'both' }}>
          <RadarMatrix alerts={topAlerts} loading={loading} />
        </div>

        {/* === SECONDARY GRID === */}
        <div className="xl:col-span-8 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <MetricBlock 
            title="Clinical"
            icon={<Stethoscope className="h-3.5 w-3.5 text-blue-500" />}
            value={kpis ? String(kpis.clinical.openIncidents) : "—"}
            delta={kpis ? clinicalDeltaLine(kpis, priorKpi) : null}
            loading={loading}
            href="/admin/incidents"
            highlight={kpis && kpis.clinical.openIncidents > 3}
            hoverColor="blue"
            sparkVariant={1}
          />
          <MetricBlock 
            title="Compliance"
            icon={<ShieldAlert className="h-3.5 w-3.5 text-orange-500" />}
            value={kpis ? String(kpis.compliance.openSurveyDeficiencies) : "—"}
            delta={kpis ? complianceDeltaLine(kpis, priorKpi) : null}
            loading={loading}
            href="/admin/compliance"
            highlight={kpis && kpis.compliance.openSurveyDeficiencies > 0}
            hoverColor="orange"
            sparkVariant={2}
          />
          <MetricBlock 
            title="Workforce"
            icon={<Briefcase className="h-3.5 w-3.5 text-cyan-500" />}
            value={kpis ? String(kpis.workforce.certificationsExpiring30d) : "—"}
            delta={kpis ? workforceDeltaLine(kpis, priorKpi) : null}
            loading={loading}
            href="/admin/certifications"
            hoverColor="cyan"
            sparkVariant={3}
          />
          <MetricBlock 
            title="Infection"
            icon={<Activity className="h-3.5 w-3.5 text-rose-500" />}
            value={kpis ? String(kpis.infection.activeOutbreaks) : "—"}
            delta={kpis ? infectionDeltaLine(kpis, priorKpi) : null}
            loading={loading}
            href="/admin/infection-control"
            highlight={kpis && kpis.infection.activeOutbreaks > 0}
            hoverColor="rose"
            sparkVariant={4}
          />
          
          {/* TCoR Spans full width of this subgrid on smallest, but sm:col-span-4 */}
          <div className="col-span-2 sm:col-span-4">
            <V2Card href="/admin/insurance" hoverColor="emerald" className="group flex flex-col justify-between">
              <div className="flex items-center justify-between mb-2">
                <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500 font-mono">
                  <Shield className="h-3.5 w-3.5 text-emerald-500" /> TCoR (12m)
                </h2>
                <ArrowUpRight className="h-3.5 w-3.5 text-slate-500 opacity-0 transition-all group-hover:opacity-100" />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  {loading ? <Skeleton className="h-8 w-24" /> : (
                    <p className="text-3xl font-mono tracking-tighter tabular-nums bg-clip-text text-transparent bg-gradient-to-b from-slate-900 to-slate-500 dark:from-white dark:to-slate-400">
                      {tcor ? money.format(tcor.tcorCents / 100) : "—"}
                    </p>
                  )}
                </div>
                <div className="text-right hidden sm:flex gap-4">
                  {loading ? <Skeleton className="h-4 w-32" /> : tcor && (
                    <>
                      <div className="flex flex-col items-end">
                        <span className="text-[9px] uppercase font-mono text-slate-500">Premiums</span>
                        <span className="text-sm font-mono text-slate-900 dark:text-slate-300">{money.format(tcor.premiumsCents / 100)}</span>
                      </div>
                      <div className="flex flex-col items-end">
                         <span className="text-[9px] uppercase font-mono text-slate-500">Losses</span>
                         <span className="text-sm font-mono text-slate-900 dark:text-slate-300">{money.format(tcor.incurredLossesCents / 100)}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </V2Card>
          </div>

        </div>
      </div>
    </div>
  </div>
  );
}

function MetricBlock({
  title, icon, value, delta, loading, href, highlight, hoverColor, sparkVariant
}: {
  title: string; icon: React.ReactNode; value: string; delta?: string | null; loading: boolean; href: string; highlight?: boolean | null; hoverColor: string; sparkVariant: number;
}) {
  return (
    <V2Card href={href} hoverColor={hoverColor} className={cn("flex flex-col p-3.5 sm:p-4", highlight && "border-rose-500/50 dark:border-rose-500/30 shadow-[inset_0_0_15px_rgba(244,63,94,0.05)]")}>
      <Sparkline colorClass={`text-${hoverColor}-500`} variant={sparkVariant} />
      
      <div className="relative z-10 flex items-center justify-between mb-4">
        <h3 className="text-[10px] sm:text-[11px] font-mono font-bold tracking-wider text-slate-500 uppercase flex items-center gap-1.5 cursor-default min-w-0">
          <span className="shrink-0">{icon}</span>
          <span className="truncate">{title}</span>
          {highlight && <PulseDot />}
        </h3>
      </div>
      
      <div className="relative z-10 mt-auto flex flex-col justify-end">
        {loading ? <Skeleton className="h-8 w-12 mb-1" /> : (
          <p className={cn("text-3xl font-mono tracking-tighter tabular-nums", highlight ? "text-rose-600 dark:text-rose-400" : "bg-clip-text text-transparent bg-gradient-to-b from-slate-900 to-slate-600 dark:from-white dark:to-slate-400")}>
            {value}
          </p>
        )}
        <div className="h-4">
          {!loading && delta && (
            <p className="text-[10px] font-mono tracking-wider uppercase text-slate-500 truncate">{delta}</p>
          )}
        </div>
      </div>
    </V2Card>
  );
}
