"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  BellRing,
  CalendarDays,
  CheckCircle2,
  Loader2,
  LogIn,
  MessageSquare,
  Pill,
  UserRound,
  Waves,
} from "lucide-react";

import { fetchCaregiverShiftBrief, type CaregiverShiftBrief } from "@/lib/caregiver/shift-brief";
import { loadCaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import { zonedYmd } from "@/lib/caregiver/emar-queue";
import { currentShiftForTimezone } from "@/lib/caregiver/shift";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function CaregiverHomePage() {
  const supabase = useMemo(() => createClient(), []);
  const [configError, setConfigError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [facilityName, setFacilityName] = useState<string | null>(null);
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
    try {
      const resolved = await loadCaregiverFacilityContext(supabase);
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
      const {
        data: { user },
      } = await supabase.auth.getUser();
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
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const shiftLine = useMemo(() => {
    const shift = currentShiftForTimezone(timeZone);
    const ymd = zonedYmd(new Date(), timeZone);
    const place = facilityName?.trim() || "Your facility";
    return `${place} · ${ymd} · ${shift} shift`;
  }, [facilityName, timeZone]);

  if (configError) {
    return (
      <div className="rounded-lg border border-amber-800/60 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">{configError}</div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-zinc-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading shift brief…
      </div>
    );
  }

  if (loadError || !brief) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-rose-800/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-100">
          {loadError ?? "Shift brief unavailable."}
        </div>
        <button
          type="button"
          className="inline-flex h-11 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 px-4 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
          onClick={() => void load()}
        >
          Retry
        </button>
      </div>
    );
  }

  const docPending = brief.openConditionCount + brief.pendingPrnCount;
  const emarWindow = brief.emarDueNow + brief.emarDueSoon;

  return (
    <div className="space-y-4">
      <Card className="border-zinc-800 bg-gradient-to-br from-zinc-950 to-zinc-900 text-zinc-100">
        <CardHeader className="pb-3">
          <CardTitle className="text-xl font-display">Current Shift Brief</CardTitle>
          <CardDescription className="text-zinc-400">{shiftLine}</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 text-xs">
          <StatPill label="Assigned Residents" value={String(brief.census)} tone="neutral" />
          <StatPill
            label="High priority reports"
            value={String(brief.highSeverityConditionCount)}
            tone={brief.highSeverityConditionCount > 0 ? "warning" : "neutral"}
          />
          <StatPill label="eMAR window" value={String(emarWindow)} tone="neutral" />
          <StatPill
            label="Documentation pending"
            value={String(docPending)}
            tone={docPending > 0 ? "danger" : "neutral"}
          />
        </CardContent>
      </Card>

      {activeOutbreak ? (
        <Card className="border-rose-900/50 bg-rose-950/25 text-zinc-100">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Active outbreak</CardTitle>
            <CardDescription className="text-rose-200/90">
              {activeOutbreak.infection_type.replace(/_/g, " ")} — follow facility protocol.
              {myOutbreakActions > 0
                ? ` ${myOutbreakActions} checklist item(s) assigned to you.`
                : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-zinc-400">
              Complete any tasks assigned to you in the outbreak checklist. Ask your nurse for details.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card className="border-amber-900/60 bg-amber-950/20 text-zinc-100">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            Critical alerts
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {brief.criticalAlerts.length === 0 ? (
            <p className="text-xs text-zinc-400">No open critical or high-priority condition reports.</p>
          ) : (
            brief.criticalAlerts.map((a) => (
              <Link
                key={a.id}
                href={`/caregiver/resident/${a.residentId}/condition-change`}
                className="block rounded-lg border border-amber-800/60 bg-zinc-950/80 p-3 transition-colors hover:bg-zinc-900"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-zinc-100">{a.title}</p>
                  <Badge className="border-amber-700 bg-amber-900/40 text-amber-200">{a.badge}</Badge>
                </div>
                <p className="text-xs text-zinc-400">{a.detail}</p>
              </Link>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="border-zinc-800 bg-zinc-950/60 text-zinc-100">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2">
          <QuickLink href="/caregiver/meds" icon={<Pill className="h-4 w-4" />} label="Open eMAR" />
          <QuickLink href="/caregiver/tasks" icon={<CheckCircle2 className="h-4 w-4" />} label="Task Queue" />
          <QuickLink href="/caregiver/incident-draft" icon={<AlertTriangle className="h-4 w-4" />} label="Report incident" />
          <QuickLink href="/caregiver/clock" icon={<LogIn className="h-4 w-4" />} label="Clock in / out" />
        </CardContent>
      </Card>

      <Card className="border-zinc-800 bg-zinc-950/60 text-zinc-100">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Shift workflows</CardTitle>
          <CardDescription className="text-zinc-400">Follow-ups, handoff, and PRN reassessment.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2">
          <QuickLink href="/caregiver/schedules" icon={<CalendarDays className="h-4 w-4" />} label="My schedule" />
          <QuickLink href="/caregiver/followups" icon={<BellRing className="h-4 w-4" />} label="Follow-ups" />
          <QuickLink href="/caregiver/handoff" icon={<MessageSquare className="h-4 w-4" />} label="Handoff" />
          <QuickLink href="/caregiver/prn-followup" icon={<Pill className="h-4 w-4" />} label="PRN follow-up" />
        </CardContent>
      </Card>

      <Card className="border-zinc-800 bg-zinc-950/60 text-zinc-100">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Resident watchlist</CardTitle>
          <CardDescription className="text-zinc-400">
            Elevated acuity or safety flags from the census (max five).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {brief.watchlist.length === 0 ? (
            <p className="text-xs text-zinc-400">No residents match elevated watch filters right now.</p>
          ) : (
            brief.watchlist.map((w) => (
              <Link
                key={w.id}
                href={`/caregiver/resident/${w.id}`}
                className="block rounded-lg border border-zinc-800 bg-zinc-950/80 p-3 transition-colors hover:bg-zinc-900"
              >
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <UserRound className="h-4 w-4 text-zinc-400" />
                    <p className="text-sm font-medium text-zinc-100">{w.name}</p>
                  </div>
                  <span className="text-xs text-zinc-400">Room {w.room}</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {w.flags.map((flag) => (
                    <Badge key={flag} variant="outline" className="border-zinc-700 text-zinc-300">
                      <Waves className="mr-1 h-3 w-3 text-zinc-500" />
                      {flag}
                    </Badge>
                  ))}
                </div>
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "neutral" | "warning" | "danger";
}) {
  const toneClass =
    tone === "danger"
      ? "border-rose-800/60 bg-rose-950/30"
      : tone === "warning"
        ? "border-amber-800/60 bg-amber-950/30"
        : "border-zinc-800 bg-zinc-900/80";

  return (
    <div className={`rounded-xl border px-3 py-2 ${toneClass}`}>
      <p className="text-[10px] uppercase tracking-wide text-zinc-400">{label}</p>
      <p className="mt-1 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}

function QuickLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex h-12 items-center justify-start gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-3 text-zinc-100 transition-colors hover:bg-zinc-800 hover:text-white tap-responsive"
    >
      {icon}
      <span className="text-xs">{label}</span>
    </Link>
  );
}
