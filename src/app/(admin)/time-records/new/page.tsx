"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Clock, Loader2 } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

type StaffOption = { id: string; name: string };

type QueryError = { message: string; code?: string };

const MANUAL_METHOD = "manual_entry";

function toLocalDatetimeValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localDatetimeToIso(local: string): string {
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) throw new Error("Invalid date and time.");
  return d.toISOString();
}

/** Hours between two ISO timestamps minus break minutes. */
function computeHours(clockInIso: string, clockOutIso: string, breakMinutes: number): number {
  const a = new Date(clockInIso).getTime();
  const b = new Date(clockOutIso).getTime();
  const raw = (b - a) / 3600000 - breakMinutes / 60;
  return Math.max(0, Math.round(raw * 100) / 100);
}

export default function AdminNewTimeRecordPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { selectedFacilityId } = useFacilityStore();

  const [staffList, setStaffList] = useState<StaffOption[]>([]);
  const [staffLoading, setStaffLoading] = useState(true);

  const [staffId, setStaffId] = useState("");
  const [clockInLocal, setClockInLocal] = useState(() => toLocalDatetimeValue(new Date()));
  const [clockOutLocal, setClockOutLocal] = useState("");
  const [breakMinutes, setBreakMinutes] = useState("0");
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStaff = useCallback(async () => {
    setStaffLoading(true);
    try {
      if (!isValidFacilityIdForQuery(selectedFacilityId)) {
        setStaffList([]);
        return;
      }
      const { data, error: err } = (await supabase
        .from("staff" as never)
        .select("id, first_name, last_name")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .eq("employment_status", "active")
        .order("last_name", { ascending: true })
        .limit(400)) as {
        data: { id: string; first_name: string; last_name: string }[] | null;
        error: QueryError | null;
      };
      if (err) throw err;
      setStaffList(
        (data ?? []).map((s) => ({
          id: s.id,
          name: `${s.last_name?.trim() ?? ""}, ${s.first_name?.trim() ?? ""}`.replace(/^, |, $/g, "").trim() || "Staff",
        })),
      );
    } catch {
      setStaffList([]);
    } finally {
      setStaffLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void loadStaff();
  }, [loadStaff]);

  const loadFacilityOrg = useCallback(async () => {
    if (!isValidFacilityIdForQuery(selectedFacilityId)) return null;
    const res = (await supabase
      .from("facilities" as never)
      .select("organization_id")
      .eq("id", selectedFacilityId)
      .is("deleted_at", null)
      .maybeSingle()) as {
      data: { organization_id: string } | null;
      error: QueryError | null;
    };
    if (res.error) throw new Error(res.error.message);
    return res.data?.organization_id ?? null;
  }, [supabase, selectedFacilityId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidFacilityIdForQuery(selectedFacilityId)) {
      setError("Select a facility in the header first.");
      return;
    }
    if (!staffId.trim()) {
      setError("Choose a staff member.");
      return;
    }

    let clockInIso: string;
    try {
      clockInIso = localDatetimeToIso(clockInLocal);
    } catch {
      setError("Clock in is not a valid date and time.");
      return;
    }

    let clockOutIso: string | null = null;
    if (clockOutLocal.trim()) {
      try {
        clockOutIso = localDatetimeToIso(clockOutLocal);
      } catch {
        setError("Clock out is not a valid date and time.");
        return;
      }
      if (new Date(clockOutIso) <= new Date(clockInIso)) {
        setError("Clock out must be after clock in.");
        return;
      }
    }

    const br = Number.parseInt(breakMinutes, 10);
    if (!Number.isFinite(br) || br < 0) {
      setError("Break minutes must be zero or a positive whole number.");
      return;
    }

    let actualHours: number | null = null;
    let regularHours: number | null = null;
    if (clockOutIso) {
      actualHours = computeHours(clockInIso, clockOutIso, br);
      regularHours = actualHours;
    }

    setSubmitting(true);
    setError(null);
    try {
      const orgId = await loadFacilityOrg();
      if (!orgId) {
        setError("Could not resolve organization for this facility.");
        return;
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.id) {
        setError("You must be signed in.");
        return;
      }

      const payload = {
        facility_id: selectedFacilityId,
        organization_id: orgId,
        staff_id: staffId,
        shift_assignment_id: null as string | null,
        clock_in: clockInIso,
        clock_out: clockOutIso,
        clock_in_method: MANUAL_METHOD,
        clock_out_method: clockOutIso ? MANUAL_METHOD : null,
        scheduled_hours: null as number | null,
        actual_hours: actualHours,
        regular_hours: regularHours,
        overtime_hours: null as number | null,
        break_minutes: br,
        approved: false,
        discrepancy_notes: notes.trim() || null,
        created_by: user.id,
        updated_by: user.id,
      };

      const ins = (await supabase.from("time_records" as never).insert(payload as never).select("id").single()) as {
        data: { id: string } | null;
        error: QueryError | null;
      };

      if (ins.error) throw new Error(ins.error.message);
      router.push("/admin/time-records");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save time record.");
    } finally {
      setSubmitting(false);
    }
  };

  const facilityReady = isValidFacilityIdForQuery(selectedFacilityId);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/time-records"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}
        >
          <ArrowLeft className="h-4 w-4" />
          Time records
        </Link>
      </div>

      <div className="flex items-center gap-2">
        <Clock className="h-6 w-6 text-slate-500" />
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Add time record</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Manual or corrective punch for payroll review. Leave clock out empty only for rare open-punch cases; most
            entries should include both times.
          </p>
        </div>
      </div>

      {!facilityReady && (
        <p className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Choose a facility from the header selector to enable this form.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Punch</CardTitle>
          <CardDescription>
            Staff must belong to the selected facility. Hours compute from clock in/out minus unpaid break time.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void handleSubmit(e)} className="max-w-md space-y-4">
            {error && (
              <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                {error}
              </p>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400" htmlFor="staff">
                Staff member
              </label>
              <select
                id="staff"
                value={staffId}
                onChange={(e) => setStaffId(e.target.value)}
                required
                disabled={!facilityReady || staffLoading}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">{staffLoading ? "Loading…" : "Select staff"}</option>
                {staffList.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400" htmlFor="clock-in">
                Clock in
              </label>
              <Input
                id="clock-in"
                type="datetime-local"
                value={clockInLocal}
                onChange={(e) => setClockInLocal(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400" htmlFor="clock-out">
                Clock out (optional)
              </label>
              <Input
                id="clock-out"
                type="datetime-local"
                value={clockOutLocal}
                onChange={(e) => setClockOutLocal(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400" htmlFor="break">
                Unpaid break (minutes)
              </label>
              <Input
                id="break"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={breakMinutes}
                onChange={(e) => setBreakMinutes(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400" htmlFor="notes">
                Notes (optional)
              </label>
              <Input
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Kiosk missed; verified with nurse"
              />
            </div>

            <Button type="submit" disabled={submitting || !facilityReady || staffLoading}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save time record"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
