"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { differenceInYears, format, parseISO } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { Loader2 } from "lucide-react";

import { QuietDatePicker } from "@/components/ui/quiet-date-picker";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import {
  OVERRIDE_BED_UNASSIGNED as BED_UNASSIGNED,
  OVERRIDE_FORM_PICK as PICK,
  validateOverrideAdmission,
} from "@/lib/residents/override-admission-validate";
import { cn } from "@/lib/utils";

const GENDERS = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "non_binary", label: "Non-binary" },
  { value: "other", label: "Other" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
] as const;

const STATUSES = [
  { value: "pending_admission", label: "Pending admission" },
  { value: "active", label: "Active (admitted)" },
  { value: "hospital_hold", label: "Hold" },
  { value: "inquiry", label: "Inquiry" },
  { value: "discharged", label: "Discharged" },
] as const;

const ACUITY = [
  { value: "level_1", label: "Level 1" },
  { value: "level_2", label: "Level 2" },
  { value: "level_3", label: "Level 3" },
] as const;

type QueryError = { message: string };

export type OverrideAdmissionFormProps = {
  /** Cancel + back targets (e.g. clinical shell aliases). */
  cancelHref?: string;
  admissionsHref?: string;
};

function RequiredStar() {
  return (
    <>
      <span className="text-destructive" aria-hidden>
        {" "}
        *
      </span>
      <span className="sr-only">(required)</span>
    </>
  );
}

function label(id: string, text: React.ReactNode, required?: boolean) {
  return (
    <Label htmlFor={id} className="text-[13px] font-medium leading-none">
      {text}
      {required ? <RequiredStar /> : null}
    </Label>
  );
}

