"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useHavenAuth } from "@/contexts/haven-auth-context";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { FacilityGateNotice } from "@/components/common/FacilityGate";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DateInput } from "@/components/ui/date-input";
import { EntityCombobox, type EntityComboboxOption } from "@/components/ui/entity-combobox";
import { FacilityFormSelect } from "@/components/ui/facility-form-select";
import { FormLabel } from "@/components/ui/form-label";
import {
  EMPTY_STAFF_ILLNESS_FORM,
  STAFF_ILLNESS_SYMPTOM_OPTIONS,
  STAFF_ILLNESS_TYPE_OPTIONS,
  buildStaffIllnessInsert,
  staffIllnessFormProblems,
  type StaffIllnessFormState,
} from "@/lib/admin/infection-control/staff-illness-form";
import { formatStaffIllnessStaffLabel } from "@/lib/admin/infection-control/staff-illness-display-copy";
import { todayFacilityDateIso } from "@/lib/facility-wall-clock";
import { formatLiveDataLoadError } from "@/lib/live-data-fallback";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

const STAFF_PICKER_LIMIT = 500;

type StaffRow = { id: string; first_name: string | null; last_name: string | null; employment_status: string };

export default function NewStaffIllnessPage() {
  const router = useRouter();
  const { user, organizationId } = useHavenAuth();
  const { selectedFacilityId } = useFacilityStore();
  const supabase = useMemo(() => createClient(), []);

  const [form, setForm] = useState<StaffIllnessFormState>(EMPTY_STAFF_ILLNESS_FORM);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const facilityReady = isValidFacilityIdForQuery(selectedFacilityId);

  const update = <K extends keyof StaffIllnessFormState>(key: K, value: StaffIllnessFormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    // Staff picked at another facility must never be filed here.
    setForm((prev) => ({ ...prev, staffId: "" }));
    setStaff([]);
    setStaffError(null);
    if (!facilityReady || !selectedFacilityId) return;
    let cancelled = false;
    setStaffLoading(true);
    void (async () => {
      const { data, error: staffErr } = await supabase
        .from("staff")
        .select("id, first_name, last_name, employment_status")
        .eq("facility_id", selectedFacilityId)
        .in("employment_status", ["active", "on_leave"])
        .is("deleted_at", null)
        .order("last_name")
        .limit(STAFF_PICKER_LIMIT);
      if (cancelled) return;
      if (staffErr) {
        setStaffError(formatLiveDataLoadError(staffErr, "Could not load staff for this facility. Reload to try again."));
      } else {
        setStaff((data ?? []) as StaffRow[]);
      }
      setStaffLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, selectedFacilityId, facilityReady]);

  const staffOptions: EntityComboboxOption[] = useMemo(
    () =>
      staff.map((s) => {
        const name = formatStaffIllnessStaffLabel(s);
        return {
          id: s.id,
          label: name,
          meta: s.employment_status === "on_leave" ? "On leave" : undefined,
          keywords: name,
        };
      }),
    [staff],
  );

  const problems = staffIllnessFormProblems(form);

  const toggleSymptom = (value: string) =>
    update(
      "symptoms",
      form.symptoms.includes(value) ? form.symptoms.filter((s) => s !== value) : [...form.symptoms, value],
    );

  const submit = useCallback(async () => {
    setError(null);
    // The form only renders inside a facility scope (COL-651).
    if (!facilityReady || !selectedFacilityId) return;
    if (!user?.id || !organizationId) {
      setError("Could not resolve your profile. Sign in again.");
      return;
    }
    const blocking = staffIllnessFormProblems(form);
    if (blocking.length > 0) {
      setError(`${blocking.join(". ")}.`);
      return;
    }
    setSubmitting(true);
    try {
      const { error: insErr } = await supabase.from("staff_illness_records").insert(
        buildStaffIllnessInsert(form, {
          facilityId: selectedFacilityId,
          organizationId,
          userId: user.id,
          reportedDate: todayFacilityDateIso(),
        }),
      );
      if (insErr) throw insErr;
      router.push("/admin/infection-control/staff-illness");
    } catch (e) {
      setError(formatLiveDataLoadError(e, "Could not save the illness record. Nothing was filed — try again."));
    } finally {
      setSubmitting(false);
    }
  }, [facilityReady, selectedFacilityId, user, organizationId, form, supabase, router]);

  if (!facilityReady) {
    return (
      <div className="mx-auto max-w-lg space-y-6">
        <Link
          href="/admin/infection-control/staff-illness"
          className={cn(buttonVariants({ variant: "link", size: "sm" }), "h-auto p-0 text-xs")}
        >
          ← Staff illness
        </Link>
        <FacilityGateNotice
          title="Log staff illness"
          reason="Staff illness is logged against one building's staff and outbreak watch."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <Link
          href="/admin/infection-control/staff-illness"
          className={cn(buttonVariants({ variant: "link", size: "sm" }), "h-auto p-0 text-xs")}
        >
          ← Staff illness
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Log staff illness</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Absence</CardTitle>
          <CardDescription>
            Records the illness and absence. Return-to-work clearance is recorded separately once the staff member is
            cleared.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <div>
            <EntityCombobox
              id="staff-illness-staff"
              label="Staff member"
              required
              placeholder={staff.length === 0 && !staffLoading ? "No staff to choose" : "Select…"}
              searchPlaceholder="Search by name…"
              options={staffOptions}
              value={form.staffId}
              onChange={(id) => update("staffId", id)}
              loading={staffLoading}
              disabled={staff.length === 0}
            />
            {staffError ? <p className="mt-2 text-sm text-destructive">{staffError}</p> : null}
          </div>

          <FacilityFormSelect
            id="staff-illness-type"
            label="Illness type *"
            placeholder="Select…"
            value={form.illnessType}
            options={STAFF_ILLNESS_TYPE_OPTIONS}
            onValueChange={(v) => update("illnessType", v)}
          />

          <fieldset className="space-y-2">
            <legend className="text-[13px] font-semibold text-muted-foreground">Symptoms</legend>
            <div className="flex flex-wrap gap-3">
              {STAFF_ILLNESS_SYMPTOM_OPTIONS.map((s) => (
                <label key={s.value} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={form.symptoms.includes(s.value)}
                    onChange={() => toggleSymptom(s.value)}
                  />
                  {s.label}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <FormLabel htmlFor="staff-illness-absent-from" required>
                First day absent
              </FormLabel>
              <DateInput
                id="staff-illness-absent-from"
                required
                value={form.absentFrom}
                onValueChange={(v) => update("absentFrom", v)}
                emptyHint={null}
              />
            </div>
            <div className="space-y-2">
              <FormLabel htmlFor="staff-illness-absent-to">Expected return</FormLabel>
              <DateInput
                id="staff-illness-absent-to"
                value={form.absentTo}
                onValueChange={(v) => update("absentTo", v)}
                emptyHint="Leave empty if not known yet"
              />
            </div>
          </div>

          <Button
            type="button"
            className="w-full"
            disabled={submitting || problems.length > 0}
            onClick={() => void submit()}
          >
            {submitting ? "Saving…" : "Log illness"}
          </Button>
          {problems.length > 0 ? (
            <p className="text-xs text-muted-foreground">Still needed: {problems.join("; ")}.</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
