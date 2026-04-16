"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Loader2, Stethoscope } from "lucide-react";

import { getAppRoleFromClaims } from "@/lib/auth/app-role";
import { getDashboardRouteForRole } from "@/lib/auth/dashboard-routing";
import { loadCaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import { currentShiftForTimezone } from "@/lib/caregiver/shift";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const CHANGE_TYPES: { value: string; label: string }[] = [
  { value: "vitals", label: "Vitals / measurements" },
  { value: "pain", label: "Pain" },
  { value: "respiratory", label: "Respiratory" },
  { value: "skin_wound", label: "Skin / wound" },
  { value: "mental_status", label: "Mental status / cognition" },
  { value: "gi", label: "GI / appetite" },
  { value: "urinary", label: "Urinary" },
  { value: "neurologic", label: "Neurologic" },
  { value: "other", label: "Other" },
];

const SEVERITIES: { value: string; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "moderate", label: "Moderate" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical — immediate attention" },
];

type ConditionRow = Pick<
  Database["public"]["Tables"]["condition_changes"]["Row"],
  | "id"
  | "reported_at"
  | "shift"
  | "change_type"
  | "description"
  | "severity"
  | "nurse_notified"
>;

export default function CaregiverResidentConditionChangePage() {
  const params = useParams<{ id: string }>();
  const residentId = params?.id ?? "";
  const supabase = useMemo(() => createClient(), []);

  const [configError, setConfigError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [ctx, setCtx] = useState<{
    facilityId: string;
    organizationId: string;
    timeZone: string;
  } | null>(null);
  const [homeHref, setHomeHref] = useState("/caregiver");
  const [residentLabel, setResidentLabel] = useState<string | null>(null);
  const [rows, setRows] = useState<ConditionRow[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const [changeType, setChangeType] = useState("other");
  const [severity, setSeverity] = useState("moderate");
  const [description, setDescription] = useState("");
  const [nurseNotified, setNurseNotified] = useState(false);

  const idOk = isValidFacilityIdForQuery(residentId);

  useEffect(() => {
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        setHomeHref(getDashboardRouteForRole(getAppRoleFromClaims(user)));
      }
    })();
  }, [supabase]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setConfigError(null);
    if (!idOk) {
      setLoading(false);
      return;
    }
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
      const c = resolved.ctx;
      setCtx(c);

      const resQ = await supabase
        .from("residents")
        .select("id, facility_id, first_name, last_name, preferred_name")
        .eq("id", residentId)
        .is("deleted_at", null)
        .maybeSingle();
      if (resQ.error) throw resQ.error;
      const resRow = resQ.data as
        | {
            id: string;
            facility_id: string;
            first_name: string;
            last_name: string;
            preferred_name: string | null;
          }
        | null;
      if (!resRow || resRow.facility_id !== c.facilityId) {
        setLoadError("This resident is not in your current facility scope.");
        setResidentLabel(null);
        setRows([]);
        setLoading(false);
        return;
      }
      const display =
        resRow.preferred_name?.trim() ||
        [resRow.first_name, resRow.last_name].filter(Boolean).join(" ").trim() ||
        "Resident";
      setResidentLabel(display);

      const cq = await supabase
        .from("condition_changes")
        .select("id, reported_at, shift, change_type, description, severity, nurse_notified")
        .eq("resident_id", residentId)
        .eq("facility_id", c.facilityId)
        .is("deleted_at", null)
        .order("reported_at", { ascending: false })
        .limit(12);
      if (cq.error) throw cq.error;
      setRows((cq.data ?? []) as ConditionRow[]);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load condition reports.");
      setResidentLabel(null);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, residentId, idOk]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitReport() {
    if (!ctx || !idOk || !description.trim()) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoadError("Session expired. Sign in again.");
      return;
    }
    setSubmitting(true);
    setLoadError(null);
    try {
      const shift = currentShiftForTimezone(ctx.timeZone);
      const nowIso = new Date().toISOString();
      const row: Database["public"]["Tables"]["condition_changes"]["Insert"] = {
        resident_id: residentId,
        facility_id: ctx.facilityId,
        organization_id: ctx.organizationId,
        shift,
        reported_by: user.id,
        reported_at: nowIso,
        change_type: changeType,
        description: description.trim(),
        severity,
        nurse_notified: nurseNotified,
        nurse_notified_at: nurseNotified ? nowIso : null,
        nurse_notified_by: nurseNotified ? user.id : null,
        physician_notified: false,
        family_notified: false,
        care_plan_review_triggered: false,
      };
      const ins = await supabase.from("condition_changes").insert(row);
      if (ins.error) throw ins.error;
      setDescription("");
      setNurseNotified(false);
      await load();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not submit condition report.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!idOk) {
    return (
      <div className="space-y-4">
        <Link
          href={homeHref}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1 text-zinc-400 hover:text-white")}
        >
          <ArrowLeft className="h-4 w-4" />
          Shift home
        </Link>
        <div className="rounded-lg border border-rose-800/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-100">
          Invalid resident identifier.
        </div>
      </div>
    );
  }

  if (configError) {
    return (
      <div className="rounded-lg border border-amber-800/60 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">{configError}</div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-zinc-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading…
      </div>
    );
  }

  if (loadError && !ctx) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-rose-800/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-100">{loadError}</div>
        <Link
          href={homeHref}
          className="inline-flex h-11 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 px-4 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
        >
          Back to shift home
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Link
        href={`/caregiver/resident/${residentId}`}
        className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1 text-zinc-400 hover:text-white")}
      >
        <ArrowLeft className="h-4 w-4" />
        Resident
      </Link>

      {loadError ? (
        <div className="rounded-lg border border-amber-800/60 bg-amber-950/30 px-4 py-2 text-xs text-amber-100">{loadError}</div>
      ) : null}

      <Card className="border-rose-900/40 bg-rose-950/15 text-zinc-100">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg font-display">
            <Stethoscope className="h-5 w-5 text-rose-300" />
            Change of condition
          </CardTitle>
          <CardDescription className="text-rose-200/70">
            {residentLabel ? (
              <>
                Report new or worsening symptoms for <span className="text-rose-100">{residentLabel}</span>. For emergencies,
                use your facility escalation protocol and nurse chain.
              </>
            ) : (
              "Structured report saved to the clinical record (RLS-scoped)."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {ctx && residentLabel ? (
            <div className="space-y-3 rounded-lg border border-rose-900/35 bg-black/25 p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs text-rose-200/80">Category</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-rose-900/50 bg-zinc-950 px-2 text-sm text-zinc-100"
                    value={changeType}
                    onChange={(e) => setChangeType(e.target.value)}
                  >
                    {CHANGE_TYPES.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-rose-200/80">Severity</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-rose-900/50 bg-zinc-950 px-2 text-sm text-zinc-100"
                    value={severity}
                    onChange={(e) => setSeverity(e.target.value)}
                  >
                    {SEVERITIES.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-rose-200/80">Description</Label>
                <textarea
                  rows={4}
                  required
                  placeholder="Objective findings, vitals if taken, what changed and when…"
                  className="w-full rounded-md border border-rose-900/50 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-rose-100/90">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-rose-800 bg-zinc-950"
                  checked={nurseNotified}
                  onChange={(e) => setNurseNotified(e.target.checked)}
                />
                Nurse has been notified (timestamps recorded)
              </label>
              <Button
                type="button"
                disabled={submitting || !description.trim()}
                className="h-10 w-full bg-rose-700 text-white hover:bg-rose-600 disabled:opacity-50"
                onClick={() => void submitReport()}
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Submit report
              </Button>
            </div>
          ) : null}

          <div className="space-y-2 border-t border-rose-900/30 pt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-rose-200/50">Recent reports</p>
            {rows.length === 0 ? (
              <p className="text-sm text-zinc-400">No condition change reports yet.</p>
            ) : (
              <ul className="space-y-2">
                {rows.map((row) => (
                  <li key={row.id} className="rounded-lg border border-rose-900/30 bg-black/20 p-3 text-sm">
                    <p className="font-medium text-rose-100">
                      {CHANGE_TYPES.find((c) => c.value === row.change_type)?.label ?? row.change_type}
                      <span className="font-normal text-zinc-500"> · </span>
                      <span className="capitalize text-zinc-300">{row.severity}</span>
                    </p>
                    <p className="mt-1 text-zinc-200">{row.description}</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {new Date(row.reported_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      · {row.shift}
                      {row.nurse_notified ? <span className="text-emerald-400"> · nurse notified</span> : null}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
