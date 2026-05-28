"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { fetchCoordinatorDashboardBrief, type CoordinatorDashboardBrief } from "@/lib/coordinator/dashboard-brief";
import { ClipboardList, FileCheck, MessageSquare, UserPlus, Activity, CalendarClock, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

export default function CoordinatorDashboardPage() {
  const { selectedFacilityId } = useFacilityStore();
  const [brief, setBrief] = useState<CoordinatorDashboardBrief | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await fetchCoordinatorDashboardBrief(selectedFacilityId);
      setBrief(data);
    } catch (e) {
      console.error("[coordinator-dashboard]", e);
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
            <Zap className="w-3.5 h-3.5" /> Resident Services
          </div>
          <h1 className="text-2xl md:text-4xl font-semibold tracking-tight text-foreground">
            Coordinator Dashboard
          </h1>
          <p className="text-muted-foreground font-medium tracking-wide mt-2">
            Care plans, assessments, family engagement, and admissions pipeline
          </p>
        </div>
      </div>

      {/* Hero Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Active Care Plans" value={brief.activeCarePlans} icon={ClipboardList} urgency="normal" subLabel="Currently active" href="/admin/care-plans/reviews-due" />
        <StatCard title="Reviews Due (14d)" value={brief.reviewsDue14d} icon={CalendarClock} urgency={brief.reviewsDue14d > 0 ? "critical" : "normal"} subLabel={brief.reviewsDue14d > 0 ? "Attention needed" : "All current"} href="/admin/care-plans/reviews-due" />
        <StatCard title="Pending Assessments" value={brief.pendingAssessments} icon={FileCheck} urgency={brief.pendingAssessments > 0 ? "critical" : "normal"} subLabel={brief.pendingAssessments > 0 ? "Awaiting completion" : "None pending"} href="/admin/assessments/overdue" />
        <StatCard title="Family Messages" value={brief.unreadFamilyMessages} icon={MessageSquare} urgency={brief.unreadFamilyMessages > 0 ? "critical" : "normal"} subLabel={brief.unreadFamilyMessages > 0 ? "Unread messages" : "All read"} href="/admin/family-messages" />
      </div>

      {/* Quick Actions */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <ActionTile label="Care Plans" href="/admin/care-plans/reviews-due" />
        <ActionTile label="Assessments" href="/admin/assessments/overdue" />
        <ActionTile label="Family Messages" href="/admin/family-messages" />
        <ActionTile label="Admissions" href="/admin/admissions" />
      </div>

      {/* Bottom sections */}
      <div className="grid gap-8 lg:grid-cols-2">
        {/* Care Plans Due */}
        <div className="rounded-[var(--radius)] border border-border bg-card p-6 lg:p-8 shadow-[var(--shadow-card)]">
          <h3 className="text-xl font-semibold tracking-tight text-foreground mb-4 flex items-center gap-3">
            <CalendarClock className="w-5 h-5 text-warning" /> Care Plans Due for Review
          </h3>
          {brief.carePlansDue.length === 0 ? (
            <div className="text-center p-8 border-2 border-dashed border-border rounded-[var(--radius)]">
              <p className="text-sm font-medium text-muted-foreground">No care plans due for review in the next 14 days.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {brief.carePlansDue.map((cp) => (
                <div key={cp.id} className="flex items-center justify-between p-4 rounded-[var(--radius)] bg-muted/40 border border-border">
                  <div>
                    <span className="text-[15px] font-semibold text-foreground">{cp.residentName}</span>
                  </div>
                  <span className="text-xs font-medium text-warning">
                    {new Date(cp.reviewDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pending Admissions */}
        <div className="rounded-[var(--radius)] border border-border bg-card p-6 lg:p-8 shadow-[var(--shadow-card)]">
          <h3 className="text-xl font-semibold tracking-tight text-foreground mb-4 flex items-center gap-3">
            <UserPlus className="w-5 h-5 text-info" /> Admission Pipeline
          </h3>
          {brief.pendingAdmissions.length === 0 ? (
            <div className="text-center p-8 border-2 border-dashed border-border rounded-[var(--radius)]">
              <p className="text-sm font-medium text-muted-foreground">No pending admissions or inquiries.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {brief.pendingAdmissions.map((a) => (
                <div key={a.id} className="flex items-center justify-between p-4 rounded-[var(--radius)] bg-muted/40 border border-border">
                  <div>
                    <span className="text-[15px] font-semibold text-foreground">{a.name}</span>
                  </div>
                  <span className="text-xs font-medium text-info">
                    {a.daysSinceInquiry}d since inquiry
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Secondary Stats Row */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-[var(--radius)] border border-border bg-card p-6 shadow-[var(--shadow-card)] flex items-center gap-4">
          <Activity className="w-5 h-5 text-destructive" />
          <div>
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Condition Changes (48h)</span>
            <p className="text-2xl font-semibold text-foreground tabular-nums">{brief.recentConditionChanges}</p>
          </div>
        </div>
        <div className="rounded-[var(--radius)] border border-border bg-card p-6 shadow-[var(--shadow-card)] flex items-center gap-4">
          <UserPlus className="w-5 h-5 text-info" />
          <div>
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Active Admissions</span>
            <p className="text-2xl font-semibold text-foreground tabular-nums">{brief.activeAdmissions}</p>
          </div>
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
        <p className="text-lg text-muted-foreground mb-4">Unable to load coordinator dashboard.</p>
        <button onClick={onRetry} className="px-6 py-3 rounded-[var(--radius)] bg-primary text-primary-foreground font-semibold hover:bg-[var(--accent-hover)]">Retry</button>
      </div>
    </div>
  );
}
