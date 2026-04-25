"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";

import {
  newAdmissionFormSchema,
  type NewAdmissionFormValues,
} from "@/lib/v2-forms";

import { V2FormField } from "./V2FormField";
import { V2FormShell } from "./V2FormShell";
import type { FacilityOption } from "./NewResidentForm";

export type ResidentOption = { id: string; label: string };

export function NewAdmissionForm({
  facilities,
  residents,
}: {
  facilities: FacilityOption[];
  residents: ResidentOption[];
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm<NewAdmissionFormValues>({
    resolver: zodResolver(newAdmissionFormSchema),
    mode: "onChange",
    defaultValues: {
      residentId: "",
      facilityId: facilities[0]?.id ?? "",
      targetMoveInDate: "",
      notes: "",
    },
  });

  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<{
    tone: "info" | "warning" | "success" | "danger";
    message: string;
  } | null>(null);

  const submitHandler = handleSubmit(async (values) => {
    setSubmitting(true);
    setBanner(null);
    try {
      const response = await fetch("/api/v2/forms/new-admission", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!response.ok) throw new Error(`Submit failed (${response.status})`);
      const json = (await response.json()) as { deferred?: boolean; message?: string };
      setBanner({
        tone: json.deferred ? "info" : "success",
        message: json.message ?? "Submitted.",
      });
    } catch (err) {
      setBanner({
        tone: "danger",
        message: err instanceof Error ? err.message : "Submit failed",
      });
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <V2FormShell
      formId="new-admission"
      title="New admission"
      subtitle="Open an admission case for an existing resident"
      steps={[
        { id: "case", label: "Case", state: "active" },
        { id: "billing", label: "Billing", state: "pending" },
        { id: "review", label: "Review", state: "pending" },
      ]}
      isSubmitting={submitting}
      isValid={isValid}
      onSubmit={() => {
        void submitHandler();
      }}
      cancelHref="/admin/admissions"
      submitLabel="Save case"
      banner={banner ?? undefined}
    >
      <V2FormField
        id="admission-resident"
        label="Resident"
        error={errors.residentId?.message}
      >
        <select
          id="admission-resident"
          {...register("residentId")}
          className="h-8 w-full rounded-sm border border-border bg-surface px-2 text-sm text-text-primary"
        >
          <option value="">Select resident…</option>
          {residents.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </V2FormField>
      <V2FormField
        id="admission-facility"
        label="Facility"
        error={errors.facilityId?.message}
      >
        <select
          id="admission-facility"
          {...register("facilityId")}
          className="h-8 w-full rounded-sm border border-border bg-surface px-2 text-sm text-text-primary"
        >
          <option value="">Select facility…</option>
          {facilities.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </V2FormField>
      <V2FormField
        id="admission-move-in"
        label="Target move-in"
        error={errors.targetMoveInDate?.message}
      >
        <input
          id="admission-move-in"
          type="date"
          {...register("targetMoveInDate")}
          className="h-8 w-full rounded-sm border border-border bg-surface px-2 text-sm text-text-primary"
        />
      </V2FormField>
      <V2FormField
        id="admission-notes"
        label="Notes"
        error={errors.notes?.message}
        className="md:col-span-2"
      >
        <textarea
          id="admission-notes"
          rows={4}
          {...register("notes")}
          className="w-full rounded-sm border border-border bg-surface px-2 py-1 text-sm text-text-primary"
        />
      </V2FormField>
    </V2FormShell>
  );
}
