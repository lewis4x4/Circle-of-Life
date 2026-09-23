"use client";

import React, { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ClipboardList, Loader2 } from "lucide-react";

import { FacilityGateNotice } from "@/components/common/FacilityGate";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

import type { Database } from "@/types/database";

type ShiftType = Database["public"]["Enums"]["shift_type"];
type QueryError = { message: string; code?: string };

const SHIFT_OPTIONS: { value: ShiftType; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "evening", label: "Evening" },
  { value: "night", label: "Night" },
  { value: "custom", label: "Custom" },
];

function toLocalDatetimeValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localDatetimeToIso(local: string): string {
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) throw new Error("Invalid snapshot time.");
  return d.toISOString();
}

/** Residents per staff on duty; compliant when ratio <= required_ratio (see seed + list copy). */
function computeRatio(residents: number, staffOnDuty: number): number {
  if (staffOnDuty <= 0) return 0;
  return Math.round((residents / staffOnDuty) * 100) / 100;
}

export default function AdminNewStaffingSnapshotPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { selectedFacilityId } = useFacilityStore();

  // Every count starts empty: "8 residents / 4 staff / ratio 5" saved a fake census in one
  // click, and the required ratio is the facility's rule, not a number this page may hold
  // (COL-653). No facility has a ratio rule set yet; until one does, the operator enters it.
  const [shift, setShift] = useState<ShiftType | "">("");
  const [residentsPresent, setResidentsPresent] = useState("");
  const [staffOnDuty, setStaffOnDuty] = useState("");
  const [requiredRatio, setRequiredRatio] = useState("");
  const [snapshotLocal, setSnapshotLocal] = useState(() => toLocalDatetimeValue(new Date()));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const previewRatio = useMemo(() => {
    const r = Number.parseInt(residentsPresent, 10);
    const s = Number.parseInt(staffOnDuty, 10);
    if (!Number.isFinite(r) || !Number.isFinite(s) || s < 1) return null;
    return computeRatio(r, s);
  }, [residentsPresent, staffOnDuty]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidFacilityIdForQuery(selectedFacilityId)) {
      return;
    }

    if (!shift) {
      setError("Choose the shift.");
      return;
    }

    const resN = Number.parseInt(residentsPresent, 10);
    const staffN = Number.parseInt(staffOnDuty, 10);
    const req = Number.parseFloat(requiredRatio);

    if (!Number.isFinite(resN) || resN < 0) {
      setError("Residents present must be a non-negative whole number.");
      return;
    }
    if (!Number.isFinite(staffN) || staffN < 1) {
      setError("Staff on duty must be at least 1.");
      return;
    }
    if (!Number.isFinite(req) || req <= 0) {
      setError("Required ratio must be a positive number.");
      return;
    }

    let snapshotIso: string;
    try {
      snapshotIso = localDatetimeToIso(snapshotLocal);
    } catch {
      setError("Choose a valid snapshot date and time.");
      return;
    }

    const ratio = computeRatio(resN, staffN);
    const isCompliant = ratio <= req;

    setSubmitting(true);
    setError(null);
    try {
      const orgId = await loadFacilityOrg();
      if (!orgId) {
        setError("Could not resolve organization for this facility.");
        return;
      }

      const payload = {
        facility_id: selectedFacilityId,
        organization_id: orgId,
        snapshot_at: snapshotIso,
        shift,
        residents_present: resN,
        staff_on_duty: staffN,
        ratio,
        required_ratio: Math.round(req * 100) / 100,
        is_compliant: isCompliant,
        staff_detail: [] as const,
      };

      const ins = (await supabase
        .from("staffing_ratio_snapshots" as never)
        .insert(payload as never)
        .select("id")
        .single()) as {
        data: { id: string } | null;
        error: QueryError | null;
      };

      if (ins.error) throw new Error(ins.error.message);
      router.push("/admin/staffing");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record snapshot.");
    } finally {
      setSubmitting(false);
    }
  };

  const facilityReady = isValidFacilityIdForQuery(selectedFacilityId);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/staffing"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}
        >
          <ArrowLeft className="h-4 w-4" />
          Staffing ratios
        </Link>
      </div>

      <div className="flex items-center gap-2">
        <ClipboardList className="h-6 w-6 text-slate-500" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">New ratio snapshot</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Record a point-in-time census and coverage count. Ratio is residents ÷ staff on duty; compliance is ratio ≤
            required (lower ratio means more staff per resident).
          </p>
        </div>
      </div>

      {facilityReady ? (
        <Card>
          <CardHeader>
            <CardTitle>Snapshot</CardTitle>
            <CardDescription>
              {previewRatio !== null ? (
                <>
                  Computed ratio: <strong className="tabular-nums">{previewRatio.toFixed(2)}</strong> residents per
                  staff.
                </>
              ) : (
                "Enter residents and staff to preview the computed ratio."
              )}
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
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400" htmlFor="snapshot-at">
                  Snapshot time
                </label>
                <Input
                  id="snapshot-at"
                  type="datetime-local"
                  value={snapshotLocal}
                  onChange={(e) => setSnapshotLocal(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400" htmlFor="shift">
                  Shift
                </label>
                <select
                  id="shift"
                  value={shift}
                  onChange={(e) => setShift(e.target.value as ShiftType)}
                  required
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="" disabled>
                    Select shift…
                  </option>
                  {SHIFT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400" htmlFor="residents">
                  Residents present
                </label>
                <Input
                  id="residents"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={residentsPresent}
                  onChange={(e) => setResidentsPresent(e.target.value)}
                  placeholder="Count at snapshot time"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400" htmlFor="staff">
                  Staff on duty
                </label>
                <Input
                  id="staff"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={staffOnDuty}
                  onChange={(e) => setStaffOnDuty(e.target.value)}
                  placeholder="Count at snapshot time"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400" htmlFor="required">
                  Required ratio (max residents per staff)
                </label>
                <Input
                  id="required"
                  type="number"
                  inputMode="decimal"
                  min={0.01}
                  step={0.01}
                  value={requiredRatio}
                  onChange={(e) => setRequiredRatio(e.target.value)}
                  placeholder="From your facility's staffing rule"
                  required
                />
              </div>

              <Button type="submit" disabled={submitting || !facilityReady}>
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  "Record snapshot"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <FacilityGateNotice reason="Ratio snapshots are taken for one building, so this form opens once a facility is chosen." />
      )}
    </div>
  );
}
