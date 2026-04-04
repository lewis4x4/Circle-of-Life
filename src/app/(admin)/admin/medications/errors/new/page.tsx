"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

const ERROR_TYPES = [
  "wrong_medication",
  "wrong_dose",
  "wrong_time",
  "wrong_resident",
  "wrong_route",
  "omission",
  "unauthorized_medication",
  "documentation_error",
  "other",
] as const;

const SEVERITY = [
  "near_miss",
  "no_harm",
  "minor_harm",
  "moderate_harm",
  "severe_harm",
] as const;

const SHIFTS = ["day", "evening", "night", "custom"] as const;

const FACTORS = [
  "transcription",
  "communication",
  "distraction",
  "staffing",
  "similar_packaging",
  "similar_names",
  "workflow_interruption",
] as const;

export default function NewMedicationErrorPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { selectedFacilityId } = useFacilityStore();
  const [residentId, setResidentId] = useState("");
  const [errorType, setErrorType] = useState<string>("wrong_medication");
  const [severity, setSeverity] = useState<string>("near_miss");
  const [shift, setShift] = useState<string>("day");
  const [description, setDescription] = useState("");
  const [immediate, setImmediate] = useState("");
  const [factors, setFactors] = useState<string[]>([]);
  const [physicianNotified, setPhysicianNotified] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getUser();
      setUserId(data.user?.id ?? null);
      if (!data.user) return;
      const p = await supabase
        .from("user_profiles")
        .select("organization_id")
        .eq("id", data.user.id)
        .maybeSingle();
      if (p.data?.organization_id) setOrgId(p.data.organization_id);
    })();
  }, [supabase]);

  const toggleFactor = (f: string) => {
    setFactors((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));
  };

  const submit = useCallback(async () => {
    setFormError(null);
    if (!isValidFacilityIdForQuery(selectedFacilityId)) {
      setFormError("Select a facility in the header.");
      return;
    }
    if (!userId || !orgId) {
      setFormError("Could not resolve profile.");
      return;
    }
    if (!residentId.trim() || !description.trim() || !immediate.trim()) {
      setFormError("Resident, description, and immediate actions are required.");
      return;
    }
    setSaving(true);
    try {
      const { error: insErr } = await supabase.from("medication_errors").insert({
        resident_id: residentId.trim(),
        facility_id: selectedFacilityId,
        organization_id: orgId,
        error_type: errorType,
        severity,
        shift: shift as "day" | "evening" | "night" | "custom",
        discovered_by: userId,
        description: description.trim(),
        immediate_actions: immediate.trim(),
        contributing_factors: factors.length ? factors : null,
        physician_notified: physicianNotified,
        physician_notified_at: physicianNotified ? new Date().toISOString() : null,
      });
      if (insErr) throw insErr;
      router.push("/admin/medications/errors");
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [
    supabase,
    selectedFacilityId,
    userId,
    orgId,
    residentId,
    errorType,
    severity,
    shift,
    description,
    immediate,
    factors,
    physicianNotified,
    router,
  ]);

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <Link
        href="/admin/medications/errors"
        className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-1 px-0")}
      >
        <ArrowLeft className="h-4 w-4" />
        Medication errors
      </Link>

      <Card>
        <CardHeader>
          <CardTitle className="font-display">Report medication error</CardTitle>
          <CardDescription>Structured capture for quality improvement.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {formError ? <p className="text-sm text-red-600 dark:text-red-400">{formError}</p> : null}

          <div className="space-y-2">
            <Label htmlFor="resident_id">Resident ID (UUID)</Label>
            <Input
              id="resident_id"
              value={residentId}
              onChange={(e) => setResidentId(e.target.value)}
              className="font-mono text-sm"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Type</Label>
              <select
                value={errorType}
                onChange={(e) => setErrorType(e.target.value)}
                className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm dark:border-slate-800 dark:bg-slate-950"
              >
                {ERROR_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Severity</Label>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
                className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm dark:border-slate-800 dark:bg-slate-950"
              >
                {SEVERITY.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Shift</Label>
            <select
              value={shift}
              onChange={(e) => setShift(e.target.value)}
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm dark:border-slate-800 dark:bg-slate-950"
            >
              {SHIFTS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="desc">What happened</Label>
            <textarea
              id="desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="flex min-h-[96px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="imm">Immediate actions</Label>
            <textarea
              id="imm"
              value={immediate}
              onChange={(e) => setImmediate(e.target.value)}
              rows={3}
              className="flex min-h-[72px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
            />
          </div>

          <div className="space-y-2">
            <Label>Contributing factors</Label>
            <div className="flex flex-wrap gap-2">
              {FACTORS.map((f) => (
                <label key={f} className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={factors.includes(f)}
                    onChange={() => toggleFactor(f)}
                  />
                  {f.replace(/_/g, " ")}
                </label>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={physicianNotified}
              onChange={(e) => setPhysicianNotified(e.target.checked)}
            />
            Physician notified (if harm)
          </label>

          <button
            type="button"
            disabled={saving}
            onClick={() => void submit()}
            className={cn(buttonVariants(), "w-full")}
          >
            {saving ? "Saving…" : "Submit report"}
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
