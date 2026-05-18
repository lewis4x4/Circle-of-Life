"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { addDays, format, parseISO } from "date-fns";
import { ChevronLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/design-system/components/PageHeader";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { DateInput } from "@/components/ui/date-input";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

const ORIGIN_QUERY = "origin";

type AdmissionOrigin = "inquiry" | "lead" | "direct";

const OPTIONAL_LEAD_NONE = "__none__";

const GENDERS = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "other", label: "Other" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
] as const;

const INTAKE_PROGRAM_OPTIONS = [
  { value: "long_term", label: "Long-term" },
  { value: "short_term_respite", label: "Short-term respite" },
  { value: "memory_care_transition", label: "Memory care transition" },
  { value: "other", label: "Other" },
] as const;

const SYNTHETIC_SOURCES = [
  { key: "direct_admit", label: "Direct admit" },
  { key: "transfer", label: "Transfer" },
  { key: "hospital_discharge", label: "Hospital discharge" },
] as const;

function normalizeOrigin(raw: string | null): AdmissionOrigin {
  if (raw === "lead" || raw === "direct") return raw;
  return "inquiry";
}

function RequiredMark() {
  return (
    <>
      <span className="text-destructive" aria-hidden>
        {" "}
        *
      </span>
      <span className="sr-only"> (required)</span>
    </>
  );
}

type ResidentOption = {
  id: string;
  first_name: string;
  last_name: string;
  status: string;
  date_of_birth: string | null;
  created_at: string;
};

type LeadOption = {
  id: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  date_of_birth: string | null;
  inquiry_date: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  status: string;
  referral_source_id: string | null;
};

type BedOption = { id: string; bed_label: string };

type ReferralSourceOpt = { id: string; name: string };

function formatIsoDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    return format(parseISO(iso.length > 10 ? iso : `${iso}T12:00:00`), "MMM d, yyyy");
  } catch {
    return iso.slice(0, 10);
  }
}

function residentComboLabel(r: ResidentOption): string {
  const dob = formatIsoDate(r.date_of_birth) ?? "DOB pending";
  const inquiry = formatIsoDate(r.created_at.split("T")[0]) ?? "";
  return `${r.last_name}, ${r.first_name} · DOB ${dob}${inquiry ? ` · Inquiry ${inquiry}` : ""}`;
}

function leadComboLabel(l: LeadOption): string {
  const dob = formatIsoDate(l.date_of_birth) ?? "DOB pending";
  const inq = formatIsoDate(l.inquiry_date) ?? "";
  return `${l.last_name}, ${l.first_name} · DOB ${dob}${inq ? ` · Lead ${inq}` : ""}`;
}

function AdmissionsNewInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const selectedFacilityId = useFacilityStore((s) => s.selectedFacilityId);
  const availableFacilities = useFacilityStore((s) => s.availableFacilities);

  const preselectedLeadId = searchParams.get("lead")?.trim() ?? "";

  const [origin, setOrigin] = useState<AdmissionOrigin>(() =>
    preselectedLeadId ? "lead" : normalizeOrigin(searchParams.get(ORIGIN_QUERY)),
  );
  const [residentId, setResidentId] = useState("");
  const [referralLeadId, setReferralLeadId] = useState(preselectedLeadId);
  const [bedId, setBedId] = useState("");
  const [targetMoveIn, setTargetMoveIn] = useState(() => format(addDays(new Date(), 7), "yyyy-MM-dd"));
  const [notes, setNotes] = useState("");
  const [intakeProgramType, setIntakeProgramType] = useState<string>("");

  const [directFirstName, setDirectFirstName] = useState("");
  const [directLastName, setDirectLastName] = useState("");
  const [directDob, setDirectDob] = useState("");
  const [directAdmissionSource, setDirectAdmissionSource] = useState("");

  const [residentOpen, setResidentOpen] = useState(false);
  const [leadOpen, setLeadOpen] = useState(false);
  const [bedOpen, setBedOpen] = useState(false);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [modalFirstName, setModalFirstName] = useState("");
  const [modalLastName, setModalLastName] = useState("");
  const [modalDob, setModalDob] = useState("");
  const [modalGender, setModalGender] = useState<string>("prefer_not_to_say");
  const [creatingResident, setCreatingResident] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const [loadingRefs, setLoadingRefs] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [residents, setResidents] = useState<ResidentOption[]>([]);
  const [leads, setLeads] = useState<LeadOption[]>([]);
  const [beds, setBeds] = useState<BedOption[]>([]);
  const [referralSources, setReferralSources] = useState<ReferralSourceOpt[]>([]);

  const [leadPrefilled, setLeadPrefilled] = useState(false);
  const [existingAdmissionCaseId, setExistingAdmissionCaseId] = useState<string | null>(null);
  const [existingResidentAdmissionCaseId, setExistingResidentAdmissionCaseId] = useState<string | null>(null);

  const facilityName = useMemo(() => {
    if (!selectedFacilityId) return null;
    return availableFacilities.find((f) => f.id === selectedFacilityId)?.name ?? null;
  }, [availableFacilities, selectedFacilityId]);

  const selectedResidentLabel = useMemo(() => {
    const r = residents.find((x) => x.id === residentId);
    return r ? residentComboLabel(r) : "";
  }, [residentId, residents]);

  const selectedLeadLabel = useMemo(() => {
    const l = leads.find((x) => x.id === referralLeadId);
    return l ? leadComboLabel(l) : "";
  }, [leads, referralLeadId]);

  const selectedBedLabel = useMemo(() => {
    const b = beds.find((x) => x.id === bedId);
    return b?.bed_label ?? "";
  }, [bedId, beds]);

  const commitOrigin = useCallback(
    (next: AdmissionOrigin) => {
      setOrigin(next);
      const p = new URLSearchParams(searchParams.toString());
      p.set(ORIGIN_QUERY, next);
      if (next !== "lead") {
        p.delete("lead");
      }
      router.replace(`/admin/admissions/new?${p.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  useEffect(() => {
    const rawOrigin = searchParams.get(ORIGIN_QUERY);
    const lid = searchParams.get("lead")?.trim();
    if (!rawOrigin && lid) {
      setOrigin("lead");
      return;
    }
    setOrigin(normalizeOrigin(rawOrigin));
  }, [searchParams]);

  useEffect(() => {
    if (!preselectedLeadId || leadPrefilled) return;
    const p = new URLSearchParams(searchParams.toString());
    p.set(ORIGIN_QUERY, "lead");
    p.set("lead", preselectedLeadId);
    router.replace(`/admin/admissions/new?${p.toString()}`, { scroll: false });
    setLeadPrefilled(true);
  }, [leadPrefilled, preselectedLeadId, router, searchParams]);

  useEffect(() => {
    if (!preselectedLeadId || leads.length === 0) return;
    const lead = leads.find((l) => l.id === preselectedLeadId);
    if (lead?.notes) setNotes((n) => n || lead.notes || "");
  }, [leads, preselectedLeadId]);

  const loadRefs = useCallback(async () => {
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setResidents([]);
      setLeads([]);
      setBeds([]);
      setReferralSources([]);
      setLoadingRefs(false);
      return;
    }
    setLoadingRefs(true);

    const { data: fac } = await supabase.from("facilities").select("organization_id").eq("id", selectedFacilityId).single();
    const orgId = fac?.organization_id ?? null;

    const [res, ld, bd] = await Promise.all([
      supabase
        .from("residents")
        .select("id, first_name, last_name, status, date_of_birth, created_at")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .in("status", ["inquiry", "pending_admission"])
        .order("last_name"),
      supabase
        .from("referral_leads")
        .select(
          "id, first_name, last_name, preferred_name, date_of_birth, inquiry_date, phone, email, notes, status, referral_source_id",
        )
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .not("status", "in", "(converted,lost,merged)")
        .order("last_name"),
      supabase
        .from("beds")
        .select("id, bed_label")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .in("status", ["available", "hold"])
        .order("bed_label"),
    ]);

    let sources: ReferralSourceOpt[] = [];
    if (orgId) {
      const { data: srcRows } = await supabase
        .from("referral_sources")
        .select("id, name")
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .eq("is_active", true)
        .or(`facility_id.is.null,facility_id.eq.${selectedFacilityId}`)
        .order("name");
      sources = (srcRows ?? []) as ReferralSourceOpt[];
    }

    setResidents((res.data ?? []) as ResidentOption[]);
    setLeads((ld.data ?? []) as LeadOption[]);
    setBeds((bd.data ?? []) as BedOption[]);
    setReferralSources(sources);
    setLoadingRefs(false);
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void loadRefs();
  }, [loadRefs]);

  useEffect(() => {
    async function checkLeadLinkedCase() {
      if (
        !selectedFacilityId ||
        !isValidFacilityIdForQuery(selectedFacilityId) ||
        !referralLeadId ||
        origin === "direct"
      ) {
        setExistingAdmissionCaseId(null);
        return;
      }
      const { data } = await supabase
        .from("admission_cases")
        .select("id")
        .eq("facility_id", selectedFacilityId)
        .eq("referral_lead_id", referralLeadId)
        .is("deleted_at", null)
        .not("status", "eq", "cancelled")
        .maybeSingle();
      setExistingAdmissionCaseId(data?.id ?? null);
    }
    void checkLeadLinkedCase();
  }, [origin, referralLeadId, selectedFacilityId, supabase]);

  useEffect(() => {
    async function checkResidentCase() {
      if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId) || origin !== "inquiry" || !residentId) {
        setExistingResidentAdmissionCaseId(null);
        return;
      }
      const { data } = await supabase
        .from("admission_cases")
        .select("id")
        .eq("facility_id", selectedFacilityId)
        .eq("resident_id", residentId)
        .is("deleted_at", null)
        .not("status", "eq", "cancelled")
        .maybeSingle();
      setExistingResidentAdmissionCaseId(data?.id ?? null);
    }
    void checkResidentCase();
  }, [origin, residentId, selectedFacilityId, supabase]);

  const duplicateBlocked = Boolean(existingAdmissionCaseId || existingResidentAdmissionCaseId);

  const canSubmitBase =
    !!selectedFacilityId &&
    isValidFacilityIdForQuery(selectedFacilityId) &&
    !!targetMoveIn.trim() &&
    !duplicateBlocked &&
    !submitting;

  const canSubmit =
    canSubmitBase &&
    (origin === "inquiry"
      ? !!residentId
      : origin === "lead"
        ? !!referralLeadId
        : directFirstName.trim().length > 0 &&
          directLastName.trim().length > 0 &&
          !!directAdmissionSource);

  const disabledHintMessage =
    origin === "inquiry"
      ? "Select an inquiry resident and target move-in date to enable."
      : origin === "lead"
        ? "Select a referral lead and target move-in date to enable."
        : "Enter required resident fields, admission source, and target move-in date to enable.";

  const showDisabledHint =
    !submitting &&
    !duplicateBlocked &&
    !!selectedFacilityId &&
    isValidFacilityIdForQuery(selectedFacilityId) &&
    !canSubmit &&
    !!targetMoveIn.trim();

  async function handleCreateResidentModal() {
    setModalError(null);
    const fn = modalFirstName.trim();
    const ln = modalLastName.trim();
    if (!fn || !ln) {
      setModalError("First and last name are required.");
      return;
    }
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setModalError("Choose a facility in the header.");
      return;
    }
    const { data: fac, error: facErr } = await supabase
      .from("facilities")
      .select("organization_id")
      .eq("id", selectedFacilityId)
      .is("deleted_at", null)
      .maybeSingle();
    if (facErr || !fac?.organization_id) {
      setModalError("Could not resolve organization for this facility.");
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.id) {
      setModalError("You must be signed in.");
      return;
    }
    setCreatingResident(true);
    try {
      const dobIso = modalDob.trim() || null;
      const { data: newRes, error: insErr } = await supabase
        .from("residents")
        .insert({
          facility_id: selectedFacilityId,
          organization_id: fac.organization_id,
          first_name: fn,
          last_name: ln,
          date_of_birth: dobIso,
          gender: modalGender as "female" | "male" | "other" | "prefer_not_to_say",
          status: "inquiry",
          created_by: user.id,
          updated_by: user.id,
        })
        .select("id")
        .single();
      if (insErr || !newRes?.id) {
        setModalError(insErr?.message ?? "Could not create resident.");
        return;
      }
      await loadRefs();
      setResidentId(newRes.id);
      setModalFirstName("");
      setModalLastName("");
      setModalDob("");
      setModalGender("prefer_not_to_say");
      setCreateModalOpen(false);
    } finally {
      setCreatingResident(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setError("Select a facility in the header.");
      return;
    }
    if (duplicateBlocked) {
      setError("This intake is already represented by an active admission case.");
      return;
    }
    if (!targetMoveIn.trim()) {
      setError("Target move-in date is required.");
      return;
    }

    setSubmitting(true);
    try {
      const { data: fac, error: facErr } = await supabase
        .from("facilities")
        .select("organization_id")
        .eq("id", selectedFacilityId)
        .is("deleted_at", null)
        .maybeSingle();
      if (facErr || !fac?.organization_id) {
        setError("Could not resolve organization for this facility.");
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.id) {
        setError("You must be signed in.");
        return;
      }

      let finalResidentId = "";
      let payloadLeadId: string | null = null;

      if (origin === "inquiry") {
        if (!residentId) {
          setError("Select an inquiry resident.");
          return;
        }
        finalResidentId = residentId;
        payloadLeadId = referralLeadId.trim() || null;
      } else if (origin === "lead") {
        if (!referralLeadId) {
          setError("Select a referral lead.");
          return;
        }
        const lead = leads.find((l) => l.id === referralLeadId);
        if (!lead) {
          setError("Referral lead not found.");
          return;
        }
        const dobIso = lead.date_of_birth?.trim() || null;
        const { data: newRes, error: resErr } = await supabase
          .from("residents")
          .insert({
            facility_id: selectedFacilityId,
            organization_id: fac.organization_id,
            first_name: lead.first_name.trim(),
            last_name: lead.last_name.trim(),
            preferred_name: lead.preferred_name?.trim() || null,
            date_of_birth: dobIso,
            gender: "prefer_not_to_say",
            status: "inquiry",
            referral_source_id: lead.referral_source_id,
            created_by: user.id,
            updated_by: user.id,
          })
          .select("id")
          .single();
        if (resErr || !newRes?.id) {
          setError(resErr?.message ?? "Could not create resident from lead.");
          return;
        }
        finalResidentId = newRes.id;
        payloadLeadId = referralLeadId;
        await supabase
          .from("referral_leads")
          .update({ converted_resident_id: finalResidentId, updated_by: user.id })
          .eq("id", referralLeadId);
      } else {
        const fn = directFirstName.trim();
        const ln = directLastName.trim();
        if (!fn || !ln) {
          setError("First and last name are required.");
          return;
        }
        if (!directAdmissionSource) {
          setError("Select an admission source.");
          return;
        }
        let referralSourceId: string | null = null;
        let admissionSourceFree: string | null = null;
        if (directAdmissionSource.startsWith("src:")) {
          referralSourceId = directAdmissionSource.slice(4);
        } else if (directAdmissionSource.startsWith("syn:")) {
          const key = directAdmissionSource.slice(4);
          const syn = SYNTHETIC_SOURCES.find((s) => s.key === key);
          admissionSourceFree = syn?.label ?? key;
        }

        const dobIso = directDob.trim() || null;
        const { data: newRes, error: resErr } = await supabase
          .from("residents")
          .insert({
            facility_id: selectedFacilityId,
            organization_id: fac.organization_id,
            first_name: fn,
            last_name: ln,
            date_of_birth: dobIso,
            gender: "prefer_not_to_say",
            status: "inquiry",
            referral_source_id: referralSourceId,
            admission_source: admissionSourceFree,
            created_by: user.id,
            updated_by: user.id,
          })
          .select("id")
          .single();
        if (resErr || !newRes?.id) {
          setError(resErr?.message ?? "Could not create resident.");
          return;
        }
        finalResidentId = newRes.id;
        payloadLeadId = null;
      }

      const payload = {
        facility_id: selectedFacilityId,
        resident_id: finalResidentId,
        referral_lead_id: payloadLeadId,
        bed_id: bedId || null,
        target_move_in_date: targetMoveIn.trim(),
        notes: notes.trim() || null,
        intake_program_type: intakeProgramType.trim() || null,
      };

      const response = await fetch("/api/admin/workflows/admission-cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!response.ok || !result?.id) {
        setError(result?.error || "Could not create admission case.");
        return;
      }

      const toastBed = bedId ? "Bed reserved." : "Bed pending.";
      toast.success(`Case opened. ${toastBed}`, { duration: 6000 });
      router.push(`/admin/admissions/${result.id}`);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  const noFacility = !selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId);

  const originChip = (value: AdmissionOrigin, label: string) => (
    <button
      key={value}
      type="button"
      role="radio"
      aria-checked={origin === value}
      onClick={() => commitOrigin(value)}
      className={cn(
        "rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        origin === value
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-foreground hover:bg-muted/60",
      )}
    >
      {label}
    </button>
  );

  function openCreateFromEmpty() {
    setModalError(null);
    setCreateModalOpen(true);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 pb-12">
      <Link
        href="/pipeline/recent-admissions"
        className="inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="size-4 shrink-0" aria-hidden />
        Back to admissions
      </Link>

      <PageHeader
        title="New admission case"
        subtitle={
          facilityName ? (
            <>
              Start the intake workflow for a resident at <span className="text-foreground">{facilityName}</span>.
            </>
          ) : (
            "Start the intake workflow for a resident. Choose a facility in the header to continue."
          )
        }
      />

      {noFacility ? (
        <p className="text-sm text-amber-800 dark:text-amber-200" role="status">
          Select a facility in the header to continue.
        </p>
      ) : (
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-8" noValidate>
          <div role="radiogroup" aria-label="Admission origin" className="flex flex-wrap gap-2">
            {originChip("inquiry", "From an existing inquiry resident")}
            {originChip("lead", "From a referral lead")}
            {originChip("direct", "Direct admit (no prior record)")}
          </div>

          {existingAdmissionCaseId ? (
            <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-[13px] text-foreground">
              This referral lead already has an active admission case. Open that case instead of creating a duplicate.
              <div className="mt-3">
                <Link href={`/admin/admissions/${existingAdmissionCaseId}`} className={cn(buttonVariants({ size: "sm" }))}>
                  Open existing admission case
                </Link>
              </div>
            </div>
          ) : null}
          {existingResidentAdmissionCaseId ? (
            <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-[13px] text-foreground">
              This resident already has an active admission case. Open that case instead of creating a duplicate.
              <div className="mt-3">
                <Link
                  href={`/admin/admissions/${existingResidentAdmissionCaseId}`}
                  className={cn(buttonVariants({ size: "sm" }))}
                >
                  Open existing admission case
                </Link>
              </div>
            </div>
          ) : null}

          {/* Inquiry resident */}
          {origin === "inquiry" ? (
            <div className="space-y-3">
              {residents.length === 0 && !loadingRefs ? (
                <div className="space-y-3 text-[13px] text-foreground">
                  <p className="leading-relaxed text-muted-foreground">
                    No inquiry or pending-admission residents available. Create a new resident to admit, or set an inquiry
                    status on an existing resident first.
                  </p>
                  <button
                    type="button"
                    className={cn(
                      buttonVariants({ variant: "ghost", size: "sm" }),
                      "h-auto px-0 py-0 text-[13px] font-medium text-primary underline-offset-4 hover:bg-transparent hover:text-primary hover:underline",
                    )}
                    onClick={openCreateFromEmpty}
                  >
                    + Create new resident
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="resident-combobox" className="text-[13px]">
                    Inquiry resident
                    <RequiredMark />
                  </Label>
                  <Popover open={residentOpen} onOpenChange={setResidentOpen}>
                    <PopoverTrigger
                      id="resident-combobox"
                      type="button"
                      disabled={loadingRefs}
                      className={cn(
                        buttonVariants({ variant: "outline", size: "sm" }),
                        "h-10 w-full justify-between px-3 font-normal",
                      )}
                      aria-required
                    >
                      <span className={cn("truncate", !selectedResidentLabel && "text-muted-foreground")}>
                        {selectedResidentLabel || "Search inquiry residents..."}
                      </span>
                    </PopoverTrigger>
                    <PopoverContent className="w-[min(100vw-2rem,440px)] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search inquiry residents..." />
                        <CommandList>
                          <CommandEmpty>No matching residents.</CommandEmpty>
                          <CommandGroup heading="Residents">
                            {residents.map((r) => (
                              <CommandItem
                                key={r.id}
                                value={residentComboLabel(r)}
                                onSelect={() => {
                                  setResidentId(r.id);
                                  setResidentOpen(false);
                                }}
                              >
                                {residentComboLabel(r)}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                          <CommandSeparator />
                          <CommandGroup>
                            <CommandItem
                              value="+ Create new resident"
                              onSelect={() => {
                                setResidentOpen(false);
                                setCreateModalOpen(true);
                              }}
                              className="text-primary"
                            >
                              + Create new resident
                            </CommandItem>
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="inquiry-lead-link" className="text-[13px]">
                  Referral lead <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Select
                  value={referralLeadId ? referralLeadId : OPTIONAL_LEAD_NONE}
                  onValueChange={(v) => setReferralLeadId(v === OPTIONAL_LEAD_NONE ? "" : v)}
                  disabled={loadingRefs}
                >
                  <SelectTrigger id="inquiry-lead-link">
                    <SelectValue placeholder="Select a referral lead…" />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value={OPTIONAL_LEAD_NONE}>None</SelectItem>
                    {leads.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.last_name}, {l.first_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[12px] text-muted-foreground">
                  Optionally link this case to a CRM lead so source attribution carries forward.
                </p>
              </div>
            </div>
          ) : null}

          {/* Referral lead origin */}
          {origin === "lead" ? (
            <div className="space-y-2">
              <Label htmlFor="lead-combobox" className="text-[13px]">
                Referral lead
                <RequiredMark />
              </Label>
              <Popover open={leadOpen} onOpenChange={setLeadOpen}>
                <PopoverTrigger
                  id="lead-combobox"
                  type="button"
                  disabled={loadingRefs}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-10 w-full justify-between px-3 font-normal")}
                  aria-required
                >
                  <span className={cn("truncate", !selectedLeadLabel && "text-muted-foreground")}>
                    {selectedLeadLabel || "Search referral leads..."}
                  </span>
                </PopoverTrigger>
                <PopoverContent className="w-[min(100vw-2rem,440px)] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search referral leads..." />
                    <CommandList>
                      <CommandEmpty>No matching leads.</CommandEmpty>
                      <CommandGroup heading="Leads">
                        {leads.map((l) => (
                          <CommandItem
                            key={l.id}
                            value={leadComboLabel(l)}
                            onSelect={() => {
                              setReferralLeadId(l.id);
                              setLeadOpen(false);
                            }}
                          >
                            {leadComboLabel(l)}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          ) : null}

          {/* Direct admit */}
          {origin === "direct" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="dir-fn" className="text-[13px]">
                  First name
                  <RequiredMark />
                </Label>
                <Input
                  id="dir-fn"
                  value={directFirstName}
                  onChange={(e) => setDirectFirstName(e.target.value)}
                  autoComplete="given-name"
                  aria-required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dir-ln" className="text-[13px]">
                  Last name
                  <RequiredMark />
                </Label>
                <Input
                  id="dir-ln"
                  value={directLastName}
                  onChange={(e) => setDirectLastName(e.target.value)}
                  autoComplete="family-name"
                  aria-required
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="dir-dob" className="text-[13px]">
                  Date of birth <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <DateInput id="dir-dob" value={directDob} onValueChange={setDirectDob} emptyHint={null} className="max-w-[11.5rem]" />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="dir-source" className="text-[13px]">
                  Admission source
                  <RequiredMark />
                </Label>
                <Select value={directAdmissionSource || undefined} onValueChange={setDirectAdmissionSource}>
                  <SelectTrigger id="dir-source" aria-required>
                    <SelectValue placeholder="Select admission source..." />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {referralSources.map((s) => (
                      <SelectItem key={s.id} value={`src:${s.id}`}>
                        {s.name}
                      </SelectItem>
                    ))}
                    <SelectSeparator />
                    {SYNTHETIC_SOURCES.map((s) => (
                      <SelectItem key={s.key} value={`syn:${s.key}`}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}

          {(origin === "inquiry" || origin === "lead" || origin === "direct") && (
            <>
              <div className="h-px w-full bg-border" aria-hidden />

              <div className="space-y-2">
                <Label htmlFor="bed-combobox" className="text-[13px]">
                  Bed <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Popover open={bedOpen} onOpenChange={setBedOpen}>
                  <PopoverTrigger
                    id="bed-combobox"
                    type="button"
                    disabled={loadingRefs}
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-10 w-full justify-between px-3 font-normal")}
                  >
                    <span className={cn("truncate", !selectedBedLabel && "text-muted-foreground")}>
                      {selectedBedLabel || "Search beds..."}
                    </span>
                  </PopoverTrigger>
                  <PopoverContent className="w-[min(100vw-2rem,440px)] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search beds..." />
                      <CommandList>
                        <CommandEmpty>No matching beds.</CommandEmpty>
                        <CommandGroup heading="Beds">
                          <CommandItem
                            value="__clear_bed"
                            onSelect={() => {
                              setBedId("");
                              setBedOpen(false);
                            }}
                          >
                            Clear selection
                          </CommandItem>
                          {beds.map((b) => (
                            <CommandItem
                              key={b.id}
                              value={b.bed_label}
                              onSelect={() => {
                                setBedId(b.id);
                                setBedOpen(false);
                              }}
                            >
                              {b.bed_label}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <p className="text-[12px] text-muted-foreground">
                  Reserves the bed once the case is created. You can change later.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="adm-target" className="text-[13px]">
                  Target move-in date
                  <RequiredMark />
                </Label>
                <DateInput
                  id="adm-target"
                  value={targetMoveIn}
                  onValueChange={setTargetMoveIn}
                  emptyHint={null}
                  aria-required
                  className="max-w-[11.5rem]"
                />
                {targetMoveIn ? (
                  <p className="text-[13px] font-medium text-muted-foreground">
                    {format(parseISO(`${targetMoveIn}T12:00:00`), "MMMM d, yyyy")}
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="adm-intake-type" className="text-[13px]">
                  Admission type <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Select value={intakeProgramType || undefined} onValueChange={(v) => setIntakeProgramType(v)}>
                  <SelectTrigger id="adm-intake-type">
                    <SelectValue placeholder="Select admission type..." />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {INTAKE_PROGRAM_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[12px] text-muted-foreground">
                  Long-term, short-term respite, memory care transition, etc.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="adm-notes" className="text-[13px]">
                  Notes <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Textarea
                  id="adm-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Reason for admission, payer details, family preferences, etc."
                  rows={4}
                  className="min-h-[6rem] max-h-[18rem] resize-y text-[13px]"
                  style={{ resize: "vertical" }}
                />
              </div>
            </>
          )}

          <p className="text-[12px] leading-relaxed text-muted-foreground">
            After case creation: complete bed reservation, payer setup, family contacts, and care plan.
          </p>

          {error ? (
            <p className="text-[13px] text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex max-w-3xl flex-col items-end gap-2 border-t border-border pt-6">
            <div className="flex w-full justify-end gap-4">
              <Link
                href="/pipeline/recent-admissions"
                className="inline-flex h-9 items-center text-[13px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Cancel
              </Link>
              <Button type="submit" disabled={!canSubmit} className="min-w-[140px]">
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                    Saving…
                  </>
                ) : (
                  "Create case"
                )}
              </Button>
            </div>
            {showDisabledHint ? (
              <p className="max-w-md text-right text-[12px] text-muted-foreground">{disabledHintMessage}</p>
            ) : null}
          </div>
        </form>
      )}

      <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
        <DialogContent className="bg-card sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New inquiry resident</DialogTitle>
            <DialogDescription>Add a resident profile in inquiry status, then continue this admission.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="modal-fn">First name</Label>
                <Input id="modal-fn" value={modalFirstName} onChange={(e) => setModalFirstName(e.target.value)} placeholder="Jane" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="modal-ln">Last name</Label>
                <Input id="modal-ln" value={modalLastName} onChange={(e) => setModalLastName(e.target.value)} placeholder="Smith" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="modal-dob">Date of birth</Label>
              <DateInput id="modal-dob" value={modalDob} onValueChange={setModalDob} emptyHint={null} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="modal-gender">Gender</Label>
              <Select value={modalGender} onValueChange={setModalGender}>
                <SelectTrigger id="modal-gender">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GENDERS.map((g) => (
                    <SelectItem key={g.value} value={g.value}>
                      {g.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-[12px] text-muted-foreground">
              Additional resident details can be added from the resident profile after the case opens.
            </p>
            {modalError ? (
              <p className="text-[13px] text-destructive" role="alert">
                {modalError}
              </p>
            ) : null}
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setCreateModalOpen(false);
                setModalError(null);
              }}
            >
              Cancel
            </Button>
            <Button type="button" size="sm" disabled={creatingResident} onClick={() => void handleCreateResidentModal()}>
              {creatingResident ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                  Saving…
                </>
              ) : (
                "Save resident"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function AdminAdmissionsNewPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-[13px] text-muted-foreground" role="status">
          Loading…
        </div>
      }
    >
      <AdmissionsNewInner />
    </Suspense>
  );
}
