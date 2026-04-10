"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, CheckCircle2, ChevronDown, Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";

import {
  caregiverIncidentFormSchema,
  caregiverIncidentCategoryValues,
  caregiverIncidentSeverityValues,
  caregiverIncidentShiftValues,
  type CaregiverIncidentFormData,
} from "@/lib/validation/caregiver-incident";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import { UUID_STRING_RE } from "@/lib/supabase/env";

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
  shift: "day",
  locationDescription: "",
  description: "",
  immediateActions: "",
  injuryOccurred: false,
});

function AdminIncidentFormInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryResidentId = searchParams.get("resident") ?? searchParams.get("residentId") ?? "";
  const { selectedFacilityId } = useFacilityStore();

  const supabase = useMemo(() => createClient(), []);
  const [configError, setConfigError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
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
      setConfigError("Supabase is not configured.");
      setLoadingContext(false);
      return;
    }

    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) { setLoadError("Sign in to file an incident."); setLoadingContext(false); return; }

      const profileResult = await supabase
        .from("user_profiles" as never)
        .select("organization_id, app_role")
        .eq("id", user.id)
        .maybeSingle();
      const profile = profileResult.data as { organization_id: string; app_role: string } | null;
      if (profileResult.error) throw profileResult.error;
      if (!profile?.organization_id) { setLoadError("Profile missing organization."); setLoadingContext(false); return; }

      // Use selected facility from header if available, otherwise pick first
      let resolvedFacilityId: string | null = selectedFacilityId;
      let resolvedOrgId = profile.organization_id;

      if (!resolvedFacilityId) {
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
        if (row) { resolvedFacilityId = row.id; resolvedOrgId = row.organization_id; }
      }

      if (!resolvedFacilityId) { setLoadError("No facility found."); setLoadingContext(false); return; }

      setFacilityId(resolvedFacilityId);
      setOrganizationId(resolvedOrgId);

      const resResult = await supabase
        .from("residents" as never)
        .select("id, first_name, last_name, preferred_name")
        .eq("facility_id", resolvedFacilityId)
        .is("deleted_at", null)
        .order("last_name")
        .limit(500);
      const rows = (resResult.data ?? []) as { id: string; first_name: string; last_name: string; preferred_name: string | null }[];
      if (resResult.error) throw resResult.error;

      setResidents(rows.map((r) => ({ id: r.id, label: [r.preferred_name || r.first_name, r.last_name].filter(Boolean).join(" ") })));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load context.");
    } finally {
      setLoadingContext(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => { void loadContext(); }, [loadContext]);

  useEffect(() => {
    if (!queryResidentId || !UUID_STRING_RE.test(queryResidentId) || residents.length === 0) return;
    if (residents.some((r) => r.id === queryResidentId)) form.setValue("residentId", queryResidentId);
  }, [queryResidentId, residents, form]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = form.getValues();
    setSubmitError(null);
    if (!facilityId || !organizationId) { setSubmitError("Facility context not ready."); return; }

    setSubmitting(true);
    try {
      const numResult = await supabase.rpc("allocate_incident_number", { p_facility_id: facilityId });
      const rpcData = numResult.data;
      if (numResult.error) throw numResult.error;
      if (typeof rpcData !== "string" || rpcData.length < 3) throw new Error("Could not allocate incident number.");

      const occurredAt = new Date(values.occurredAtLocal);
      if (Number.isNaN(occurredAt.getTime())) throw new Error("Invalid date and time.");

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Session expired.");

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
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Submit failed.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loadingContext) {
    return (
      <div className="flex h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (configError || loadError) {
    return (
      <div className="flex h-[40vh] items-center justify-center">
        <div className="text-center max-w-md">
          <AlertTriangle className="w-10 h-10 text-rose-500 mx-auto mb-4" />
          <p className="text-slate-600 dark:text-zinc-400 mb-4">{configError ?? loadError}</p>
          <button onClick={() => void loadContext()} className="px-6 py-3 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700">Retry</button>
        </div>
      </div>
    );
  }

  if (submittedNumber) {
    return (
      <div className="max-w-lg mx-auto mt-16">
        <div className="glass-panel rounded-[2rem] p-8 md:p-12 text-center flex flex-col items-center border border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-950/20 shadow-sm">
          <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mb-6 border border-emerald-400/50">
            <CheckCircle2 className="w-10 h-10 text-emerald-500" />
          </div>
          <h2 className="text-3xl font-display font-light tracking-tight text-slate-900 dark:text-white mb-2">Incident Logged</h2>
          <p className="text-slate-600 dark:text-zinc-400 mb-8 max-w-md leading-relaxed">
            Report <span className="text-emerald-600 dark:text-emerald-400 font-mono font-bold tracking-wider">{submittedNumber}</span> has been filed and is in the incident queue.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 w-full justify-center">
            <Link href="/admin/incidents" className="h-14 px-8 rounded-2xl flex items-center justify-center font-bold tracking-wide bg-emerald-600 text-white hover:bg-emerald-700 transition-all shadow-lg">
              VIEW IN QUEUE
            </Link>
            <button
              type="button"
              className="h-14 px-8 rounded-2xl flex items-center justify-center font-bold tracking-wide border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/10 transition-all"
              onClick={() => { setSubmittedNumber(null); form.reset(defaultFormValues()); }}
            >
              FILE ANOTHER
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[900px] mx-auto pb-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-6 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-rose-100/50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-[10px] font-bold uppercase tracking-widest text-rose-800 dark:text-rose-300 mb-2">
            <AlertTriangle className="w-3.5 h-3.5" /> Incident Report
          </div>
          <h1 className="text-4xl md:text-5xl font-display font-light tracking-tight text-slate-900 dark:text-white">
            Report Incident
          </h1>
          <p className="text-slate-600 dark:text-zinc-400 font-medium tracking-wide mt-2">
            Complete all sections with factual, objective information.
          </p>
        </div>
        <Link href="/admin/incidents" className="text-sm font-medium text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white transition-colors shrink-0">
          Cancel
        </Link>
      </div>

      <form onSubmit={onSubmit} className="space-y-6">
        {/* Primary Classification */}
        <div className="glass-panel rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-white/60 dark:bg-white/[0.02] backdrop-blur-3xl p-6 lg:p-8 shadow-sm">
          <h3 className="text-sm font-bold uppercase tracking-widest text-rose-500 mb-6 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-rose-500"></span> Primary Classification
          </h3>

          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 pl-1">Resident <span className="font-normal opacity-70">(Optional)</span></label>
              <div className="relative">
                <select className="w-full h-14 appearance-none rounded-[1.2rem] border border-slate-200 dark:border-white/10 bg-white dark:bg-black/40 px-5 text-[15px] font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500/50" {...form.register("residentId")}>
                  <option value="">Not resident-specific</option>
                  {residents.map((r) => (<option key={r.id} value={r.id}>{r.label}</option>))}
                </select>
                <ChevronDown className="absolute right-5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 pl-1">Category</label>
                <div className="relative">
                  <select className="w-full h-14 appearance-none rounded-[1.2rem] border border-slate-200 dark:border-white/10 bg-white dark:bg-black/40 px-5 text-[15px] font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500/50" {...form.register("category")}>
                    {caregiverIncidentCategoryValues.map((v) => (<option key={v} value={v}>{CATEGORY_LABELS[v]}</option>))}
                  </select>
                  <ChevronDown className="absolute right-5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 pl-1">Severity</label>
                <div className="relative">
                  <select className="w-full h-14 appearance-none rounded-[1.2rem] border border-slate-200 dark:border-white/10 bg-white dark:bg-black/40 px-5 text-[15px] font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500/50" {...form.register("severity")}>
                    {caregiverIncidentSeverityValues.map((v) => (<option key={v} value={v}>{SEVERITY_LABELS[v]}</option>))}
                  </select>
                  <ChevronDown className="absolute right-5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 pl-1">Date & Time</label>
                <input type="datetime-local" className="w-full h-14 appearance-none rounded-[1.2rem] border border-slate-200 dark:border-white/10 bg-white dark:bg-black/40 px-5 text-[15px] font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500/50" {...form.register("occurredAtLocal")} />
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 pl-1">Shift</label>
                <div className="relative">
                  <select className="w-full h-14 appearance-none rounded-[1.2rem] border border-slate-200 dark:border-white/10 bg-white dark:bg-black/40 px-5 text-[15px] font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500/50" {...form.register("shift")}>
                    {caregiverIncidentShiftValues.map((v) => (<option key={v} value={v}>{SHIFT_LABELS[v]}</option>))}
                  </select>
                  <ChevronDown className="absolute right-5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Details */}
        <div className="glass-panel rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-white/60 dark:bg-white/[0.02] backdrop-blur-3xl p-6 lg:p-8 shadow-sm">
          <h3 className="text-sm font-bold uppercase tracking-widest text-rose-500 mb-6 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-rose-500"></span> Details & Location
          </h3>

          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 pl-1">Specific Location</label>
              <input type="text" placeholder="e.g. Room 114, east hall near nurses' station" className="w-full h-14 appearance-none rounded-[1.2rem] border border-slate-200 dark:border-white/10 bg-white dark:bg-black/40 px-5 text-[15px] font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500/50 placeholder:text-slate-400 dark:placeholder:text-zinc-600" {...form.register("locationDescription")} />
            </div>
            <div className="space-y-2">
              <label className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 pl-1">Factual Description</label>
              <textarea rows={4} placeholder="Objective facts: what you saw, heard, or verified." className="w-full resize-none appearance-none rounded-[1.2rem] border border-slate-200 dark:border-white/10 bg-white dark:bg-black/40 p-5 text-[15px] leading-relaxed text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500/50 placeholder:text-slate-400 dark:placeholder:text-zinc-600" {...form.register("description")} />
            </div>
            <div className="space-y-2">
              <label className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 pl-1">Immediate Actions Taken</label>
              <textarea rows={3} placeholder="First aid given, supervision adjusted, area secured..." className="w-full resize-none appearance-none rounded-[1.2rem] border border-slate-200 dark:border-white/10 bg-white dark:bg-black/40 p-5 text-[15px] leading-relaxed text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500/50 placeholder:text-slate-400 dark:placeholder:text-zinc-600" {...form.register("immediateActions")} />
            </div>
            <div className="pt-2">
              <label className="flex items-center gap-4 cursor-pointer w-fit border border-slate-200 dark:border-white/5 bg-white dark:bg-white/[0.02] hover:bg-slate-50 dark:hover:bg-white/[0.05] transition-colors pr-6 pl-4 py-4 rounded-2xl">
                <div className="relative w-6 h-6 rounded-md border-2 border-slate-300 dark:border-zinc-500 bg-white dark:bg-black/40 flex items-center justify-center shrink-0">
                  <input type="checkbox" className="absolute inset-0 opacity-0 cursor-pointer peer" {...form.register("injuryOccurred")} />
                  <CheckCircle2 className="w-5 h-5 text-rose-500 opacity-0 peer-checked:opacity-100 transition-opacity" />
                </div>
                <span className="text-sm font-bold uppercase tracking-wider text-slate-700 dark:text-zinc-300">Visible Injury Occurred</span>
              </label>
            </div>
          </div>
        </div>

        {submitError && (
          <div className="rounded-xl border border-rose-200 dark:border-rose-800/60 bg-rose-50 dark:bg-rose-950/30 px-6 py-4 text-sm font-medium text-rose-700 dark:text-rose-200">
            {submitError}
          </div>
        )}

        <div className="pt-4">
          <button type="submit" disabled={submitting || !facilityId} className="w-full h-16 rounded-[1.5rem] flex items-center justify-center font-bold tracking-widest uppercase transition-all shadow-lg bg-gradient-to-r from-rose-600 to-rose-500 text-white hover:from-rose-500 hover:to-rose-400 disabled:opacity-50 disabled:grayscale text-lg">
            {submitting ? (<><Loader2 className="mr-3 h-6 w-6 animate-spin" />Submitting Report...</>) : "Submit Official Record"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function AdminIncidentNewPage() {
  return (
    <Suspense fallback={<div className="flex h-[40vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-indigo-500" /></div>}>
      <AdminIncidentFormInner />
    </Suspense>
  );
}
