"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  BellRing,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Loader2,
  LogIn,
  MessageSquare,
  Pill,
  UserRound,
  Waves,
  ChevronRight,
  ShieldAlert,
  Activity,
} from "lucide-react";

import { fetchCaregiverShiftBrief, type CaregiverShiftBrief } from "@/lib/caregiver/shift-brief";
import { loadCaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { getAppRoleFromClaims } from "@/lib/auth/app-role";
import { zonedYmd } from "@/lib/caregiver/emar-queue";
import { currentShiftForTimezone } from "@/lib/caregiver/shift";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type StatTone = "muted" | "danger" | "warning" | "accent";

export default function CaregiverHomePage() {
  const supabase = useMemo(() => createClient(), []);
  const { appRole, loading: authLoading, organizationId, user } = useHavenAuth();
  const effectiveRole = useMemo(() => getAppRoleFromClaims(user) || appRole, [appRole, user]);
  const [configError, setConfigError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [, setFacilityName] = useState<string | null>(null);
  const [timeZone, setTimeZone] = useState("America/New_York");
  const [brief, setBrief] = useState<CaregiverShiftBrief | null>(null);
  const [activeOutbreak, setActiveOutbreak] = useState<{ id: string; infection_type: string } | null>(null);
  const [myOutbreakActions, setMyOutbreakActions] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setConfigError(null);
    if (!isBrowserSupabaseConfigured()) {
      setConfigError(
        "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
      );
      setLoading(false);
      return;
    }
    if (authLoading) return;
    try {
      if (!user) {
        setLoadError("You need to sign in.");
        setLoading(false);
        return;
      }
      const resolved = await loadCaregiverFacilityContext(supabase, {
        userId: user.id,
        organizationId,
        appRole: effectiveRole,
      });
      if (!resolved.ok) {
        setLoadError(resolved.error);
        setLoading(false);
        return;
      }
      const { ctx } = resolved;
      setFacilityName(ctx.facilityName);
      setTimeZone(ctx.timeZone);
      const b = await fetchCaregiverShiftBrief(supabase, ctx);
      setBrief(b);
      const ob = await supabase
        .from("infection_outbreaks")
        .select("id, infection_type")
        .eq("facility_id", ctx.facilityId)
        .eq("status", "active")
        .is("deleted_at", null)
        .limit(1)
        .maybeSingle();
      const first = ob.data as { id: string; infection_type: string } | null;
      setActiveOutbreak(first);
      if (user && first) {
        const cnt = await supabase
          .from("outbreak_actions")
          .select("id", { count: "exact", head: true })
          .eq("outbreak_id", first.id)
          .eq("assigned_to", user.id)
          .in("status", ["pending", "in_progress"]);
        setMyOutbreakActions(cnt.count ?? 0);
      } else {
        setMyOutbreakActions(0);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load shift brief.");
      setBrief(null);
    } finally {
      setLoading(false);
    }
  }, [authLoading, effectiveRole, organizationId, supabase, user]);

  useEffect(() => {
    void load();
  }, [load]);

  const shiftLine = useMemo(() => {
    const shift = currentShiftForTimezone(timeZone);
    const ymd = zonedYmd(new Date(), timeZone);
    return `${ymd} · ${shift} shift`;
  }, [timeZone]);

  if (configError) {
    return (
      <div className="rounded-lg border border-warning/30 bg-warning/10 px-6 py-4 text-sm text-foreground">
        {configError}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center gap-4 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm font-medium uppercase tracking-wide">Initializing Shift Dashboard…</p>
      </div>
    );
  }

  if (loadError || !brief) {
    return (
      <div className="mx-auto mt-12 max-w-md space-y-4">
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-6 py-5 text-center text-sm text-foreground">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-destructive" />
          <p>{loadError ?? "Shift brief unavailable."}</p>
        </div>
        <button
          type="button"
          className="h-12 w-full rounded-lg border border-border bg-card text-sm font-semibold text-foreground transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
          onClick={() => void load()}
        >
          Retry Connection
        </button>
      </div>
    );
  }

  const docPending = brief.openConditionCount + brief.pendingPrnCount;
  const emarWindow = brief.emarDueNow + brief.emarDueSoon;

  return (
    <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-4 pb-6 md:grid-cols-4 md:gap-6">
      {/* Row 1: Mission control overview */}
      <div className="relative flex flex-col justify-between rounded-lg border border-border bg-card p-6 md:col-span-full md:p-8">
        <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">Shift Overview</h2>
            <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{shiftLine}</p>
          </div>
          <div className="flex w-fit items-center gap-2 rounded-full border border-border bg-muted px-4 py-2 text-sm text-foreground">
            <Activity className="h-4 w-4 text-success" />
            Live Census sync active
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <HeroStat
            label="My Residents"
            value={brief.census}
            icon={<UserRound />}
            tone="muted"
            href="/caregiver/residents"
          />
          <HeroStat
            label="Urgent Alerts"
            value={brief.highSeverityConditionCount}
            icon={<ShieldAlert />}
            tone={brief.highSeverityConditionCount > 0 ? "danger" : "muted"}
            href="/caregiver/followups"
          />
          <HeroStat
            label="Medications Due"
            value={emarWindow}
            icon={<Pill />}
            tone={emarWindow > 0 ? "accent" : "muted"}
            href="/caregiver/meds"
          />
          <HeroStat
            label="Notes To Finish"
            value={docPending}
            icon={<ClipboardList />}
            tone={docPending > 0 ? "warning" : "muted"}
            href="/caregiver/prn-followup"
          />
        </div>
      </div>

      {/* Row 2: Quick actions + alerts */}
      <div className="flex flex-col rounded-lg border border-border bg-card p-6 md:col-span-2">
        <div className="mb-6 flex items-center gap-2">
          <div className="h-6 w-1.5 rounded-full bg-primary" />
          <h3 className="text-lg font-medium text-foreground">Work Now</h3>
        </div>
        <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
          <ActionTile href="/caregiver/meds" icon={<Pill className="text-primary" />} title="Medication Pass" />
          <ActionTile
            href="/caregiver/incident-draft"
            icon={<AlertTriangle className="text-warning" />}
            title="Report An Incident"
          />
          <ActionTile
            href="/caregiver/rounds"
            icon={<CheckCircle2 className="text-success" />}
            title="Rounds & Checks"
          />
          <ActionTile href="/caregiver/clock" icon={<LogIn className="text-info" />} title="Shift Clock" />
        </div>
      </div>

      {/* Alerts column */}
      <div className="flex flex-col gap-4 md:col-span-2 md:gap-6">
        {activeOutbreak && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-5">
            <h3 className="mb-1 flex items-center gap-2 font-semibold text-foreground">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Active Protocol: {activeOutbreak.infection_type.replace(/_/g, " ")}
            </h3>
            <p className="mb-3 text-sm text-muted-foreground">
              Strict facility protocols are in effect. Check your assigned task list.
            </p>
            {myOutbreakActions > 0 && (
              <div className="inline-flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-1.5">
                <CheckCircle2 className="h-4 w-4 text-destructive" />
                <span className="text-xs font-semibold text-foreground">
                  {myOutbreakActions} tasks assigned to you
                </span>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-1 flex-col rounded-lg border border-border bg-card p-6">
          <div className="mb-4 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" />
            <h3 className="text-lg font-medium text-foreground">Critical Updates</h3>
          </div>

          <div className="flex-1 space-y-3">
            {brief.criticalAlerts.length === 0 ? (
              <div className="flex h-full items-center justify-center rounded-lg border-2 border-dashed border-border p-6 text-center">
                <p className="text-sm font-medium tracking-wide text-muted-foreground">
                  No high-priority conditions reported.
                </p>
              </div>
            ) : (
              brief.criticalAlerts.map((a) => (
                <Link
                  key={a.id}
                  href={`/caregiver/resident/${a.residentId}/condition-change`}
                  className="group flex min-h-[44px] flex-col rounded-lg border border-warning/30 bg-warning/10 p-4 transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:bg-warning/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">{a.title}</p>
                    <span className="shrink-0 rounded border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-warning">
                      {a.badge}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{a.detail}</p>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Row 3: Workflows + watchlist */}
      <div className="flex flex-col rounded-lg border border-border bg-card p-6 md:col-span-2">
        <h3 className="mb-1 text-lg font-medium text-foreground">Shift Workflows</h3>
        <p className="mb-6 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Routine &amp; Follow-ups
        </p>

        <div className="flex flex-1 flex-col gap-2">
          <WorkflowRow href="/caregiver/schedules" icon={<CalendarDays />} label="My Schedule" />
          <WorkflowRow href="/caregiver/followups" icon={<BellRing />} label="Condition Follow-ups" />
          <WorkflowRow href="/caregiver/handoff" icon={<MessageSquare />} label="Shift Handoff" />
          <WorkflowRow href="/caregiver/prn-followup" icon={<Pill />} label="PRN Reassessment" />
        </div>
      </div>

      <div className="flex flex-col rounded-lg border border-border bg-card p-6 md:col-span-2">
        <h3 className="mb-1 text-lg font-medium text-foreground">Watchlist</h3>
        <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Elevated Acuity / Safety
        </p>

        <div className="max-h-[300px] flex-1 space-y-3 overflow-y-auto pr-2">
          {brief.watchlist.length === 0 ? (
            <p className="rounded-lg border border-border bg-muted/40 py-8 text-center text-sm text-muted-foreground">
              Census stable. No elevated watch filters.
            </p>
          ) : (
            brief.watchlist.map((w) => (
              <Link
                key={w.id}
                href={`/caregiver/resident/${w.id}`}
                className="group flex min-h-[44px] items-center justify-between rounded-lg border border-border bg-card p-4 transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
              >
                <div>
                  <div className="mb-1.5 flex items-center gap-2">
                    <UserRound className="h-4 w-4 text-muted-foreground transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] group-hover:text-foreground" />
                    <p className="text-sm font-semibold text-foreground">{w.name}</p>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                      RM {w.room}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {w.flags.map((flag) => (
                      <span
                        key={flag}
                        className="inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground"
                      >
                        <Waves className="mr-1 h-2.5 w-2.5 text-muted-foreground" />
                        {flag}
                      </span>
                    ))}
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] group-hover:text-foreground" />
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function HeroStat({
  label,
  value,
  icon,
  tone,
  href,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  tone: StatTone;
  href?: string;
}) {
  const valueColor =
    tone === "danger"
      ? "text-destructive"
      : tone === "warning"
        ? "text-warning"
        : tone === "accent"
          ? "text-primary"
          : "text-foreground";
  const inner = (
    <div className="relative z-10 flex flex-col gap-1">
      <div className="mb-2 flex items-center gap-2 text-muted-foreground">
        <div className="h-5 w-5 opacity-80">{icon}</div>
        <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
      </div>
      <div className={cn("text-2xl font-medium tabular-nums tracking-tight md:text-3xl", valueColor)}>{value}</div>
    </div>
  );

  const baseClass =
    "group relative overflow-hidden rounded-lg border border-border bg-card p-5 transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0";
  const hoverClass = href ? " cursor-pointer hover:bg-muted/40" : "";

  if (href) {
    return (
      <Link href={href} className={cn(baseClass, hoverClass)}>
        {inner}
      </Link>
    );
  }

  return <div className={baseClass}>{inner}</div>;
}

function ActionTile({
  href,
  icon,
  title,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <Link
      href={href}
      className="group relative flex min-h-[44px] flex-col justify-center overflow-hidden rounded-lg border border-border bg-card p-5 transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
    >
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-muted">
        {icon}
      </div>
      <span className="text-sm font-semibold tracking-wide text-foreground">{title}</span>
    </Link>
  );
}

function WorkflowRow({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="group flex min-h-[44px] items-center justify-between rounded-lg border border-border bg-card p-4 transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
    >
      <div className="flex items-center gap-3">
        <div className="rounded-lg border border-border bg-muted p-2 text-muted-foreground transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] group-hover:text-foreground">
          {React.cloneElement(icon as React.ReactElement<{ className?: string }>, { className: "w-5 h-5" })}
        </div>
        <span className="text-sm font-medium text-foreground">{label}</span>
      </div>
      <ChevronRight className="h-5 w-5 text-muted-foreground transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] group-hover:text-foreground" />
    </Link>
  );
}
