"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Clock3, Loader2, LogIn, LogOut } from "lucide-react";

import { loadCaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import { formatDisplayTime } from "@/lib/format/datetime";
import { getAppRoleFromClaims } from "@/lib/auth/app-role";
import { getDashboardRouteForRole } from "@/lib/auth/dashboard-routing";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

import { Button } from "@/components/ui/button";
import { CaregiverSupportStrip } from "@/components/caregiver/CaregiverSupportStrip";
import { FrontDoorClockNotice } from "@/components/caregiver/FrontDoorClockNotice";

type StaffRow = Pick<
  Database["public"]["Tables"]["staff"]["Row"],
  "id" | "facility_id" | "organization_id" | "first_name" | "last_name"
>;

type OpenPunch = Pick<
  Database["public"]["Tables"]["time_records"]["Row"],
  "id" | "clock_in" | "facility_id"
>;

/** The mobile punch for facilities that do not use the front-door kiosk. */
export function CaregiverClockPanel() {
  const supabase = useMemo(() => createClient(), []);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [workingFacilityId, setWorkingFacilityId] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [staff, setStaff] = useState<StaffRow | null>(null);
  const [openPunch, setOpenPunch] = useState<OpenPunch | null>(null);
  const [facilityName, setFacilityName] = useState<string | null>(null);
  const [facilityTimeZone, setFacilityTimeZone] = useState<string | undefined>(undefined);
  const [homeHref, setHomeHref] = useState("/caregiver");
  /** The server said this building clocks in at the front-door kiosk (spec 40 §1). */
  const [frontDoor, setFrontDoor] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    if (!isBrowserSupabaseConfigured()) {
      setMsg("Supabase is not configured.");
      setLoading(false);
      return;
    }
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setMsg("Sign in to use time clock.");
        setLoading(false);
        return;
      }
      setHomeHref(getDashboardRouteForRole(getAppRoleFromClaims(user)));

      const ctxRes = await loadCaregiverFacilityContext(supabase);
      if (!ctxRes.ok) {
        setMsg(ctxRes.error);
        setLoading(false);
        return;
      }
      setFacilityName(ctxRes.ctx.facilityName);
      setFacilityTimeZone(ctxRes.ctx.timeZone);
      setWorkingFacilityId(ctxRes.ctx.facilityId);

      const st = await supabase
        .from("staff")
        .select("id, facility_id, organization_id, first_name, last_name")
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .maybeSingle();

      if (st.error) throw st.error;
      if (!st.data) {
        setStaff(null);
        setOpenPunch(null);
        setMsg(
          "Your login is not linked to a staff record yet. Ask your administrator to link it.",
        );
        setLoading(false);
        return;
      }

      const s = st.data as StaffRow;
      setStaff(s);

      const punch = await supabase
        .from("time_records")
        .select("id, clock_in, facility_id")
        .eq("staff_id", s.id)
        .is("clock_out", null)
        .is("deleted_at", null)
        .order("clock_in", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (punch.error) throw punch.error;
      setOpenPunch((punch.data as OpenPunch | null) ?? null);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not load time clock.");
      setStaff(null);
      setOpenPunch(null);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Punches go through the server so the one-clock rule (spec 40 §1) holds even for a stale page. */
  async function punch(body: { action: "in"; facility_id: string } | { action: "out"; time_record_id: string }, failure: string) {
    setActing(true);
    setMsg(null);
    try {
      const response = await fetch("/api/caregiver/clock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "same-origin",
      });
      if (!response.ok) {
        const json = (await response.json().catch(() => null)) as { error?: unknown; code?: unknown } | null;
        if (response.status === 409 && json?.code === "front_door_clock") {
          setFrontDoor(true);
          return;
        }
        setMsg(typeof json?.error === "string" ? json.error : failure);
        return;
      }
      await refresh();
    } catch {
      setMsg(failure);
    } finally {
      setActing(false);
    }
  }

  async function clockIn() {
    if (!staff || !workingFacilityId) return;
    await punch({ action: "in", facility_id: workingFacilityId }, "Clock in failed.");
  }

  async function clockOut() {
    if (!openPunch) return;
    await punch({ action: "out", time_record_id: openPunch.id }, "Clock out failed.");
  }

  if (frontDoor) return <FrontDoorClockNotice homeHref={homeHref} />;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading time clock…
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-lg mx-auto mt-4 md:mt-10">
      <CaregiverSupportStrip
        active="clock"
        title="Start or end the shift cleanly, then move back into care work."
        description="Use the clock here, then head back to the shift dashboard or check your schedule if something looks off."
      />
      <div className="p-6 sm:p-10 rounded-xl border border-white/5 shadow-2xl relative overflow-visible z-10 w-full transition-all text-zinc-100 flex flex-col items-center text-center">
        <div className="w-16 h-16 rounded-lg bg-primary/20 flex items-center justify-center border border-primary/30 mb-6 shadow-inner">
          <Clock3 className="h-8 w-8 text-primary" />
        </div>
        
            <h3 className="text-3xl font-semibold text-white tracking-wide mb-2">Time clock</h3>
            <p className="text-sm font-mono text-primary/60 max-w-xs mb-8">
          {facilityName ? `Punch in and out for ${facilityName}.` : "Mobile punch tied to your staff profile."}
            </p>

        <div className="w-full space-y-6">
          {staff ? (
            <div className="py-2">
              <p className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground font-bold mb-1">Authenticated As</p>
              <p className="text-xl text-white">
                {staff.first_name} {staff.last_name}
              </p>
            </div>
          ) : null}

          {msg ? <div className="rounded-2xl border border-amber-500/30 bg-amber-950/40 px-4 py-3 text-sm text-amber-200 font-mono max-w-sm mx-auto shadow-inner">{msg}</div> : null}

          {staff && !msg?.includes("No staff profile") ? (
            <div className="space-y-6 mt-4">
              {openPunch ? (
                <div className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-5 py-3 text-[11px] uppercase tracking-wider font-mono text-emerald-300 font-bold w-fit mx-auto shadow-[inset_0_1px_10px_rgba(16,185,129,0.1)]">
                  Clocked in at {formatDisplayTime(openPunch.clock_in, { timeZone: facilityTimeZone })}
                </div>
              ) : (
                <div className="rounded-full border border-white/10 bg-black/40 px-5 py-3 text-[11px] uppercase tracking-wider font-mono text-muted-foreground font-bold w-fit mx-auto shadow-inner">
                  You are not clocked in
                </div>
              )}

              {openPunch ? (
                <Button
                  type="button"
                  className="h-16 rounded-full font-mono uppercase tracking-wider text-xs px-8 w-full shadow-[0_4px_20px_rgba(225,29,72,0.15)] transition-all hover:scale-[1.02] border-0 text-white font-bold bg-rose-600 hover:bg-rose-500 disabled:opacity-50 tap-responsive"
                  disabled={acting}
                  onClick={() => void clockOut()}
                >
                  {acting ? <Loader2 className="h-5 w-5 animate-spin mx-auto scale-125" /> : (
                    <>
                      <LogOut className="mr-3 h-5 w-5" />
                      Clock out
                    </>
                  )}
                </Button>
              ) : (
                <Button
                  type="button"
                  className="h-16 rounded-full font-mono uppercase tracking-wider text-xs px-8 w-full shadow-[0_4px_20px_rgba(16,185,129,0.15)] transition-all hover:scale-[1.02] border-0 text-zinc-950 font-bold bg-emerald-400 hover:bg-emerald-300 disabled:opacity-50 tap-responsive"
                  disabled={acting}
                  onClick={() => void clockIn()}
                >
                  {acting ? <Loader2 className="h-5 w-5 animate-spin mx-auto scale-125 text-zinc-950" /> : (
                    <>
                      <LogIn className="mr-3 h-5 w-5 text-zinc-950" />
                      Clock in
                    </>
                  )}
                </Button>
              )}
            </div>
          ) : null}

          <Link
            href={homeHref}
            className="inline-flex h-14 w-full items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-[11px] uppercase tracking-wider font-mono font-bold text-muted-foreground hover:bg-white/[0.08] hover:text-white transition-colors tap-responsive shadow-inner mt-4"
          >
            Back to shift home
          </Link>
        </div>
      </div>
    </div>
  );
}
