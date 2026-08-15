"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { fetchAdminAssistantDashboardBrief, type AdminAssistantDashboardBrief } from "@/lib/admin-assistant/dashboard-brief";
import {
  FAMILY_BULLETIN_DASHBOARD_ACTION_LABEL,
  FAMILY_BULLETIN_DASHBOARD_RECENT_EMPTY_DESCRIPTION,
  FAMILY_BULLETIN_DASHBOARD_RECENT_EMPTY_TITLE,
  FAMILY_BULLETIN_DASHBOARD_RECENT_SECTION_TITLE,
  FAMILY_BULLETIN_DASHBOARD_TILE_EMPTY_SUBLABEL,
  FAMILY_BULLETIN_DASHBOARD_TILE_SUBLABEL_ACTIVE,
  FAMILY_BULLETIN_DASHBOARD_TILE_TITLE,
} from "@/lib/admin/family-bulletin-dashboard-copy";
import { FAMILY_BULLETIN_ONE_WAY_HELPER } from "@/lib/admin/family-messages-copy";
import { Users, FileText, MessageSquare, Truck, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

export default function AssistantDashboardPage() {
  const { selectedFacilityId } = useFacilityStore();
  const [brief, setBrief] = useState<AdminAssistantDashboardBrief | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await fetchAdminAssistantDashboardBrief(selectedFacilityId);
      setBrief(data);
    } catch (e) {
      console.error("[assistant-dashboard]", e);
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
            <Zap className="w-3.5 h-3.5" /> Front Desk
          </div>
          <h1 className="text-2xl md:text-4xl font-semibold tracking-tight text-foreground">
            Admin Assistant Dashboard
          </h1>
          <p className="text-muted-foreground font-medium tracking-wide mt-2">
            Census, documents, family portal notes, and daily operations overview
          </p>
        </div>
      </div>

      {/* Hero Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Census" value={brief.censusCount} icon={Users} urgency="normal" subLabel="Active residents" href="/admin/residents" />
        <StatCard title="Pending Docs" value={brief.pendingDocs} icon={FileText} urgency={brief.pendingDocs > 0 ? "critical" : "normal"} subLabel={brief.pendingDocs > 0 ? "Awaiting action" : "All processed"} href="/admin/knowledge/admin" />
        <StatCard
          title={FAMILY_BULLETIN_DASHBOARD_TILE_TITLE}
          value={brief.staffBulletinNotes}
          icon={MessageSquare}
          urgency="normal"
          subLabel={brief.staffBulletinNotes > 0 ? FAMILY_BULLETIN_DASHBOARD_TILE_SUBLABEL_ACTIVE : FAMILY_BULLETIN_DASHBOARD_TILE_EMPTY_SUBLABEL}
          href="/admin/family-messages"
        />
        <StatCard title="Transport Today" value={brief.transportationToday} icon={Truck} urgency="normal" subLabel="Scheduled trips" href="/admin/transportation" />
      </div>

      {/* Quick Actions */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <ActionTile label="Resident Directory" href="/admin/residents" />
        <ActionTile label={FAMILY_BULLETIN_DASHBOARD_ACTION_LABEL} href="/admin/family-messages" />
        <ActionTile label="Staff Directory" href="/admin/staff" />
        <ActionTile label="Transportation" href="/admin/transportation" />
      </div>

      {/* Bulletin notes */}
      <div className="rounded-[var(--radius)] border border-border bg-card p-6 lg:p-8 shadow-[var(--shadow-card)]">
        <h3 className="text-xl font-semibold tracking-tight text-foreground mb-2 flex items-center gap-3">
          <MessageSquare className="w-5 h-5 text-info" /> {FAMILY_BULLETIN_DASHBOARD_RECENT_SECTION_TITLE}
        </h3>
        <p className="text-sm text-muted-foreground mb-4">{FAMILY_BULLETIN_ONE_WAY_HELPER}</p>
        {brief.recentBulletinNotes.length === 0 ? (
          <div className="text-center p-8 border-2 border-dashed border-border rounded-[var(--radius)]">
            <p className="text-sm font-semibold text-foreground">{FAMILY_BULLETIN_DASHBOARD_RECENT_EMPTY_TITLE}</p>
            <p className="text-sm font-medium text-muted-foreground mt-2">{FAMILY_BULLETIN_DASHBOARD_RECENT_EMPTY_DESCRIPTION}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {brief.recentBulletinNotes.map((note) => (
              <div key={note.id} className="flex items-center justify-between p-4 rounded-[var(--radius)] bg-muted/40 border border-border">
                <div className="min-w-0">
                  <span className="text-[15px] font-semibold text-foreground truncate block">{note.preview}</span>
                </div>
                <span className="text-xs font-medium text-muted-foreground shrink-0 ml-4">
                  {new Date(note.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
              </div>
            ))}
          </div>
        )}
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
        <p className="text-lg text-muted-foreground mb-4">Unable to load assistant dashboard.</p>
        <button onClick={onRetry} className="px-6 py-3 rounded-[var(--radius)] bg-primary text-primary-foreground font-semibold hover:bg-[var(--accent-hover)]">Retry</button>
      </div>
    </div>
  );
}
