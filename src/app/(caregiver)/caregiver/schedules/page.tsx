"use client";

import { formatDateTimeWith, formatDisplayDate } from "@/lib/format/datetime";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, Loader2 } from "lucide-react";

import { loadCaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import { getAppRoleFromClaims } from "@/lib/auth/app-role";
import { getDashboardRouteForRole } from "@/lib/auth/dashboard-routing";
import { addFacilityCalendarDays, todayFacilityDateIso } from "@/lib/facility-wall-clock";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CaregiverSupportStrip } from "@/components/caregiver/CaregiverSupportStrip";
import { assignmentLabel, type AssignmentSnapshot } from "@/lib/schedules/assignment-context";
import { enumLabel } from "@/lib/display/enum-label";
import { formatScheduleTimes } from "@/lib/schedules/week-grid";
import { readAllPages } from "@/lib/supabase/read-all-pages";

type AssignmentRow = Database["public"]["Tables"]["shift_assignments"]["Row"] & AssignmentSnapshot;

export function getCaregiverScheduleWindow(now: Date, timeZone: string) {
  const today = todayFacilityDateIso(now, timeZone);
  return {
    start: addFacilityCalendarDays(today, -1, timeZone),
    end: addFacilityCalendarDays(today, 21, timeZone),
  };
}

export default function CaregiverSchedulesPage() {
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<AssignmentRow[]>([]);
  const [facilityName, setFacilityName] = useState<string | null>(null);
  const [homeHref, setHomeHref] = useState("/caregiver");
  const [scheduleWindow, setScheduleWindow] = useState<{ start: string; end: string } | null>(null);
  const [facilityTimeZone, setFacilityTimeZone] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!isBrowserSupabaseConfigured()) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("Sign in to view your schedule.");
        setLoading(false);
        return;
      }
      setHomeHref(getDashboardRouteForRole(getAppRoleFromClaims(user)));

      const ctxRes = await loadCaregiverFacilityContext(supabase);
      if (!ctxRes.ok) {
        setError(ctxRes.error);
        setLoading(false);
        return;
      }
      setFacilityName(ctxRes.ctx.facilityName);
      setFacilityTimeZone(ctxRes.ctx.timeZone);

      const st = await supabase
        .from("staff")
        .select("id")
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .maybeSingle();

      if (st.error) throw st.error;
      if (!st.data) {
        setRows([]);
        setError(
          "No staff profile is linked to your login. Ask an administrator to link your account to a staff record.",
        );
        setLoading(false);
        return;
      }

      const staffId = (st.data as { id: string }).id;
      const { start, end } = getCaregiverScheduleWindow(new Date(), ctxRes.ctx.timeZone);
      setScheduleWindow({ start, end });

      const q = await readAllPages((from, to) => supabase
        .from("shift_assignments")
        .select("*, schedules!inner(status, deleted_at)", { count: "exact" })
        .eq("schedules.status", "published")
        .is("schedules.deleted_at", null)
        .eq("staff_id", staffId)
        .eq("facility_id", ctxRes.ctx.facilityId)
        .gte("shift_date", start)
        .lte("shift_date", end)
        .is("deleted_at", null)
        .order("shift_date", { ascending: true })
        .order("custom_start_time", { ascending: true })
        .order("id")
        .range(from, to));

      if (q.error) throw q.error;
      setRows((q.data ?? []) as AssignmentRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load schedule.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <Link href="/caregiver/shift-swaps" className="text-sm underline">Review and confirm my shift swaps</Link>
      <CaregiverSupportStrip
        active="schedules"
        title="Check your published shifts before or after the floor workflow changes."
        description="Use this view to confirm where you are expected next, then return to the shift home or clock if your assignment timing needs attention."
      />
      <Card className="border-border bg-card text-card-foreground">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-xl">
            <CalendarDays className="h-5 w-5 text-primary" />
            My schedule
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {scheduleWindow ? facilityName
              ? `Published shifts at ${facilityName} from ${formatDisplayDate(scheduleWindow.start)} through ${formatDisplayDate(scheduleWindow.end)}.`
              : `Published shift assignments from ${formatDisplayDate(scheduleWindow.start)} through ${formatDisplayDate(scheduleWindow.end)}.` : "Published work appears here after your facility schedule loads."}
          </CardDescription>
        </CardHeader>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading your schedule…
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-foreground">
          {error}
        </div>
      ) : null}

      {!loading && !error && scheduleWindow && rows.length === 0 ? (
        <Card className="border-border bg-card text-card-foreground">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No shift assignments from {formatDisplayDate(scheduleWindow.start)} through {formatDisplayDate(scheduleWindow.end)}. Scheduling
            publishes from the admin console.
          </CardContent>
        </Card>
      ) : null}

      {!loading && rows.length > 0 ? (
        <div className="space-y-2">
          {rows.map((r) => (
            <Card
              key={r.id}
              style={r.schedule_preset_color ? { borderInlineStartColor: r.schedule_preset_color, borderInlineStartWidth: 4 } : undefined}
              className="border-border bg-card text-card-foreground transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:bg-muted/40"
            >
              <CardContent className="flex min-h-[44px] flex-wrap items-center justify-between gap-2 p-4">
                <div>
                  <p className="text-sm font-semibold text-foreground">{formatShiftDate(r.shift_date)}</p>
                  <p className="text-xs text-muted-foreground">
                    {assignmentLabel(r)} · {formatScheduleTimes(r.custom_start_time, r.custom_end_time)} · {r.schedule_time_zone || facilityTimeZone || "Time zone unavailable"}{r.schedule_block_count && r.schedule_block_count > 1 ? ` · Block ${(r.schedule_block_index ?? 0) + 1} of ${r.schedule_block_count}` : ""}
                  </p>
                </div>
                <Badge variant="outline" className="border-border capitalize text-foreground">
                  {enumLabel(r.status)}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      <Link
        href={homeHref}
        className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-border bg-card text-sm font-medium text-foreground transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
      >
        Back to shift home
      </Link>
    </div>
  );
}

function formatShiftDate(d: string): string {
  return formatDateTimeWith(d.slice(0, 10), { weekday: "short", month: "short", day: "numeric", year: "numeric" }, { fallback: d });
}
