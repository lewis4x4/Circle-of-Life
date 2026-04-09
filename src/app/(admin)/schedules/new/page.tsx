"use client";

import React, { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format, parseISO, startOfWeek } from "date-fns";
import { ArrowLeft, CalendarPlus, Loader2 } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

type QueryError = { message: string; code?: string };

/** Monday-start week; matches `idx_schedules_unique` on (facility_id, week_start_date). */
function mondayWeekStartFromPickerDate(isoDate: string): string {
  const d = parseISO(isoDate);
  if (Number.isNaN(d.getTime())) throw new Error("Invalid date.");
  return format(startOfWeek(d, { weekStartsOn: 1 }), "yyyy-MM-dd");
}

export default function AdminNewScheduleWeekPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { selectedFacilityId } = useFacilityStore();

  const defaultMonday = format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");
  const [weekAnchor, setWeekAnchor] = useState(defaultMonday);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const computedMonday = useMemo(() => {
    try {
      return mondayWeekStartFromPickerDate(weekAnchor);
    } catch {
      return null;
    }
  }, [weekAnchor]);

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
    let weekStart: string;
    try {
      weekStart = mondayWeekStartFromPickerDate(weekAnchor);
    } catch {
      setError("Choose a valid week date.");
      return;
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
        week_start_date: weekStart,
        status: "draft" as const,
        notes: notes.trim() || null,
        created_by: user.id,
        updated_by: user.id,
      };

      const ins = (await supabase
        .from("schedules" as never)
        .insert(payload as never)
        .select("id")
        .single()) as {
        data: { id: string } | null;
        error: QueryError | null;
      };

      if (ins.error) {
        if (ins.error.code === "23505") {
          setError(
            `A draft or published schedule for the week starting ${weekStart} already exists for this facility.`,
          );
          return;
        }
        throw new Error(ins.error.message);
      }
      if (ins.data?.id) {
        router.push(`/admin/schedules/${ins.data.id}`);
      } else {
        router.push("/admin/schedules");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create schedule week.");
    } finally {
      setSubmitting(false);
    }
  };

  const facilityReady = isValidFacilityIdForQuery(selectedFacilityId);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/schedules"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}
        >
          <ArrowLeft className="h-4 w-4" />
          Schedules
        </Link>
      </div>

      <div className="flex items-center gap-2">
        <CalendarPlus className="h-6 w-6 text-slate-500" />
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">New schedule week</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Creates a weekly container (draft). Shift assignments are added from the scheduling tools after the week
            exists. Weeks are unique per facility and Monday start date.
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
          <CardTitle>Week</CardTitle>
          <CardDescription>
            Pick any date in the target week — we store the **Monday** of that week ({computedMonday ?? "…"}).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 max-w-md">
            {error && (
              <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                {error}
              </p>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Date in target week</label>
              <Input type="date" value={weekAnchor} onChange={(e) => setWeekAnchor(e.target.value)} required />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Notes (optional)</label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Holiday coverage" />
            </div>

            <Button type="submit" disabled={submitting || !facilityReady}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating…
                </>
              ) : (
                "Create draft week"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
