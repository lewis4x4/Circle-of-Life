"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";

import {
  caregiverIncidentFormSchema,
  caregiverIncidentCategoryValues,
  caregiverIncidentSeverityValues,
  caregiverIncidentShiftValues,
  type CaregiverIncidentFormData,
} from "@/lib/validation/caregiver-incident";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const CATEGORY_LABELS: Record<(typeof caregiverIncidentCategoryValues)[number], string> = {
  fall_with_injury: "Fall with injury",
  fall_without_injury: "Fall without injury",
  fall_unwitnessed: "Fall (unwitnessed)",
  medication_error: "Medication error",
  medication_refusal: "Medication refusal",
  behavioral_resident_to_resident: "Behavioral — resident to resident",
  behavioral_resident_to_staff: "Behavioral — resident to staff",
  elopement: "Elopement",
  wandering: "Wandering",
  environmental_flood: "Environmental — flood / water",
  environmental_fire: "Environmental — fire / smoke",
  other: "Other",
};

const SEVERITY_LABELS: Record<(typeof caregiverIncidentSeverityValues)[number], string> = {
  level_1: "Level 1 — minor / no injury",
  level_2: "Level 2 — minor injury / repeat event",
  level_3: "Level 3 — moderate injury / med error",
  level_4: "Level 4 — major injury / regulatory trigger",
};

