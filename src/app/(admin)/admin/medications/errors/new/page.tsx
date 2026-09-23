"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { FacilityGateNotice } from "@/components/common/FacilityGate";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EntityCombobox, type EntityComboboxOption } from "@/components/ui/entity-combobox";
import { FacilityFormSelect } from "@/components/ui/facility-form-select";
import { FormLabel } from "@/components/ui/form-label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import {
  fetchActiveResidentsWithRooms,
  type ResidentWithRoom,
} from "@/lib/caregiver/facility-residents";
import {
  EMPTY_MEDICATION_ERROR_FORM,
  MEDICATION_ERROR_FACTOR_OPTIONS,
  MEDICATION_ERROR_SEVERITY_OPTIONS,
  MEDICATION_ERROR_SHIFT_OPTIONS,
  MEDICATION_ERROR_TYPE_OPTIONS,
  buildMedicationErrorInsert,
  missingMedicationErrorFields,
  type MedicationErrorFormState,
} from "@/lib/medications/medication-error-form";
import { formatLiveDataLoadError } from "@/lib/live-data-fallback";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

/** Upper bound on the picker census; one building is far below it. */
const RESIDENT_PICKER_LIMIT = 500;

export default function NewMedicationErrorPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { user, organizationId } = useHavenAuth();
  const { selectedFacilityId } = useFacilityStore();
  const [form, setForm] = useState<MedicationErrorFormState>(EMPTY_MEDICATION_ERROR_FORM);
  const [residents, setResidents] = useState<ResidentWithRoom[]>([]);
  const [residentsLoading, setResidentsLoading] = useState(false);
  const [residentsError, setResidentsError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const facilityReady = isValidFacilityIdForQuery(selectedFacilityId);

  const update = <K extends keyof MedicationErrorFormState>(key: K, value: MedicationErrorFormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    // A resident picked at another facility must never be filed here.
    setForm((prev) => ({ ...prev, residentId: "" }));
    setResidents([]);
    setResidentsError(null);
    if (!facilityReady || !selectedFacilityId) return;
    let cancelled = false;
    setResidentsLoading(true);
    fetchActiveResidentsWithRooms(supabase, selectedFacilityId, RESIDENT_PICKER_LIMIT)
      .then((rows) => {
        if (!cancelled) setResidents(rows);
      })
      .catch(() => {
        if (!cancelled) setResidentsError("Could not load residents for this facility. Reload to try again.");
      })
      .finally(() => {
        if (!cancelled) setResidentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, selectedFacilityId, facilityReady]);

  const residentOptions: EntityComboboxOption[] = useMemo(
    () =>
      residents.map((r) => ({
        id: r.id,
        label: r.displayName,
        meta: `Room ${r.roomLabel}`,
        keywords: `${r.displayName} ${r.roomLabel}`,
      })),
    [residents],
  );

  const missing = missingMedicationErrorFields(form);

  const toggleFactor = (f: string) =>
    update(
      "contributingFactors",
      form.contributingFactors.includes(f)
        ? form.contributingFactors.filter((x) => x !== f)
        : [...form.contributingFactors, f],
    );

  const submit = useCallback(async () => {
    setFormError(null);
    // The form only renders inside a facility scope (COL-651).
    if (!facilityReady || !selectedFacilityId) return;
    if (!user?.id || !organizationId) {
      setFormError("Could not resolve profile.");
      return;
    }
    const stillMissing = missingMedicationErrorFields(form);
    if (stillMissing.length > 0) {
      setFormError(`Complete the required fields: ${stillMissing.join(", ")}.`);
      return;
    }
    setSaving(true);
    try {
      const { error: insErr } = await supabase.from("medication_errors").insert(
        buildMedicationErrorInsert(form, {
          facilityId: selectedFacilityId,
          organizationId,
          userId: user.id,
        }),
      );
      if (insErr) throw insErr;
      router.push("/admin/medications/errors");
    } catch (e: unknown) {
      setFormError(formatLiveDataLoadError(e, "Could not save the report. Nothing was filed — try again."));
    } finally {
      setSaving(false);
    }
  }, [supabase, facilityReady, selectedFacilityId, user, organizationId, form, router]);

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <Link
        href="/admin/medications/errors"
        className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-1 px-0")}
      >
        <ArrowLeft className="h-4 w-4" />
        Medication errors
      </Link>

      {!facilityReady ? (
        <FacilityGateNotice
          title="Report medication error"
          reason="A medication error is filed against a resident in one building."
        />
      ) : (
      <Card>
        <CardHeader>
          <CardTitle className="">Report medication error</CardTitle>
          <CardDescription>Structured capture for quality improvement.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {formError ? (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          ) : null}

          <div>
            <EntityCombobox
              id="med-error-resident"
              label="Resident"
              required
              placeholder={residents.length === 0 && !residentsLoading ? "No residents to choose" : "Select…"}
              searchPlaceholder="Search by name or room…"
              options={residentOptions}
              value={form.residentId}
              onChange={(id) => update("residentId", id)}
              loading={residentsLoading}
              disabled={!facilityReady || residents.length === 0}
              data-testid="med-error-resident"
            />
            {residentsError ? <p className="mt-2 text-sm text-destructive">{residentsError}</p> : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FacilityFormSelect
              id="med-error-type"
              label="Error type *"
              placeholder="Select…"
              value={form.errorType}
              options={MEDICATION_ERROR_TYPE_OPTIONS}
              onValueChange={(v) => update("errorType", v)}
            />
            <FacilityFormSelect
              id="med-error-severity"
              label="Outcome *"
              placeholder="Select…"
              value={form.severity}
              options={MEDICATION_ERROR_SEVERITY_OPTIONS}
              onValueChange={(v) => update("severity", v)}
            />
          </div>

          <FacilityFormSelect
            id="med-error-shift"
            label="Shift *"
            placeholder="Select…"
            value={form.shift}
            options={MEDICATION_ERROR_SHIFT_OPTIONS}
            onValueChange={(v) => update("shift", v)}
          />

          <div className="space-y-2">
            <FormLabel htmlFor="med-error-description" required>
              What happened
            </FormLabel>
            <Textarea
              id="med-error-description"
              required
              value={form.description}
              onChange={(e) => update("description", e.target.value)}
              rows={4}
            />
          </div>

          <div className="space-y-2">
            <FormLabel htmlFor="med-error-immediate" required>
              Immediate actions
            </FormLabel>
            <Textarea
              id="med-error-immediate"
              required
              value={form.immediateActions}
              onChange={(e) => update("immediateActions", e.target.value)}
              rows={3}
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-[13px] font-semibold text-muted-foreground">Contributing factors</legend>
            <div className="flex flex-wrap gap-2">
              {MEDICATION_ERROR_FACTOR_OPTIONS.map((f) => (
                <label key={f.value} className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={form.contributingFactors.includes(f.value)}
                    onChange={() => toggleFactor(f.value)}
                  />
                  {f.label}
                </label>
              ))}
            </div>
          </fieldset>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.physicianNotified}
              onChange={(e) => update("physicianNotified", e.target.checked)}
            />
            Physician notified (if harm)
          </label>

          <button
            type="button"
            disabled={saving || !facilityReady || missing.length > 0}
            onClick={() => void submit()}
            className={cn(buttonVariants(), "w-full")}
          >
            {saving ? "Saving…" : "Submit report"}
          </button>
          {missing.length > 0 ? (
            <p className="text-xs text-muted-foreground">Still needed: {missing.join(", ")}.</p>
          ) : null}
        </CardContent>
      </Card>
      )}
    </div>
  );
}
