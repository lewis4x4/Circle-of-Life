"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { fetchNurseMedicationBrief, type NurseMedicationBrief } from "@/lib/nurse/medication-brief";
import { Pill, ShieldCheck, AlertTriangle, Activity, FileWarning, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

export default function NurseDashboardPage() {
  const { selectedFacilityId } = useFacilityStore();
  const [brief, setBrief] = useState<NurseMedicationBrief | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await fetchNurseMedicationBrief(selectedFacilityId);
      setBrief(data);
    } catch (e) {
      console.error("[nurse-dashboard]", e);
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId]);

  useEffect(() => { void load(); }, [load]);

  if (isLoading) return <LoadingSkeleton />;

  if (!brief) return <ErrorState onRetry={load} />;

  return (
    <div className="space-y-10 pb-12">
      {/* Header */}
      <div className="flex flex-col gap-6 md:flex-row md:items-end justify-between bg-card p-8 rounded-[var(--radius)] border border-border shadow-[var(--shadow-card)]">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted text-muted-foreground border border-border text-[10px] font-medium uppercase tracking-wider mb-2">
            <Zap className="w-3.5 h-3.5" /> Medication Manager
          </div>
          <h1 className="text-2xl md:text-4xl font-semibold tracking-tight text-foreground">
            Medication Dashboard
          </h1>
          <p className="text-muted-foreground font-medium tracking-wide mt-2">
            eMAR compliance, controlled substances, and clinical oversight
          </p>
        </div>
      </div>

      {/* Hero Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Active Medications" value={brief.activeMedications} icon={Pill} urgency="normal" subLabel="Currently prescribed" href="/admin/residents" />
        <StatCard title="eMAR Compliance" value={`${brief.emarCompliancePct}%`} icon={Activity} urgency={brief.emarCompliancePct < 95 ? "critical" : "normal"} subLabel={brief.emarCompliancePct < 95 ? "Below 95% threshold" : "On target"} href="/med-tech" />
        <StatCard title="Med Errors (7d)" value={brief.medErrors7d} icon={AlertTriangle} urgency={brief.medErrors7d > 0 ? "critical" : "normal"} subLabel={brief.medErrors7d > 0 ? "Requires review" : "None reported"} href="/admin/medications/errors?review=unreviewed" />
        <StatCard title="Controlled Counts" value={brief.controlledDiscrepancies} icon={ShieldCheck} urgency={brief.controlledDiscrepancies > 0 ? "critical" : "normal"} subLabel={brief.controlledDiscrepancies > 0 ? "Discrepancies found" : "All verified"} href="/med-tech/controlled-count" />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Active Watches" value={brief.residentAssurance.activeWatches} icon={ShieldCheck} urgency="normal" subLabel="Residents under active watch" href="/admin/rounding/watches" />
        <StatCard title="Open Escalations" value={brief.residentAssurance.openEscalations} icon={AlertTriangle} urgency={brief.residentAssurance.openEscalations > 0 ? "critical" : "normal"} subLabel={brief.residentAssurance.openEscalations > 0 ? "Requires supervisor review" : "No active escalations"} href="/admin/rounding/escalations" />
        <StatCard title="Integrity Flags" value={brief.residentAssurance.openIntegrityFlags} icon={FileWarning} urgency={brief.residentAssurance.openIntegrityFlags > 0 ? "critical" : "normal"} subLabel={brief.residentAssurance.openIntegrityFlags > 0 ? "Late-entry review pending" : "Documentation lane clear"} href="/admin/rounding/integrity" />
        <StatCard title="Critical Safety" value={brief.residentAssurance.criticalSafetyResidents} icon={Zap} urgency={brief.residentAssurance.criticalSafetyResidents > 0 ? "critical" : "normal"} subLabel={brief.residentAssurance.criticalSafetyResidents > 0 ? "Immediate attention needed" : "No critical safety scores"} href="/admin/rounding/safety" />
      </div>

      {/* Quick Actions */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <ActionTile label="Open Med Pass" href="/med-tech" primary />
        <ActionTile label="Controlled Counts" href="/med-tech/controlled-count" />
        <ActionTile label="Med Error Review" href="/admin/medications/errors?review=unreviewed" />
        <ActionTile label="Report Incident" href="/admin/incidents/new" />
      </div>

      {/* Bottom sections */}
      <div className="grid gap-8 lg:grid-cols-2">
        {/* Missed Doses */}
        <div className="rounded-[var(--radius)] border border-border bg-card p-6 lg:p-8 shadow-[var(--shadow-card)]">
          <h3 className="text-xl font-semibold tracking-tight text-foreground mb-4 flex items-center gap-3">
            <FileWarning className="w-5 h-5 text-warning" /> Dose Alerts Today
          </h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center bg-muted/40 p-5 rounded-[var(--radius)] border border-border">
              <span className="text-[13px] font-medium uppercase tracking-wider text-muted-foreground">Missed / Held Doses</span>
              <span className="text-2xl font-semibold text-warning tabular-nums">{brief.missedDosesToday}</span>
            </div>
            <div className="flex justify-between items-center bg-muted/40 p-5 rounded-[var(--radius)] border border-border">
              <span className="text-[13px] font-medium uppercase tracking-wider text-muted-foreground">PRN Given (24h)</span>
              <span className="text-2xl font-semibold text-foreground tabular-nums">{brief.prnGiven24h}</span>
            </div>
          </div>
        </div>

        {/* Clinical Watchlist */}
        <div className="rounded-[var(--radius)] border border-border bg-card p-6 lg:p-8 shadow-[var(--shadow-card)]">
          <h3 className="text-xl font-semibold tracking-tight text-foreground mb-4 flex items-center gap-3">
            <Activity className="w-5 h-5 text-destructive" /> Clinical Watchlist
          </h3>
          {brief.watchlistResidents.length === 0 ? (
            <div className="text-center p-8 border-2 border-dashed border-border rounded-[var(--radius)]">
              <p className="text-sm font-medium text-muted-foreground">No residents flagged for medication review.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {brief.watchlistResidents.map((r) => (
                <div key={r.id} className="flex items-center justify-between p-4 rounded-[var(--radius)] bg-muted/40 border border-border">
                  <div>
                    <span className="text-[15px] font-semibold text-foreground">{r.name}</span>
                    <span className="text-xs font-medium text-muted-foreground ml-2">{r.room === "—" ? "Safety watch" : `Room ${r.room}`}</span>
                  </div>
                  <span className="text-xs font-medium text-warning">{r.reason}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon: Icon, urgency, subLabel, href }: {
  title: string; value: string | number; icon: React.ElementType<{ className?: string }>; urgency: "critical" | "normal"; subLabel: string; href: string;
}) {
  const bg = urgency === "critical" ? "bg-destructive/10 border-destructive/30" : "bg-card border-border";
  const text = urgency === "critical" ? "text-destructive" : "text-card-foreground";

  return (
    <Link href={href} className="block group">
      <div className={cn("rounded-[var(--radius)] p-6 lg:p-8 border shadow-[var(--shadow-card)] transition-all duration-[var(--motion-duration)] ease-[var(--motion-ease)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)] min-h-[160px] flex flex-col justify-between", bg)}>
        <div className="flex items-start justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{title}</span>
          <Icon className="w-5 h-5 text-muted-foreground" />
        </div>
        <div>
          <span className={cn("text-2xl font-semibold tabular-nums tracking-tight", text)}>{value}</span>
          <p className="text-xs font-medium text-muted-foreground mt-1">{subLabel}</p>
        </div>
      </div>
    </Link>
  );
}

function ActionTile({ label, href, primary }: { label: string; href: string; primary?: boolean }) {
  return (
    <Link href={href} className="block group">
      <div className={cn(
        "rounded-[var(--radius)] p-[15px] border font-semibold tracking-wide flex items-center justify-center transition-all duration-[var(--motion-duration)] ease-[var(--motion-ease)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)] text-sm",
        primary
          ? "bg-primary text-primary-foreground border-transparent hover:bg-[var(--accent-hover)]"
          : "bg-card text-card-foreground border-border hover:bg-secondary"
      )}>
        {label}
      </div>
    </Link>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-8 pt-2">
      <Skeleton className="h-32 w-full rounded-[var(--radius)] bg-muted" />
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-36 w-full rounded-[var(--radius)] bg-muted" />)}
      </div>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex h-[60vh] items-center justify-center">
      <div className="text-center">
        <p className="text-lg text-muted-foreground mb-4">Unable to load medication dashboard.</p>
        <button onClick={onRetry} className="px-6 py-3 rounded-[var(--radius)] bg-primary text-primary-foreground font-semibold hover:bg-[var(--accent-hover)]">Retry</button>
      </div>
    </div>
  );
}