const SHIFT_LABELS: Record<(typeof caregiverIncidentShiftValues)[number], string> = {
  day: "Day",
  evening: "Evening",
  night: "Night",
  custom: "Custom / overlap",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type ResidentOption = { id: string; label: string };

const defaultFormValues = (): CaregiverIncidentFormData => ({
  residentId: "",
  category: "fall_without_injury",
  severity: "level_2",
  occurredAtLocal: toDatetimeLocalValue(new Date()),
  shift: "night",
  locationDescription: "",
  description: "",
  immediateActions: "",
  injuryOccurred: false,
});

function CaregiverIncidentDraftPageInner() {
  const searchParams = useSearchParams();
  const queryResidentId = searchParams.get("resident") ?? searchParams.get("residentId") ?? "";

  const supabase = useMemo(() => createClient(), []);
  const [configError, setConfigError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [facilityName, setFacilityName] = useState<string | null>(null);
  const [residents, setResidents] = useState<ResidentOption[]>([]);
  const [loadingContext, setLoadingContext] = useState(true);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittedNumber, setSubmittedNumber] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<CaregiverIncidentFormData>({
    resolver: zodResolver(caregiverIncidentFormSchema),
    defaultValues: defaultFormValues(),
  });

  const loadContext = useCallback(async () => {
    setLoadingContext(true);
    setLoadError(null);
    setConfigError(null);

    if (!isBrowserSupabaseConfigured()) {
      setConfigError("Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.");
      setLoadingContext(false);
      return;
    }

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) {
        setLoadError("You need to sign in to file an incident.");
        setLoadingContext(false);
        return;
      }

      const profileResult = await supabase
        .from("user_profiles" as never)
        .select("organization_id, app_role")
        .eq("id", user.id)
        .maybeSingle();
      const profile = profileResult.data as { organization_id: string; app_role: string } | null;
      if (profileResult.error) throw profileResult.error;
      if (!profile?.organization_id) {
        setLoadError("Your profile is missing an organization. Contact an administrator.");
        setLoadingContext(false);
        return;
      }

      let resolvedFacilityId: string | null = null;
      let resolvedOrgId: string = profile.organization_id;
      let resolvedFacilityName: string | null = null;

      if (profile.app_role === "owner" || profile.app_role === "org_admin") {
        const facResult = await supabase
          .from("facilities" as never)
          .select("id, name, organization_id")
          .eq("organization_id", profile.organization_id)
          .is("deleted_at", null)
          .order("name")
          .limit(1)
          .maybeSingle();
        const row = facResult.data as { id: string; name: string; organization_id: string } | null;
        if (facResult.error) throw facResult.error;
        if (row) {
          resolvedFacilityId = row.id;
          resolvedOrgId = row.organization_id;
          resolvedFacilityName = row.name;
        }
      } else {
        const accessResult = await supabase
          .from("user_facility_access" as never)
          .select("facility_id")
          .eq("user_id", user.id)
          .is("revoked_at", null)
          .limit(1)
          .maybeSingle();
        const access = accessResult.data as { facility_id: string } | null;
        if (accessResult.error) throw accessResult.error;
        if (access?.facility_id) {
          resolvedFacilityId = access.facility_id;
        }
        if (resolvedFacilityId) {
          const facResult = await supabase
            .from("facilities" as never)
            .select("id, name, organization_id")
            .eq("id", resolvedFacilityId)
            .is("deleted_at", null)
            .maybeSingle();
          const row = facResult.data as { id: string; name: string; organization_id: string } | null;
          if (facResult.error) throw facResult.error;
          if (row) {
            resolvedOrgId = row.organization_id;
            resolvedFacilityName = row.name;
          }
        }
      }

      if (!resolvedFacilityId) {
        setLoadError("No facility access is assigned to your account. Ask an administrator to grant facility access.");
        setLoadingContext(false);
        return;
      }

      setFacilityId(resolvedFacilityId);
      setOrganizationId(resolvedOrgId);
      setFacilityName(resolvedFacilityName);

      const resResult = await supabase
        .from("residents" as never)
        .select("id, first_name, last_name, preferred_name")
        .eq("facility_id", resolvedFacilityId)
        .is("deleted_at", null)
        .order("last_name")
        .limit(500);
      const rows = (resResult.data ?? []) as {
        id: string;
        first_name: string;
        last_name: string;
        preferred_name: string | null;
      }[];
      if (resResult.error) throw resResult.error;

      setResidents(
        rows.map((r) => ({
          id: r.id,
          label: [r.preferred_name || r.first_name, r.last_name].filter(Boolean).join(" "),
        })),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not load facility context.";
      setLoadError(msg);
    } finally {
      setLoadingContext(false);
    }
  }, [supabase]);

  useEffect(() => {
    void loadContext();
  }, [loadContext]);

  useEffect(() => {
    if (!queryResidentId || !UUID_RE.test(queryResidentId) || residents.length === 0) return;
    const match = residents.some((r) => r.id === queryResidentId);
    if (match) {
      form.setValue("residentId", queryResidentId);
    }
  }, [queryResidentId, residents, form]);

  async function onSubmit(values: CaregiverIncidentFormData) {
    setSubmitError(null);
    if (!facilityId || !organizationId) {
      setSubmitError("Facility context is not ready. Refresh and try again.");
      return;
    }

    setSubmitting(true);
    try {
      const numResult = await supabase.rpc("allocate_incident_number" as never, {
        p_facility_id: facilityId,
      } as never);
      const rpcData = numResult.data as unknown;
      if (numResult.error) throw numResult.error;
      if (typeof rpcData !== "string" || rpcData.length < 3) {
        throw new Error("Could not allocate incident number.");
      }

      const occurredAt = new Date(values.occurredAtLocal);
      if (Number.isNaN(occurredAt.getTime())) {
        throw new Error("Invalid date and time.");
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Session expired. Sign in again.");

      const insertPayload = {
        resident_id: values.residentId === "" ? null : values.residentId,
        facility_id: facilityId,
        organization_id: organizationId,
        incident_number: rpcData,
        category: values.category,
        severity: values.severity,
        status: "open" as const,
        occurred_at: occurredAt.toISOString(),
        shift: values.shift,
        location_description: values.locationDescription,
        location_type: null as string | null,
        description: values.description,
        immediate_actions: values.immediateActions,
        injury_occurred: values.injuryOccurred,
        reported_by: user.id,
        created_by: user.id,
      };

      const insResult = await supabase.from("incidents" as never).insert(insertPayload as never).select("incident_number").single();
      if (insResult.error) throw insResult.error;

      const row = insResult.data as { incident_number: string } | null;
      setSubmittedNumber(row?.incident_number ?? rpcData);
      form.reset(defaultFormValues());
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Submit failed.";
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (configError) {
    return (
      <div className="rounded-lg border border-amber-800/60 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">{configError}</div>
    );
  }

  if (loadingContext) {
    return (
      <div className="flex items-center justify-center py-16 text-zinc-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading facility…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-rose-800/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-100">{loadError}</div>
        <Link
          href="/caregiver"
          className="inline-flex h-11 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 px-4 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
        >
          Back to dashboard
        </Link>
      </div>
    );
  }

  if (submittedNumber) {
    return (
      <Card className="border-emerald-900/50 bg-emerald-950/20 text-zinc-100">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg font-display text-emerald-100">
            <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            Incident submitted
          </CardTitle>
          <CardDescription className="text-emerald-200/80">
            Report <span className="font-mono font-semibold text-emerald-100">{submittedNumber}</span> is on file. Nursing and administration can follow up in the operations console.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 sm:flex-row">
          <Link
            href="/caregiver"
            className="inline-flex h-11 items-center justify-center rounded-lg bg-emerald-700 px-4 text-sm font-medium text-white hover:bg-emerald-600"
          >
            Return to shift home
          </Link>
          <Button
            type="button"
            variant="outline"
            className="border-zinc-700 bg-zinc-900 text-zinc-200"
            onClick={() => {
              setSubmittedNumber(null);
              form.reset(defaultFormValues());
            }}
          >
            File another report
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-zinc-800 bg-gradient-to-br from-zinc-950 to-zinc-900 text-zinc-100">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-xl font-display">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Incident report
          </CardTitle>
          <CardDescription className="text-zinc-400">
            {facilityName ? (
              <>
                Filing for <span className="text-zinc-200">{facilityName}</span>. Be factual; you can add detail after submission in the admin console if needed.
              </>
            ) : (
              "File a structured incident for your assigned facility."
            )}
          </CardDescription>
        </CardHeader>
      </Card>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <Card className="border-zinc-800 bg-zinc-950/70 text-zinc-100">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">What happened</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="residentId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-zinc-300">Resident (optional)</FormLabel>
                    <FormControl>
                      <select
                        className="flex h-11 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100"
                        value={field.value ?? ""}
                        onChange={(e) => field.onChange(e.target.value)}
                      >
                        <option value="">Not resident-specific</option>
                        {residents.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </FormControl>
                    <FormMessage className="text-xs text-rose-300" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-zinc-300">Category</FormLabel>
                    <FormControl>
                      <select
                        className="flex h-11 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100"
                        value={field.value}
                        onChange={field.onChange}
                      >
                        {caregiverIncidentCategoryValues.map((v) => (
                          <option key={v} value={v}>
                            {CATEGORY_LABELS[v]}
                          </option>
                        ))}
                      </select>
                    </FormControl>
                    <FormMessage className="text-xs text-rose-300" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="severity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-zinc-300">Severity</FormLabel>
                    <FormControl>
                      <select
                        className="flex h-11 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100"
                        value={field.value}
                        onChange={field.onChange}
                      >
                        {caregiverIncidentSeverityValues.map((v) => (
                          <option key={v} value={v}>
                            {SEVERITY_LABELS[v]}
                          </option>
                        ))}
                      </select>
                    </FormControl>
                    <FormMessage className="text-xs text-rose-300" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="occurredAtLocal"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-zinc-300">Occurred at</FormLabel>
                    <FormControl>
                      <Input type="datetime-local" className="border-zinc-800 bg-zinc-900 text-zinc-100" {...field} />
                    </FormControl>
                    <FormMessage className="text-xs text-rose-300" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="shift"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-zinc-300">Shift</FormLabel>
                    <FormControl>
                      <select
                        className="flex h-11 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100"
                        value={field.value}
                        onChange={field.onChange}
                      >
                        {caregiverIncidentShiftValues.map((v) => (
                          <option key={v} value={v}>
                            {SHIFT_LABELS[v]}
                          </option>
                        ))}
                      </select>
                    </FormControl>
                    <FormMessage className="text-xs text-rose-300" />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-950/70 text-zinc-100">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Where &amp; narrative</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="locationDescription"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-zinc-300">Location</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. Room 114, east hall near nurses&apos; station"
                        className="border-zinc-800 bg-zinc-900 text-zinc-100"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage className="text-xs text-rose-300" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-zinc-300">Description</FormLabel>
                    <FormControl>
                      <textarea
                        rows={4}
                        className="flex w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500"
                        placeholder="Objective facts: what you saw, heard, or verified."
                        {...field}
                      />
                    </FormControl>
                    <FormMessage className="text-xs text-rose-300" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="immediateActions"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-zinc-300">Immediate actions</FormLabel>
                    <FormControl>
                      <textarea
                        rows={3}
                        className="flex w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500"
                        placeholder="First aid, supervision changes, notifications started, environment secured…"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage className="text-xs text-rose-300" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="injuryOccurred"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center gap-2 space-y-0">
                    <FormControl>
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-zinc-600 bg-zinc-900"
                        checked={field.value}
                        onChange={field.onChange}
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <Label className="text-zinc-300">Injury occurred</Label>
                    </div>
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {submitError ? (
            <div className="rounded-lg border border-rose-800/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-100">{submitError}</div>
          ) : null}

          <Button
            type="submit"
            disabled={submitting || !facilityId}
            className="h-12 w-full bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-60"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Submitting…
              </>
            ) : (
              "Submit incident"
            )}
          </Button>
        </form>
      </Form>
    </div>
  );
}

export default function CaregiverIncidentDraftPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-16 text-zinc-400">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading…
        </div>
      }
    >
      <CaregiverIncidentDraftPageInner />
    </Suspense>
  );
}
