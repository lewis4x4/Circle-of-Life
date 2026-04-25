"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";

import {
  newResidentFormSchema,
  type NewResidentFormValues,
} from "@/lib/v2-forms";

import { V2FormField } from "./V2FormField";
import { V2FormShell } from "./V2FormShell";

export type FacilityOption = { id: string; label: string };

export function NewResidentForm({ facilities }: { facilities: FacilityOption[] }) {
  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm<NewResidentFormValues>({
    resolver: zodResolver(newResidentFormSchema),
    mode: "onChange",
    defaultValues: {
      firstName: "",
      lastName: "",
      facilityId: facilities[0]?.id ?? "",
      dateOfBirth: "",
      primaryDiagnosis: "",
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
      const response = await fetch("/api/v2/forms/new-resident", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!response.ok) throw new Error(`Submit failed (${response.status})`);
      const json = (await response.json()) as { deferred?: boolean; message?: string };
      setBanner({
        tone: json.deferred ? "info" : "success",
        message:
          json.message ?? "Submitted. Detail page will redirect once V1 wire-up lands.",
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
      formId="new-resident"
      title="New resident"
      subtitle="Admit a resident to a facility"
      steps={[
        { id: "id", label: "Identity", state: "active" },
        { id: "review", label: "Review", state: "pending" },
      ]}
      isSubmitting={submitting}
      isValid={isValid}
      onSubmit={() => {
        void submitHandler();
      }}
      cancelHref="/admin/residents"
      submitLabel="Save resident"
      banner={banner ?? undefined}
    >
      <V2FormField
        id="resident-first-name"
        label="First name"
        error={errors.firstName?.message}
      >
        <input
          id="resident-first-name"
          type="text"
          autoComplete="given-name"
          {...register("firstName")}
          className="h-8 w-full rounded-sm border border-border bg-surface px-2 text-sm text-text-primary"
        />
      </V2FormField>
      <V2FormField
        id="resident-last-name"
        label="Last name"
        error={errors.lastName?.message}
      >
        <input
          id="resident-last-name"
          type="text"
          autoComplete="family-name"
          {...register("lastName")}
          className="h-8 w-full rounded-sm border border-border bg-surface px-2 text-sm text-text-primary"
        />
      </V2FormField>
      <V2FormField
        id="resident-facility"
        label="Facility"
        error={errors.facilityId?.message}
      >
        <select
          id="resident-facility"
          {...register("facilityId")}
          className="h-8 w-full rounded-sm border border-border bg-surface px-2 text-sm text-text-primary"
        >
          <option value="">Select facility…</option>
          {facilities.map((facility) => (
            <option key={facility.id} value={facility.id}>
              {facility.label}
            </option>
          ))}
        </select>
      </V2FormField>
      <V2FormField
        id="resident-dob"
        label="Date of birth"
        error={errors.dateOfBirth?.message}
      >
        <input
          id="resident-dob"
          type="date"
          {...register("dateOfBirth")}
          className="h-8 w-full rounded-sm border border-border bg-surface px-2 text-sm text-text-primary"
        />
      </V2FormField>
      <V2FormField
        id="resident-diagnosis"
        label="Primary diagnosis"
        hint="Optional · use plain text for now"
        error={errors.primaryDiagnosis?.message}
        className="md:col-span-2"
      >
        <input
          id="resident-diagnosis"
          type="text"
          {...register("primaryDiagnosis")}
          className="h-8 w-full rounded-sm border border-border bg-surface px-2 text-sm text-text-primary"
        />
      </V2FormField>
      <V2FormField
        id="resident-notes"
        label="Admit notes"
        error={errors.notes?.message}
        className="md:col-span-2"
      >
        <textarea
          id="resident-notes"
          rows={4}
          {...register("notes")}
          className="w-full rounded-sm border border-border bg-surface px-2 py-1 text-sm text-text-primary"
        />
      </V2FormField>
    </V2FormShell>
  );
}
