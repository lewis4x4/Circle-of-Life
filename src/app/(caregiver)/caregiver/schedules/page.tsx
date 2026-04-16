"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, Loader2 } from "lucide-react";

import { loadCaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import { getAppRoleFromClaims } from "@/lib/auth/app-role";
import { getDashboardRouteForRole } from "@/lib/auth/dashboard-routing";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CaregiverSupportStrip } from "@/components/caregiver/CaregiverSupportStrip";

type AssignmentRow = Database["public"]["Tables"]["shift_assignments"]["Row"];

export default function CaregiverSchedulesPage() {
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<AssignmentRow[]>([]);
  const [facilityName, setFacilityName] = useState<string | null>(null);
  const [homeHref, setHomeHref] = useState("/caregiver");

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
      const start = new Date();
      start.setDate(start.getDate() - 1);
      const end = new Date();
      end.setDate(end.getDate() + 21);

      const q = await supabase
        .from("shift_assignments")
        .select("*")
        .eq("staff_id", staffId)
        .eq("facility_id", ctxRes.ctx.facilityId)
        .gte("shift_date", start.toISOString().slice(0, 10))
        .lte("shift_date", end.toISOString().slice(0, 10))
        .is("deleted_at", null)
        .order("shift_date", { ascending: true })
        .order("shift_type", { ascending: true });

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
      <CaregiverSupportStrip
        active="schedules"
        title="Check your published shifts before or after the floor workflow changes."
        description="Use this view to confirm where you are expected next, then return to the shift home or clock if your assignment timing needs attention."
      />
      <Card className="border-zinc-800 bg-gradient-to-br from-zinc-950 to-zinc-900 text-zinc-100">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-xl font-display">
            <CalendarDays className="h-5 w-5 text-teal-400" />
            My schedule
          </CardTitle>
          <CardDescription className="text-zinc-400">
            {facilityName ? `Published shifts at ${facilityName} for the next few weeks.` : "Your published shift assignments."}
          </CardDescription>
        </CardHeader>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-zinc-400">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading…
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-amber-800/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">{error}</div>
      ) : null}

      {!loading && !error && rows.length === 0 ? (
        <Card className="border-zinc-800 bg-zinc-950/70 text-zinc-100">
          <CardContent className="py-8 text-center text-sm text-zinc-400">
            No shift assignments in this window. Scheduling publishes from the admin console.
          </CardContent>
        </Card>
      ) : null}

      {!loading && rows.length > 0 ? (
        <div className="space-y-2">
          {rows.map((r) => (
            <Card key={r.id} className="border-zinc-800 bg-zinc-950/80 text-zinc-100">
              <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
                <div>
                  <p className="text-sm font-semibold text-white">{formatShiftDate(r.shift_date)}</p>
                  <p className="text-xs text-zinc-400 capitalize">{String(r.shift_type).replace(/_/g, " ")}</p>
                </div>
                <Badge variant="outline" className="border-zinc-600 capitalize text-zinc-200">
                  {r.status.replace(/_/g, " ")}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      <Link
        href={homeHref}
        className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
      >
        Back to shift home
      </Link>
    </div>
  );
}

function formatShiftDate(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  if (!y || !m || !day) return d;
  const dt = new Date(y, m - 1, day);
  return dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}
