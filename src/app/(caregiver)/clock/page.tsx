"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, LogIn, LogOut } from "lucide-react";

import { loadCaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type StaffRow = Pick<
  Database["public"]["Tables"]["staff"]["Row"],
  "id" | "facility_id" | "organization_id" | "first_name" | "last_name"
>;

type OpenPunch = Pick<
  Database["public"]["Tables"]["time_records"]["Row"],
  "id" | "clock_in" | "facility_id"
>;

export default function CaregiverClockPage() {
  const supabase = useMemo(() => createClient(), []);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [staff, setStaff] = useState<StaffRow | null>(null);
  const [openPunch, setOpenPunch] = useState<OpenPunch | null>(null);
  const [facilityName, setFacilityName] = useState<string | null>(null);

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

      const ctxRes = await loadCaregiverFacilityContext(supabase);
      if (!ctxRes.ok) {
        setMsg(ctxRes.error);
        setLoading(false);
        return;
      }
      setFacilityName(ctxRes.ctx.facilityName);

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
          "No staff profile is linked to your login. Ask an administrator to set user_id on your staff row in Haven.",
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

  async function clockIn() {
    if (!staff) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setMsg("Session expired.");
      return;
    }
    setActing(true);
    setMsg(null);
    try {
      const row: Database["public"]["Tables"]["time_records"]["Insert"] = {
        staff_id: staff.id,
        facility_id: staff.facility_id,
        organization_id: staff.organization_id,
        clock_in: new Date().toISOString(),
        clock_in_method: "mobile",
        approved: false,
        created_by: user.id,
      };
      const ins = await supabase.from("time_records").insert(row).select("id").single();
      if (ins.error) throw ins.error;
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Clock in failed.");
    } finally {
      setActing(false);
    }
  }

  async function clockOut() {
    if (!openPunch) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setMsg("Session expired.");
      return;
    }
    setActing(true);
    setMsg(null);
    try {
      const upd = await supabase
        .from("time_records")
        .update({
          clock_out: new Date().toISOString(),
          clock_out_method: "mobile",
          updated_by: user.id,
        })
        .eq("id", openPunch.id)
        .is("deleted_at", null);
      if (upd.error) throw upd.error;
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Clock out failed.");
    } finally {
      setActing(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-zinc-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading time clock…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-zinc-800 bg-gradient-to-br from-zinc-950 to-zinc-900 text-zinc-100">
        <CardHeader className="pb-2">
          <CardTitle className="text-xl font-display">Time clock</CardTitle>
          <CardDescription className="text-zinc-400">
            {facilityName ? `Punch in/out for ${facilityName}.` : "Mobile punch tied to your staff profile."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {staff ? (
            <p className="text-sm text-zinc-300">
              {staff.first_name} {staff.last_name}
            </p>
          ) : null}

          {msg ? <div className="rounded-lg border border-amber-800/60 bg-amber-950/30 px-3 py-2 text-sm text-amber-100">{msg}</div> : null}

          {staff && !msg?.includes("No staff profile") ? (
            <>
              {openPunch ? (
                <div className="rounded-lg border border-emerald-800/50 bg-emerald-950/20 px-3 py-2 text-sm text-emerald-100">
                  Clocked in at {new Date(openPunch.clock_in).toLocaleString()}
                </div>
              ) : (
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-400">
                  You are not clocked in.
                </div>
              )}

              {openPunch ? (
                <Button
                  type="button"
                  className="h-12 w-full bg-rose-700 text-white hover:bg-rose-600 disabled:opacity-50"
                  disabled={acting}
                  onClick={() => void clockOut()}
                >
                  {acting ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogOut className="mr-2 h-5 w-5" />}
                  Clock out
                </Button>
              ) : (
                <Button
                  type="button"
                  className="h-12 w-full bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50"
                  disabled={acting}
                  onClick={() => void clockIn()}
                >
                  {acting ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogIn className="mr-2 h-5 w-5" />}
                  Clock in
                </Button>
              )}
            </>
          ) : null}

          <Link
            href="/caregiver"
            className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
          >
            Back to shift home
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
