"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
    if (!queryResidentId || !UUID_STRING_RE.test(queryResidentId) || residents.length === 0) return;
    const match = residents.some((r) => r.id === queryResidentId);
    if (match) {
      form.setValue("residentId", queryResidentId);
    }
  }, [queryResidentId, residents, form]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = form.getValues();
    setSubmitError(null);
    if (!facilityId || !organizationId) {
      setSubmitError("Facility context is not ready. Refresh and try again.");
      return;
    }

    setSubmitting(true);
    try {
      const numResult = await supabase.rpc("allocate_incident_number", {
        p_facility_id: facilityId,
      });
      const rpcData = numResult.data;
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
      <div className="rounded-xl border border-rose-800/60 bg-rose-950/40 px-6 py-4 text-sm text-rose-100 backdrop-blur-md">{configError}</div>
    );
  }

  if (loadingContext) {
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center gap-4 text-zinc-400">
        <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
        <p className="text-sm font-medium tracking-wide uppercase">Securing form context…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-4 max-w-md mx-auto mt-12">
        <div className="rounded-[1.5rem] border border-rose-800/60 bg-rose-950/30 px-6 py-5 text-sm text-rose-100 text-center">
          <AlertTriangle className="w-8 h-8 mx-auto mb-3 text-rose-400" />
          <p>{loadError}</p>
        </div>
        <Link
          href="/caregiver"
          className="flex h-14 items-center justify-center rounded-2xl bg-white/10 border border-white/20 text-sm font-semibold text-white hover:bg-white/20 transition-colors tap-responsive"
        >
          Back to shift home
        </Link>
      </div>
    );
  }

  if (submittedNumber) {
    return (
      <div className="max-w-[700px] mx-auto mt-12">
        <div className="glass-panel p-8 md:p-12 text-center flex flex-col items-center border border-emerald-500/30 bg-emerald-950/20 shadow-[inset_0_0_40px_rgba(16,185,129,0.05)] rounded-[2rem]">
          <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mb-6 border border-emerald-400/50">
             <CheckCircle2 className="w-10 h-10 text-emerald-400" />
          </div>
          <h2 className="text-3xl font-display font-light text-white mb-2 tracking-tight">Incident Logged</h2>
          <p className="text-zinc-400 mb-8 max-w-md leading-relaxed text-[15px]">
             Report <span className="text-emerald-300 font-mono font-bold tracking-wider">{submittedNumber}</span> is securely on file. Nursing and administration can follow up in the operations console.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 w-full justify-center">
             <Link
               href="/caregiver"
               className="h-14 px-8 rounded-2xl flex items-center justify-center font-bold tracking-wide transition-all shadow-lg bg-emerald-500 text-black hover:bg-emerald-400 tap-responsive"
             >
               RETURN TO SHIFT
             </Link>
             <button
               type="button"
               className="h-14 px-8 rounded-2xl flex items-center justify-center font-bold tracking-wide transition-all border border-white/10 bg-black/40 text-zinc-300 hover:bg-white/10 hover:text-white tap-responsive shadow-inner"
               onClick={() => {
                 setSubmittedNumber(null);
                 form.reset(defaultFormValues());
               }}
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
      
      {/* ─── HEADER ──────────────────────────────────────────────────────────── */}
      <div className="text-center md:text-left mb-6 md:mb-12">
        <div className="md:hidden w-16 h-16 mx-auto bg-amber-500/20 rounded-full flex items-center justify-center mb-4 border border-amber-500/30">
           <AlertTriangle className="w-8 h-8 text-amber-400" />
        </div>
        <h1 className="text-3xl md:text-5xl font-display font-light text-white tracking-tight flex items-center gap-4">
           <AlertTriangle className="hidden md:block w-10 h-10 text-amber-500" />
           Report Incident
        </h1>
        <p className="text-zinc-400 mt-3 max-w-lg text-[15px] leading-relaxed">
          {facilityName ? (
            <>Filing for <span className="text-white font-medium">{facilityName}</span>. Be factual; you can add detail after submission in the admin console if needed.</>
          ) : (
            "File a structured incident for your assigned facility."
          )}
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-6">
        
        {/* SECTION 1: WHAT HAPPENED */}
        <div className="glass-panel rounded-[2rem] p-6 md:p-10">
          <h3 className="text-sm font-semibold tracking-widest uppercase text-amber-400 mb-8 flex items-center gap-2">
             <span className="w-2 h-2 rounded-full bg-amber-400"></span> Primary Classification
          </h3>
          
          <div className="space-y-6">
            <div className="space-y-2">
               <label className="text-xs font-bold uppercase tracking-widest text-zinc-400 pl-1">Resident <span className="text-zinc-600 font-normal opacity-70">(Optional)</span></label>
               <div className="relative">
                 <select
                   className="w-full h-14 appearance-none rounded-[1.2rem] border border-white/10 bg-black/40 px-5 text-[15px] font-medium text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50 shadow-inner tap-responsive"
                   {...form.register("residentId")}
                 >
                   <option value="">Not resident-specific</option>
                   {residents.map((r) => (
                     <option key={r.id} value={r.id}>{r.label}</option>
                   ))}
                 </select>
                 <ChevronDown className="absolute right-5 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500 pointer-events-none" />
               </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
               <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-zinc-400 pl-1">Category</label>
                  <div className="relative">
                    <select
                      className="w-full h-14 appearance-none rounded-[1.2rem] border border-white/10 bg-black/40 px-5 text-[15px] font-medium text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50 shadow-inner tap-responsive"
                      {...form.register("category")}
                    >
                      {caregiverIncidentCategoryValues.map((v) => (
                        <option key={v} value={v}>{CATEGORY_LABELS[v]}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-5 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500 pointer-events-none" />
                  </div>
               </div>

               <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-zinc-400 pl-1">Severity</label>
                  <div className="relative">
                    <select
                      className="w-full h-14 appearance-none rounded-[1.2rem] border border-white/10 bg-black/40 px-5 text-[15px] font-medium text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50 shadow-inner tap-responsive"
                      {...form.register("severity")}
                    >
                      {caregiverIncidentSeverityValues.map((v) => (
                        <option key={v} value={v}>{SEVERITY_LABELS[v]}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-5 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500 pointer-events-none" />
                  </div>
               </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
               <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-zinc-400 pl-1">Date & Time</label>
                  <input 
                     type="datetime-local" 
                     className="w-full h-14 appearance-none rounded-[1.2rem] border border-white/10 bg-black/40 px-5 text-[15px] font-medium text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50 shadow-inner tap-responsive"
                     {...form.register("occurredAtLocal")}
                  />
               </div>

               <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-zinc-400 pl-1">Shift</label>
                  <div className="relative">
                    <select
                      className="w-full h-14 appearance-none rounded-[1.2rem] border border-white/10 bg-black/40 px-5 text-[15px] font-medium text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50 shadow-inner tap-responsive"
                      {...form.register("shift")}
                    >
                      {caregiverIncidentShiftValues.map((v) => (
                        <option key={v} value={v}>{SHIFT_LABELS[v]}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-5 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500 pointer-events-none" />
                  </div>
               </div>
            </div>
          </div>
        </div>

        {/* SECTION 2: WHERE & NARRATIVE */}
        <div className="glass-panel rounded-[2rem] p-6 md:p-10">
          <h3 className="text-sm font-semibold tracking-widest uppercase text-amber-400 mb-8 flex items-center gap-2">
             <span className="w-2 h-2 rounded-full bg-amber-400"></span> Details & Location
          </h3>
          
          <div className="space-y-6">
            <div className="space-y-2">
               <label className="text-xs font-bold uppercase tracking-widest text-zinc-400 pl-1">Specific Location</label>
               <input
                  type="text"
                  placeholder="e.g. Room 114, east hall near nurses' station"
                  className="w-full h-14 appearance-none rounded-[1.2rem] border border-white/10 bg-black/40 px-5 text-[15px] font-medium text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50 shadow-inner placeholder:text-zinc-600 tap-responsive"
                  {...form.register("locationDescription")}
               />
            </div>

            <div className="space-y-2">
               <label className="text-xs font-bold uppercase tracking-widest text-zinc-400 pl-1">Factual Description</label>
               <textarea
                  rows={4}
                  placeholder="Objective facts: what you saw, heard, or verified."
                  className="w-full resize-none appearance-none rounded-[1.2rem] border border-white/10 bg-black/40 p-5 text-[15px] leading-relaxed text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50 shadow-inner placeholder:text-zinc-600 tap-responsive"
                  {...form.register("description")}
               />
            </div>

            <div className="space-y-2">
               <label className="text-xs font-bold uppercase tracking-widest text-zinc-400 pl-1">Immediate Actions Taken</label>
               <textarea
                  rows={3}
                  placeholder="First aid given, supervision adjusted, area secured..."
                  className="w-full resize-none appearance-none rounded-[1.2rem] border border-white/10 bg-black/40 p-5 text-[15px] leading-relaxed text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50 shadow-inner placeholder:text-zinc-600 tap-responsive"
                  {...form.register("immediateActions")}
               />
            </div>
            
            <div className="pt-2">
               <label className="flex items-center gap-4 cursor-pointer group tap-responsive w-fit border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] transition-colors pr-6 pl-4 py-4 rounded-2xl">
                 <div className="relative w-6 h-6 rounded-md border-2 border-zinc-500 bg-black/40 flex items-center justify-center shrink-0">
                    <input
                      type="checkbox"
                      className="absolute inset-0 opacity-0 cursor-pointer peer"
                      {...form.register("injuryOccurred")}
                    />
                    <CheckCircle2 className="w-5 h-5 text-amber-500 opacity-0 peer-checked:opacity-100 transition-opacity" />
                 </div>
                 <span className="text-sm font-bold uppercase tracking-wider text-zinc-300 group-hover:text-white transition-colors">Visible Injury Occurred</span>
               </label>
            </div>
          </div>
        </div>

        {submitError && (
          <div className="rounded-xl border border-rose-800/60 bg-rose-950/30 px-6 py-4 text-sm font-medium text-rose-200">
             {submitError}
          </div>
        )}

        {/* SUBMIT BUTTON */}
        <div className="pt-4">
          <button
            type="submit"
            disabled={submitting || !facilityId}
            className="w-full h-16 rounded-[1.5rem] flex items-center justify-center font-bold tracking-widest uppercase transition-all shadow-[0_4px_30px_rgba(245,158,11,0.2)] bg-gradient-to-r from-amber-600 to-amber-500 text-black hover:from-amber-500 hover:to-amber-400 disabled:opacity-50 disabled:grayscale tap-responsive text-lg"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-3 h-6 w-6 animate-spin" />
                Submitting Report…
              </>
            ) : (
              "Submit Official Record"
            )}
          </button>
        </div>

      </form>
    </div>
  );
}

export default function CaregiverIncidentDraftPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-[50vh] flex-col items-center justify-center gap-4 text-zinc-400">
          <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
          <p className="text-sm font-medium tracking-wide uppercase">Securing incident system…</p>
        </div>
      }
    >
      <CaregiverIncidentDraftPageInner />
    </Suspense>
  );
}
