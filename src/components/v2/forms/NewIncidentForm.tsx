"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import {
  newIncidentFormSchema,
  type NewIncidentFormValues,
} from "@/lib/v2-forms";

import type { FacilityOption } from "./NewResidentForm";
import type { ResidentOption } from "./NewAdmissionForm";
import { V2FormField } from "./V2FormField";
import { V2FormShell } from "./V2FormShell";

export function NewIncidentForm({
  facilities,
  residents,
}: {
  facilities: FacilityOption[];
  residents: ResidentOption[];
}) {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm<NewIncidentFormValues>({
    resolver: zodResolver(newIncidentFormSchema),
    mode: "onChange",
    defaultValues: {
      facilityId: facilities[0]?.id ?? "",
      residentId: "",
      category: "",
      severity: "low",
      occurredAt: "",
      locationDescription: "",
      description: "",
      injuryOccurred: false,
      ahcaReportable: false,
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
      const response = await fetch("/api/v2/forms/new-incident", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const json = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        redirectTo?: string;
        error?: string;
      };
      if (!response.ok || !json.ok) {
        throw new Error(json.error ?? `Submit failed (${response.status})`);
      }
      setBanner({ tone: "success", message: "Incident reported. Redirecting…" });
      if (json.redirectTo) router.push(json.redirectTo);
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
      formId="new-incident"
      title="Report an incident"
      subtitle="Capture facts at the time of report; clinical follow-up happens on the detail page"
      steps={[
        { id: "facts", label: "Facts", state: "active" },
        { id: "notify", label: "Notify", state: "pending" },
        { id: "review", label: "Review", state: "pending" },
      ]}
      isSubmitting={submitting}
      isValid={isValid}
      onSubmit={() => {
        void submitHandler();
      }}
      cancelHref="/admin/incidents"
      submitLabel="Report incident"
      banner={banner ?? undefined}
    >
      <V2FormField
        id="incident-facility"
        label="Facility"
        error={errors.facilityId?.message}
      >
        <select
          id="incident-facility"
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
        id="incident-resident"
        label="Resident (optional)"
        error={errors.residentId?.message}
      >
        <select
          id="incident-resident"
          {...register("residentId")}
          className="h-8 w-full rounded-sm border border-border bg-surface px-2 text-sm text-text-primary"
        >
          <option value="">Not resident-specific</option>
          {residents.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </V2FormField>
      <V2FormField
        id="incident-category"
        label="Category"
        hint="e.g. fall · elopement · medication · skin · other"
        error={errors.category?.message}
      >
        <input
          id="incident-category"
          type="text"
          {...register("category")}
          className="h-8 w-full rounded-sm border border-border bg-surface px-2 text-sm text-text-primary"
        />
      </V2FormField>
      <V2FormField
        id="incident-severity"
        label="Severity"
        error={errors.severity?.message}
      >
        <select
          id="incident-severity"
          {...register("severity")}
          className="h-8 w-full rounded-sm border border-border bg-surface px-2 text-sm text-text-primary"
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>
      </V2FormField>
      <V2FormField
        id="incident-occurred"
        label="Occurred at"
        error={errors.occurredAt?.message}
      >
        <input
          id="incident-occurred"
          type="datetime-local"
          {...register("occurredAt")}
          className="h-8 w-full rounded-sm border border-border bg-surface px-2 text-sm text-text-primary"
        />
      </V2FormField>
      <V2FormField
        id="incident-location"
        label="Location description"
        error={errors.locationDescription?.message}
      >
        <input
          id="incident-location"
          type="text"
          {...register("locationDescription")}
          className="h-8 w-full rounded-sm border border-border bg-surface px-2 text-sm text-text-primary"
        />
      </V2FormField>
      <V2FormField
        id="incident-description"
        label="What happened"
        error={errors.description?.message}
        className="md:col-span-2"
      >
        <textarea
          id="incident-description"
          rows={5}
          {...register("description")}
          className="w-full rounded-sm border border-border bg-surface px-2 py-1 text-sm text-text-primary"
        />
      </V2FormField>
      <V2FormField id="incident-injury" label="Injury">
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            id="incident-injury"
            {...register("injuryOccurred")}
            className="h-3 w-3 accent-brand-primary"
          />
          Injury occurred
        </label>
      </V2FormField>
      <V2FormField id="incident-ahca" label="AHCA flag">
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            id="incident-ahca"
            {...register("ahcaReportable")}
            className="h-3 w-3 accent-brand-primary"
          />
          AHCA reportable
        </label>
      </V2FormField>
    </V2FormShell>
  );
}