export function OverrideAdmissionForm({ cancelHref = "/admin/residents", admissionsHref = "/admin/admissions/new" }: OverrideAdmissionFormProps) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { user } = useHavenAuth();
  const { selectedFacilityId } = useFacilityStore();
  const availableFacilities = useFacilityStore((s) => s.availableFacilities);

  const facilityName = useMemo(() => {
    if (!selectedFacilityId) return "Selected facility";
    return availableFacilities.find((f) => f.id === selectedFacilityId)?.name ?? "Selected facility";
  }, [availableFacilities, selectedFacilityId]);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [preferredName, setPreferredName] = useState("");
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState<string>(PICK);
  const [status, setStatus] = useState<string>(PICK);
  const [acuity, setAcuity] = useState<string>(PICK);
  const [admissionDate, setAdmissionDate] = useState("");
  const admissionTouchedRef = useRef(false);
  const prevStatus = useRef<string>(PICK);

  const [bedId, setBedId] = useState<string>(BED_UNASSIGNED);
  const [beds, setBeds] = useState<{ id: string; bed_label: string }[]>([]);
  const [loadingBeds, setLoadingBeds] = useState(false);

  const [overrideReason, setOverrideReason] = useState("");
  const [fullIntakePending, setFullIntakePending] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [previewOpen, setPreviewOpen] = useState(false);

  const isActive = status === "active";

  const loadBeds = useCallback(async () => {
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setBeds([]);
      return;
    }
    setLoadingBeds(true);
    const { data } = await supabase
      .from("beds")
      .select("id, bed_label")
      .eq("facility_id", selectedFacilityId)
      .is("deleted_at", null)
      .in("status", ["available", "hold"])
      .order("bed_label");
    setBeds((data ?? []) as { id: string; bed_label: string }[]);
    setLoadingBeds(false);
  }, [selectedFacilityId, supabase]);

  useEffect(() => {
    void loadBeds();
  }, [loadBeds]);

  useEffect(() => {
    if (!isActive) {
      setBedId(BED_UNASSIGNED);
    }
  }, [isActive]);

  useEffect(() => {
    const prev = prevStatus.current;
    if (status === "active") {
      if (prev !== "active" && !admissionTouchedRef.current) {
        setAdmissionDate(format(new Date(), "yyyy-MM-dd"));
      }
    } else if (prev === "active") {
      setAdmissionDate("");
      admissionTouchedRef.current = false;
    }
    prevStatus.current = status;
  }, [status]);

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

  function validate(): Record<string, string> {
    return validateOverrideAdmission({
      firstName,
      lastName,
      preferredName,
      dob,
      gender,
      status,
      acuity,
      admissionDate,
      isActive,
      bedId,
      overrideReason,
    });
  }

  function requestPreview() {
    setError(null);
    const v = validate();
    setFieldErrors(v);
    if (Object.keys(v).length > 0) return;
    setPreviewOpen(true);
  }

  async function confirmCreate() {
    setSubmitting(true);
    setError(null);
    try {
      if (!isValidFacilityIdForQuery(selectedFacilityId)) {
        setError("Select a facility in the header before adding a resident.");
        return;
      }
      const orgId = await loadFacilityOrg();
      if (!orgId) {
        setError("Could not resolve organization for this facility.");
        return;
      }
      if (!user?.id) {
        setError("You must be signed in.");
        return;
      }

      const payload: Record<string, unknown> = {
        facility_id: selectedFacilityId,
        organization_id: orgId,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        preferred_name: preferredName.trim() || null,
        date_of_birth: dob.trim(),
        gender,
        status,
        acuity_level: acuity,
        admission_date: admissionDate.trim() || null,
        bed_id: isActive && bedId !== BED_UNASSIGNED ? bedId : null,
        hospice_status: "none",
        override_reason: overrideReason.trim(),
        override_full_intake_pending: fullIntakePending,
        created_by: user.id,
        updated_by: user.id,
      };

      const ins = (await supabase
        .from("residents" as never)
        .insert(payload as never)
        .select("id")
        .single()) as {
        data: { id: string } | null;
        error: QueryError | null;
      };

      if (ins.error) throw new Error(ins.error.message);
      const id = ins.data?.id;
      if (!id) throw new Error("Insert did not return an id.");

      setPreviewOpen(false);
      router.push(`/admin/residents/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create resident.");
    } finally {
      setSubmitting(false);
    }
  }

  const facilityReady = isValidFacilityIdForQuery(selectedFacilityId);

  const previewAge =
    dob.trim() && !Number.isNaN(Date.parse(`${dob}T12:00:00`))
      ? differenceInYears(new Date(), parseISO(`${dob}T12:00:00`))
      : null;
  const genderLabel = GENDERS.find((g) => g.value === gender)?.label ?? gender;
  const statusLabel = STATUSES.find((s) => s.value === status)?.label ?? status;
  const acuityLabel = ACUITY.find((a) => a.value === acuity)?.label ?? acuity;
  const bedLabel =
    bedId === BED_UNASSIGNED ? "Unassigned" : (beds.find((b) => b.id === bedId)?.bed_label ?? "—");

  return (
    <div className="space-y-8">
      <div>
        <Link href={cancelHref} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}>
          ← Residents
        </Link>
      </div>

      <div
        className="flex min-h-8 items-center gap-2 border-l-4 border-amber-500 bg-amber-50/90 px-3 py-2 text-[13px] text-amber-950 dark:bg-amber-950/40 dark:text-amber-50"
        role="note"
      >
        <span aria-hidden>⚠</span>
        <span className="min-w-0 flex-1 truncate">
          This form bypasses standard intake. Use only for emergency admissions or historical data migration.{" "}
          <Link href={admissionsHref} className="font-medium text-amber-900 underline underline-offset-2 dark:text-amber-200">
            Go to Admissions
          </Link>
        </span>
      </div>

      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">Override admission</h1>
            <span className="rounded-full border border-amber-600/50 bg-amber-100/80 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-950 dark:bg-amber-900/50 dark:text-amber-100">
              Override
            </span>
          </div>
          <p className="text-sm font-medium leading-relaxed text-muted-foreground">
            Use for emergency admissions or historical data migration. Standard intake should use the Admissions flow.
          </p>
        </div>
      </div>

      {!facilityReady && (
        <p className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200" role="status">
          Choose a facility from the header selector to enable this form.
        </p>
      )}

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="space-y-8">
        {/* Identity */}
        <Card className="border-border shadow-none">
          <CardHeader className="space-y-2 pb-2">
            <CardTitle className="text-lg">Identity</CardTitle>
            <CardDescription>Legal identity and demographics.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pt-2">
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-2">
                {label("ov-first", <>First name</>, true)}
                <Input
                  id="ov-first"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  autoComplete="given-name"
                  aria-invalid={!!fieldErrors.firstName}
                  aria-describedby={fieldErrors.firstName ? "ov-first-err" : undefined}
                />
                {fieldErrors.firstName ? (
                  <p id="ov-first-err" className="text-[12px] text-destructive" role="alert">
                    {fieldErrors.firstName}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                {label("ov-last", <>Last name</>, true)}
                <Input
                  id="ov-last"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  autoComplete="family-name"
                  aria-invalid={!!fieldErrors.lastName}
                  aria-describedby={fieldErrors.lastName ? "ov-last-err" : undefined}
                />
                {fieldErrors.lastName ? (
                  <p id="ov-last-err" className="text-[12px] text-destructive" role="alert">
                    {fieldErrors.lastName}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                {label("ov-preferred", "Preferred name (optional)")}
                <Input
                  id="ov-preferred"
                  value={preferredName}
                  maxLength={60}
                  onChange={(e) => setPreferredName(e.target.value)}
                  placeholder="Preferred first name or nickname"
                  aria-invalid={!!fieldErrors.preferredName}
                  aria-describedby={fieldErrors.preferredName ? "ov-preferred-err" : undefined}
                />
                {fieldErrors.preferredName ? (
                  <p id="ov-preferred-err" className="text-[12px] text-destructive" role="alert">
                    {fieldErrors.preferredName}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-2">
                {label("ov-dob", <>Date of birth</>, true)}
                <QuietDatePicker
                  id="ov-dob"
                  mode="dob"
                  value={dob}
                  onValueChange={(v) => {
                    setDob(v);
                  }}
                  disabled={!facilityReady}
                  aria-invalid={!!fieldErrors.dob}
                  aria-describedby={fieldErrors.dob ? "ov-dob-err ov-dob-hint" : "ov-dob-hint"}
                />
                <p id="ov-dob-hint" className="text-[12px] text-muted-foreground">
                  Resident&apos;s date of birth, not today&apos;s date.
                </p>
                {fieldErrors.dob ? (
                  <p id="ov-dob-err" className="text-[12px] text-destructive" role="alert">
                    {fieldErrors.dob}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                {label("ov-gender", <>Gender</>, true)}
                <Select
                  value={gender === PICK ? undefined : gender}
                  onValueChange={(v) => setGender(v)}
                  disabled={!facilityReady}
                  required
                >
                  <SelectTrigger id="ov-gender" aria-invalid={!!fieldErrors.gender} aria-describedby={fieldErrors.gender ? "ov-gender-err" : undefined}>
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent>
                    {GENDERS.map((g) => (
                      <SelectItem key={g.value} value={g.value}>
                        {g.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fieldErrors.gender ? (
                  <p id="ov-gender-err" className="text-[12px] text-destructive" role="alert">
                    {fieldErrors.gender}
                  </p>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Placement */}
        <Card className="border-border shadow-none">
          <CardHeader className="space-y-2 pb-2">
            <CardTitle className="text-lg">Placement</CardTitle>
            <CardDescription>Status, acuity, dates, and physical bed assignment.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pt-2">
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-2">
                {label("ov-status", <>Residency status</>, true)}
                <Select value={status === PICK ? undefined : status} onValueChange={setStatus} disabled={!facilityReady}>
                  <SelectTrigger id="ov-status" aria-invalid={!!fieldErrors.status} aria-describedby={fieldErrors.status ? "ov-status-err" : undefined}>
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fieldErrors.status ? (
                  <p id="ov-status-err" className="text-[12px] text-destructive" role="alert">
                    {fieldErrors.status}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                {label("ov-acuity", <>Acuity (initial)</>, true)}
                <Select value={acuity === PICK ? undefined : acuity} onValueChange={setAcuity} disabled={!facilityReady}>
                  <SelectTrigger id="ov-acuity" aria-invalid={!!fieldErrors.acuity} aria-describedby={fieldErrors.acuity ? "ov-acuity-err" : undefined}>
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent>
                    {ACUITY.map((a) => (
                      <SelectItem key={a.value} value={a.value}>
                        {a.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fieldErrors.acuity ? (
                  <p id="ov-acuity-err" className="text-[12px] text-destructive" role="alert">
                    {fieldErrors.acuity}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-2">
                {label("ov-adm", <>Admission date</>, true)}
                <QuietDatePicker
                  id="ov-adm"
                  mode="admission"
                  value={admissionDate}
                  onValueChange={(v) => {
                    setAdmissionDate(v);
                    admissionTouchedRef.current = true;
                  }}
                  initialVisibleMonthIso={formatInTimeZone(new Date(), "America/New_York", "yyyy-MM-dd")}
                  disabled={!facilityReady}
                  aria-invalid={!!fieldErrors.admissionDate}
                  aria-describedby={fieldErrors.admissionDate ? "ov-adm-err ov-adm-hint" : "ov-adm-hint"}
                />
                <p id="ov-adm-hint" className="text-[12px] text-muted-foreground">
                  Use the actual admission date — for migrated records, enter the historical date.
                </p>
                {fieldErrors.admissionDate ? (
                  <p id="ov-adm-err" className="text-[12px] text-destructive" role="alert">
                    {fieldErrors.admissionDate}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                {label(
                  "ov-bed",
                  <>
                    Bed assignment
                    {isActive ? <RequiredStar /> : <span className="font-normal text-muted-foreground"> (optional)</span>}
                  </>,
                )}
                <Select
                  value={bedId === BED_UNASSIGNED && isActive ? undefined : bedId}
                  onValueChange={setBedId}
                  disabled={!facilityReady || loadingBeds}
                >
                  <SelectTrigger id="ov-bed" aria-invalid={!!fieldErrors.bedId} aria-describedby={fieldErrors.bedId ? "ov-bed-err ov-bed-h" : "ov-bed-h"}>
                    <SelectValue placeholder={isActive ? "Select a bed…" : "Unassigned"} />
                  </SelectTrigger>
                  <SelectContent>
                    {!isActive ? <SelectItem value={BED_UNASSIGNED}>Unassigned</SelectItem> : null}
                    {beds.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.bed_label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p id="ov-bed-h" className="text-[12px] text-muted-foreground">
                  {isActive
                    ? "Required for active admissions. You can reassign later."
                    : "Optional while resident is not active (admitted)."}
                </p>
                {fieldErrors.bedId ? (
                  <p id="ov-bed-err" className="text-[12px] text-destructive" role="alert">
                    {fieldErrors.bedId}
                  </p>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Override */}
        <Card className="border-border shadow-none">
          <CardHeader className="space-y-2 pb-2">
            <CardTitle className="text-lg">Override justification</CardTitle>
            <CardDescription>Required audit signal when bypassing standard intake.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pt-2">
            <div className="space-y-2">
              {label("ov-reason", <>Reason for override</>, true)}
              <Textarea
                id="ov-reason"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                minLength={50}
                maxLength={500}
                rows={5}
                className="min-h-[8rem] resize-y text-[13px]"
                style={{ resize: "vertical" }}
                placeholder="Explain why this resident is being created outside the Admissions flow."
                aria-invalid={!!fieldErrors.overrideReason}
                aria-describedby={fieldErrors.overrideReason ? "ov-reason-err ov-reason-h" : "ov-reason-h"}
              />
              <p id="ov-reason-h" className="text-[12px] text-muted-foreground">
                Explain why this resident is being created outside the Admissions flow.
              </p>
              {fieldErrors.overrideReason ? (
                <p id="ov-reason-err" className="text-[12px] text-destructive" role="alert">
                  {fieldErrors.overrideReason}
                </p>
              ) : null}
            </div>
            <label className="flex cursor-pointer items-start gap-2 text-[13px]">
              <input
                type="checkbox"
                className="mt-1 size-4 accent-primary"
                checked={fullIntakePending}
                onChange={(e) => setFullIntakePending(e.target.checked)}
              />
              <span>Full intake will be completed within 24 hours</span>
            </label>
          </CardContent>
        </Card>
      </div>

      <p className="text-[13px] leading-relaxed text-muted-foreground">
        This action will be logged with your user ID, timestamp, facility, and reason.
      </p>

      <div className="flex flex-col items-end gap-3 border-t border-border pt-6">
        <div className="flex w-full max-w-3xl justify-end gap-3">
          <Link href={cancelHref} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-10")}>
            Cancel
          </Link>
          <Button
            type="button"
            variant="outline"
            disabled={submitting || !facilityReady}
            onClick={requestPreview}
            className="h-10 min-w-[200px] border-amber-700/40 bg-amber-100/90 text-amber-950 hover:bg-amber-200/90 dark:border-amber-600 dark:bg-amber-950/50 dark:text-amber-100 dark:hover:bg-amber-900/60"
          >
            Create resident (override)
          </Button>
        </div>
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Confirm resident creation</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-[13px] text-foreground">
                <p>
                  Create{" "}
                  <strong>
                    {firstName.trim()} {lastName.trim()}
                  </strong>
                  {previewAge != null ? (
                    <>
                      {" "}
                      ({previewAge} yr, {genderLabel})
                    </>
                  ) : null}
                  , {statusLabel} in <strong>{facilityName}</strong> at {acuityLabel}, admission date{" "}
                  <strong>{admissionDate ? format(parseISO(`${admissionDate}T12:00:00`), "MMMM d, yyyy") : "—"}</strong>
                  , bed <strong>{bedLabel}</strong>.
                </p>
                <p className="text-muted-foreground">
                  <span className="font-medium text-foreground">Reason:</span> {overrideReason.trim()}
                </p>
                <p className="text-muted-foreground">This action will be logged.</p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setPreviewOpen(false)} disabled={submitting}>
              Back to form
            </Button>
            <Button
              type="button"
              className="border-amber-700/40 bg-amber-600 text-white hover:bg-amber-700"
              disabled={submitting}
              onClick={() => void confirmCreate()}
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                  Creating…
                </>
              ) : (
                "Confirm and create"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
