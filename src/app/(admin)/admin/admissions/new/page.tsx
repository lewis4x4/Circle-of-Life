"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { differenceInYears, format, parseISO } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { ChevronDown, ChevronLeft, GripHorizontal, Info, Loader2, X, AlertTriangle } from "lucide-react";
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
import { formatCents } from "@/lib/finance/format-cents";
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
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { QuietDatePicker, formatQuietIsoForDisplay } from "@/components/ui/quiet-date-picker";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database";
import {
  DIRECT_ADMISSION_SOURCES,
  NAME_SUFFIX_PRESETS,
  admissionSourceLabel,
  directAdmitDobSchema,
  genderDisplayLabel,
  parseDirectAdmitForSubmit,
  type DirectAdmissionSourceValue,
} from "@/lib/admissions/direct-intake-schema";
import { digitsOnlyNanp, formatUsPhoneMask } from "@/lib/admissions/phone-us";

const TAB_QUERY = "tab";
const LEGACY_TAB_QUERY = "origin";
const RESIDENT_QUERY = "resident";

type AdmissionOrigin = "inquiry" | "lead" | "direct";

const OPTIONAL_LEAD_NONE = "__none__";
const OPTIONAL_PAYER_NONE = "__payer_none__";

const GENDERS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "non_binary", label: "Non-binary" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
  { value: "other", label: "Other" },
] as const;

const INTAKE_PROGRAM_OPTIONS = [
  { value: "long_term", label: "Long-term" },
  { value: "short_term_respite", label: "Short-term respite" },
  { value: "memory_care_transition", label: "Memory care transition" },
  { value: "other", label: "Other" },
] as const;

function normalizeAdmissionTab(tab: string | null, legacyOrigin: string | null): AdmissionOrigin {
  const next = typeof tab === "string" ? tab.trim() : "";
  if (next === "inquiry" || next === "lead" || next === "direct") return next;
  if (legacyOrigin === "lead" || legacyOrigin === "direct") return legacyOrigin;
  return "inquiry";
}

function todayYmdInZone(timeZone: string) {
  return formatInTimeZone(new Date(), timeZone, "yyyy-MM-dd");
}

function isoMoveInAccepted(ymd: string | null | undefined, timeZone: string) {
  const t = (ymd ?? "").trim();
  if (!t) return { ok: true as const, message: "" as const };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return { ok: false as const, message: "Use a valid target move-in date." };
  if (t < todayYmdInZone(timeZone)) {
    return { ok: false as const, message: "Target move-in date cannot be before today." };
  }
  return { ok: true as const, message: "" as const };
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

function IntakeSectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-2">
      <h2 className="font-sans text-[14px] font-semibold tracking-normal text-foreground">{children}</h2>
      <div className="h-px w-full bg-border" aria-hidden />
    </div>
  );
}

function escapeIlikePctUnderscore(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

type ResidentOption = {
  id: string;
  first_name: string;
  last_name: string;
  status: string;
  date_of_birth: string | null;
  created_at: string;
  referral_source_id: string | null;
};

type LeadOption = {
  id: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  date_of_birth: string | null;
  inquiry_date: string;
  updated_at: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  status: string;
  referral_source_id: string | null;
};

type DuplicateResidentMatch = {
  id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  status: Database["public"]["Enums"]["resident_status"];
  discharge_date: string | null;
  facility_id: string;
  facilities: { name: string } | null;
};

type BedRoomRow = {
  room_number: string | null;
  room_type: "private" | "semi_private" | "shared" | null;
};

type BedOption = {
  id: string;
  bed_label: string;
  bed_type: string;
  room: BedRoomRow | BedRoomRow[] | null;
  monthly_cents: number | null;
  display_line: string;
};

type FacilityPanelMeta = {
  name: string;
  totalLicensedBeds: number;
  timezone: string;
  organizationId: string | null;
};

type AnticipatedPayerDb =
  Database["public"]["Enums"]["anticipated_payer_source"];

const ANTICIPATED_PAYER_OPTIONS: { value: AnticipatedPayerDb; label: string }[] = [
  { value: "private_pay", label: "Private pay" },
  { value: "medicaid_pending", label: "Medicaid pending" },
  { value: "medicaid_approved", label: "Medicaid approved" },
  { value: "ltc_insurance", label: "LTC insurance" },
  { value: "va_benefits", label: "VA benefits" },
  { value: "other", label: "Other" },
];

type ReferralSourceOpt = { id: string; name: string };

function roomTypeShortLabel(rt: string | null): string {
  if (rt === "semi_private") return "Semi-private";
  if (rt === "shared") return "Shared";
  return "Private";
}

function normalizeRoomJoin(room: BedRoomRow | BedRoomRow[] | null): BedRoomRow | null {
  if (!room) return null;
  return Array.isArray(room) ? (room[0] ?? null) : room;
}

function monthlyRentCents(
  roomType: string | null,
  basePrivate: number | null,
  baseSemi: number | null,
): number | null {
  if (basePrivate == null) return null;
  if (roomType === "semi_private" || roomType === "shared") {
    if (baseSemi != null) return baseSemi;
  }
  return basePrivate;
}

function bedTitling(label: string) {
  const t = label.trim();
  return /^bed\s/i.test(t) ? t : `Bed ${t}`;
}

function formatBedOptionLine(
  bedLabel: string,
  roomNumber: string,
  roomType: string | null,
  monthlyCents: number | null,
) {
  const price = monthlyCents != null ? `${formatCents(monthlyCents)}/mo` : "—/mo";
  return `${bedTitling(bedLabel)} · Room ${roomNumber} · ${roomTypeShortLabel(roomType)} · ${price}`;
}

function dobOrAgeLine(dob: string | null): string {
  if (!dob?.trim()) return "DOB pending";
  try {
    const d = parseISO(dob.length > 10 ? dob : `${dob}T12:00:00`);
    const dobStr = format(d, "MMM d, yyyy");
    const age = differenceInYears(new Date(), d);
    return `${dobStr} (~${age} yr)`;
  } catch {
    return dob.slice(0, 10);
  }
}

function formatIsoDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    return format(parseISO(iso.length > 10 ? iso : `${iso}T12:00:00`), "MMM d, yyyy");
  } catch {
    return iso.slice(0, 10);
  }
}

function duplicateResidentHumanSummary(m: DuplicateResidentMatch): string {
  const facilityName = m.facilities?.name?.trim() || "another facility";
  const born = formatIsoDate(m.date_of_birth) ?? "unknown DOB";
  const full = `${m.first_name} ${m.last_name}`.trim();
  if (m.status === "discharged") {
    const dd = formatIsoDate(m.discharge_date) ?? "unknown date";
    return `${full}, born ${born} — Discharged ${dd} from ${facilityName}`;
  }
  if (m.status === "deceased") {
    return `${full}, born ${born} — Deceased (record linked to ${facilityName})`;
  }
  if (
    m.status === "inquiry" ||
    m.status === "pending_admission" ||
    m.status === "active" ||
    m.status === "hospital_hold" ||
    m.status === "loa"
  ) {
    return `${full}, born ${born} — Currently at ${facilityName}`;
  }
  return `${full}, born ${born} — Status: ${m.status} (${facilityName})`;
}

function referralSourceLookup(
  referralSources: ReferralSourceOpt[],
  referralSourceId: string | null,
): string | null {
  if (!referralSourceId) return null;
  const m = referralSources.find((x) => x.id === referralSourceId);
  return m?.name ?? null;
}

function residentPickerLine(r: ResidentOption, referralSources: ReferralSourceOpt[]): string {
  const nm = `${r.last_name}, ${r.first_name}`;
  const da = dobOrAgeLine(r.date_of_birth);
  const inq = formatIsoDate(r.created_at.split("T")[0]) ?? "—";
  const srcNm = referralSourceLookup(referralSources, r.referral_source_id);
  const src = srcNm ? ` · ${srcNm}` : "";
  return `${nm} · ${da} · Inquiry ${inq}${src}`;
}

function formatLeadStage(status: string): string {
  const t = status.trim().replace(/_/g, " ");
  if (!t) return "—";
  return t.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

/** Combobox row: lead display name · attribution · inquiry date · CRM stage */
function leadComboboxLine(l: LeadOption, referralSources: ReferralSourceOpt[]): string {
  const name = `${l.last_name}, ${l.first_name}`;
  const src = referralSourceLookup(referralSources, l.referral_source_id)?.trim() || "Unknown source";
  const inq = formatIsoDate(l.inquiry_date) ?? "—";
  const stage = formatLeadStage(l.status);
  return `${name} · ${src} · ${inq} · ${stage}`;
}

function leadContactLine(l: LeadOption): string {
  const pn = l.preferred_name?.trim();
  if (pn) return pn;
  return `${l.first_name} ${l.last_name}`.trim() || "—";
}

function residentComboLabel(r: ResidentOption, referralSources: ReferralSourceOpt[]): string {
  return residentPickerLine(r, referralSources);
}

function leadComboLabel(l: LeadOption, referralSources: ReferralSourceOpt[]): string {
  return leadComboboxLine(l, referralSources);
}

function AdmissionsNewInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const selectedFacilityId = useFacilityStore((s) => s.selectedFacilityId);
  const availableFacilities = useFacilityStore((s) => s.availableFacilities);

  const preselectedLeadId = searchParams.get("lead")?.trim() ?? "";

  const [origin, setOrigin] = useState<AdmissionOrigin>(() =>
    preselectedLeadId
      ? "lead"
      : normalizeAdmissionTab(searchParams.get(TAB_QUERY), searchParams.get(LEGACY_TAB_QUERY)),
  );
  const [residentId, setResidentId] = useState("");
  const [referralLeadId, setReferralLeadId] = useState(preselectedLeadId);
  const [bedId, setBedId] = useState("");
  const [targetMoveIn, setTargetMoveIn] = useState("");
  const [notes, setNotes] = useState("");
  const [intakeProgramType, setIntakeProgramType] = useState<string>("");
  const [anticipatedPayerSource, setAnticipatedPayerSource] = useState<string>("");
  const [anticipatedPayerOther, setAnticipatedPayerOther] = useState("");

  const [directFirstName, setDirectFirstName] = useState("");
  const [directLastName, setDirectLastName] = useState("");
  const [directNameSuffix, setDirectNameSuffix] = useState("");
  const [directPreferredName, setDirectPreferredName] = useState("");
  const [directDob, setDirectDob] = useState("");
  const [directGender, setDirectGender] = useState("");
  const [directGenderOther, setDirectGenderOther] = useState("");
  const [directPhoneDisplay, setDirectPhoneDisplay] = useState("");
  const [directAdmissionSource, setDirectAdmissionSource] = useState("");
  const [directAdmissionSourceOther, setDirectAdmissionSourceOther] = useState("");
  const [duplicateWarningDismissed, setDuplicateWarningDismissed] = useState(false);
  const [directValidationAttempted, setDirectValidationAttempted] = useState(false);
  const [duplicateCandidate, setDuplicateCandidate] = useState<DuplicateResidentMatch | null>(null);
  const [duplicateLookupLoading, setDuplicateLookupLoading] = useState(false);
  const [directPreviewOpen, setDirectPreviewOpen] = useState(false);

  const duplicateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [facilityPanel, setFacilityPanel] = useState<FacilityPanelMeta | null>(null);

  const [residentOpen, setResidentOpen] = useState(false);
  const [leadOpen, setLeadOpen] = useState(false);
  const [bedOpen, setBedOpen] = useState(false);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [modalFirstName, setModalFirstName] = useState("");
  const [modalLastName, setModalLastName] = useState("");
  const [modalDob, setModalDob] = useState("");
  const [modalGender, setModalGender] = useState<string>("");
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

  const selectedResidentLabel = useMemo(() => {
    const r = residents.find((x) => x.id === residentId);
    return r ? residentComboLabel(r, referralSources) : "";
  }, [residentId, residents, referralSources]);

  const selectedLeadLabel = useMemo(() => {
    const l = leads.find((x) => x.id === referralLeadId);
    return l ? leadComboLabel(l, referralSources) : "";
  }, [leads, referralLeadId, referralSources]);

  const selectedBedLabel = useMemo(() => {
    const b = beds.find((x) => x.id === bedId);
    return b?.display_line ?? "";
  }, [bedId, beds]);

  const selectedBedChoice = useMemo(() => beds.find((x) => x.id === bedId) ?? null, [bedId, beds]);

  const moveInValidity = useMemo(
    () => isoMoveInAccepted(targetMoveIn, facilityPanel?.timezone ?? "America/New_York"),
    [targetMoveIn, facilityPanel?.timezone],
  );

  const commitAdmissionTab = useCallback(
    (next: AdmissionOrigin) => {
      setOrigin(next);
      const p = new URLSearchParams(searchParams.toString());
      p.set(TAB_QUERY, next);
      p.delete(LEGACY_TAB_QUERY);
      if (next !== "lead") {
        p.delete("lead");
      }
      if (next !== "inquiry") {
        p.delete(RESIDENT_QUERY);
      }
      router.replace(`/admin/admissions/new?${p.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  /** Deep-link: ?resident=uuid on Existing inquiry tab */
  useEffect(() => {
    const rid = searchParams.get(RESIDENT_QUERY)?.trim();
    if (!rid || loadingRefs || origin !== "inquiry") return;
    const hit = residents.some((r) => r.id === rid);
    if (hit) setResidentId(rid);
  }, [searchParams, residents, loadingRefs, origin]);

  useEffect(() => {
    setDuplicateWarningDismissed(false);
  }, [directFirstName, directLastName, directDob]);

  useEffect(() => {
    if (origin !== "direct") {
      setDuplicateCandidate(null);
      setDuplicateLookupLoading(false);
      return;
    }
    const orgId = facilityPanel?.organizationId ?? null;
    const fn = directFirstName.trim();
    const ln = directLastName.trim();
    const dobTrim = directDob.trim();

    const dobReady = directAdmitDobSchema.safeParse(dobTrim).success;

    if (!orgId || fn.length < 2 || ln.length < 2 || !dobReady) {
      setDuplicateCandidate(null);
      setDuplicateLookupLoading(false);
      return;
    }

    if (duplicateTimerRef.current) clearTimeout(duplicateTimerRef.current);
    duplicateTimerRef.current = setTimeout(() => {
      void (async () => {
        setDuplicateLookupLoading(true);
        try {
          const fnEsc = escapeIlikePctUnderscore(fn);
          const lnEsc = escapeIlikePctUnderscore(ln);
          const { data, error } = await supabase
            .from("residents")
            .select(
              "id, first_name, last_name, date_of_birth, status, discharge_date, facility_id, facilities(name)",
            )
            .eq("organization_id", orgId)
            .is("deleted_at", null)
            .ilike("first_name", `%${fnEsc}%`)
            .ilike("last_name", `%${lnEsc}%`)
            .or(`date_of_birth.eq.${dobTrim},date_of_birth.is.null`)
            .limit(5);

          if (error) {
            setDuplicateCandidate(null);
            return;
          }
          const rows = (data ?? []) as DuplicateResidentMatch[];
          setDuplicateCandidate(rows[0] ?? null);
        } finally {
          setDuplicateLookupLoading(false);
        }
      })();
    }, 400);

    return () => {
      if (duplicateTimerRef.current) clearTimeout(duplicateTimerRef.current);
    };
  }, [
    origin,
    directFirstName,
    directLastName,
    directDob,
    facilityPanel?.organizationId,
    supabase,
  ]);

  const facilityDisplayName =
    facilityPanel?.name ??
    (selectedFacilityId ? (availableFacilities.find((f) => f.id === selectedFacilityId)?.name ?? null) : null);

  useEffect(() => {
    const rawTab = searchParams.get(TAB_QUERY);
    const rawLegacy = searchParams.get(LEGACY_TAB_QUERY);
    const lid = searchParams.get("lead")?.trim();
    if (!rawTab && !rawLegacy && lid) {
      setOrigin("lead");
      return;
    }
    setOrigin(normalizeAdmissionTab(rawTab, rawLegacy));
  }, [searchParams]);

  useEffect(() => {
    if (!preselectedLeadId || leadPrefilled) return;
    const p = new URLSearchParams(searchParams.toString());
    p.set(TAB_QUERY, "lead");
    p.delete(LEGACY_TAB_QUERY);
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
      setFacilityPanel(null);
      setLoadingRefs(false);
      return;
    }
    setLoadingRefs(true);

    const { data: fac } = await supabase
      .from("facilities")
      .select("organization_id, name, total_licensed_beds, timezone")
      .eq("id", selectedFacilityId)
      .single();

    const orgId = fac?.organization_id ?? null;
    if (fac?.name) {
      setFacilityPanel({
        name: fac.name,
        totalLicensedBeds: fac.total_licensed_beds,
        timezone: typeof fac.timezone === "string" && fac.timezone.trim() ? fac.timezone.trim() : "America/New_York",
        organizationId: orgId,
      });
    } else {
      setFacilityPanel(null);
    }

    const todayStr = format(new Date(), "yyyy-MM-dd");
    let schedule: { base_rate_private: number; base_rate_semi_private: number | null } | null = null;
    if (orgId) {
      const { data: rateRows } = await supabase
        .from("rate_schedules")
        .select("base_rate_private, base_rate_semi_private, effective_date, end_date")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("effective_date", { ascending: false })
        .limit(8);
      schedule =
        (rateRows ?? []).find((r) => {
          if (!r.effective_date || r.effective_date > todayStr) return false;
          if (r.end_date != null && String(r.end_date).trim() !== "" && r.end_date < todayStr) return false;
          return true;
        }) ?? null;
    }

    const [res, ld, bd] = await Promise.all([
      supabase
        .from("residents")
        .select("id, first_name, last_name, status, date_of_birth, created_at, referral_source_id")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .in("status", ["inquiry", "pending_admission"])
        .order("last_name"),
      supabase
        .from("referral_leads")
        .select(
          "id, first_name, last_name, preferred_name, date_of_birth, inquiry_date, updated_at, phone, email, notes, status, referral_source_id",
        )
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .not("status", "in", "(converted,lost,merged)")
        .order("last_name"),
      supabase
        .from("beds")
        .select("id, bed_label, bed_type, rooms(room_number, room_type)")
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

    const rawBeds = (bd.data ?? []) as {
      id: string;
      bed_label: string;
      bed_type: string;
      rooms: BedRoomRow | BedRoomRow[] | null;
    }[];

    const mappedBeds: BedOption[] = rawBeds.map((row) => {
      const rr = normalizeRoomJoin(row.rooms);
      const rn = rr?.room_number?.trim() || "—";
      const rt = rr?.room_type ?? "private";
      const cents = schedule
        ? monthlyRentCents(rt, schedule.base_rate_private, schedule.base_rate_semi_private ?? null)
        : null;
      const line = formatBedOptionLine(row.bed_label, rn, rt, cents);
      return {
        id: row.id,
        bed_label: row.bed_label,
        bed_type: row.bed_type,
        room: row.rooms,
        monthly_cents: cents,
        display_line: line,
      };
    });

    setResidents((res.data ?? []) as ResidentOption[]);
    setLeads((ld.data ?? []) as LeadOption[]);
    setBeds(mappedBeds);
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
        .not("status", "in", "(cancelled,draft)")
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
        .not("status", "in", "(cancelled,draft)")
        .maybeSingle();
      setExistingResidentAdmissionCaseId(data?.id ?? null);
    }
    void checkResidentCase();
  }, [origin, residentId, selectedFacilityId, supabase]);

  const duplicateBlocked = Boolean(existingAdmissionCaseId || existingResidentAdmissionCaseId);

  const prevOriginRef = useRef<AdmissionOrigin | null>(null);
  useEffect(() => {
    if (prevOriginRef.current === null) {
      prevOriginRef.current = origin;
      return;
    }
    const prev = prevOriginRef.current;
    if (prev === origin) return;
    prevOriginRef.current = origin;

    if (prev === "inquiry") setResidentId("");
    else if (prev === "lead") setReferralLeadId("");
    else if (prev === "direct") {
      setDirectFirstName("");
      setDirectLastName("");
      setDirectNameSuffix("");
      setDirectPreferredName("");
      setDirectDob("");
      setDirectGender("");
      setDirectGenderOther("");
      setDirectPhoneDisplay("");
      setDirectAdmissionSource("");
      setDirectAdmissionSourceOther("");
      setDuplicateWarningDismissed(false);
      setDuplicateCandidate(null);
      setDuplicateLookupLoading(false);
      setDirectValidationAttempted(false);
      setDirectPreviewOpen(false);
    }
  }, [origin]);

  const selectedLead = useMemo(() => leads.find((l) => l.id === referralLeadId) ?? null, [leads, referralLeadId]);

  const intakeSummarySubject = useMemo(() => {
    if (origin === "inquiry" && residentId) {
      const r = residents.find((x) => x.id === residentId);
      return r ? `${r.last_name}, ${r.first_name}` : "—";
    }
    if (origin === "lead" && referralLeadId) {
      const l = leads.find((x) => x.id === referralLeadId);
      return l ? `${l.last_name}, ${l.first_name}` : "—";
    }
    if (origin === "direct") {
      const n = `${directFirstName.trim()} ${directLastName.trim()}`.trim();
      return n || "Direct admit";
    }
    return "—";
  }, [origin, residentId, residents, referralLeadId, leads, directFirstName, directLastName]);

  const intakeSummaryMoveIn = useMemo(() => {
    const t = targetMoveIn.trim();
    if (!t) return "—";
    return formatQuietIsoForDisplay(t) || formatIsoDate(t) || t;
  }, [targetMoveIn]);

  const facilityTodayIso = useMemo(
    () => todayYmdInZone(facilityPanel?.timezone ?? "America/New_York"),
    [facilityPanel?.timezone],
  );

  const directParsed = useMemo(() => {
    if (origin !== "direct") return { success: true as const, data: null as null };
    return parseDirectAdmitForSubmit({
      firstName: directFirstName,
      lastName: directLastName,
      nameSuffix: directNameSuffix,
      preferredName: directPreferredName,
      dob: directDob,
      gender: directGender,
      genderOther: directGenderOther,
      phoneDigits: digitsOnlyNanp(directPhoneDisplay),
      source: directAdmissionSource,
      sourceOther: directAdmissionSourceOther,
    });
  }, [
    origin,
    directFirstName,
    directLastName,
    directNameSuffix,
    directPreferredName,
    directDob,
    directGender,
    directGenderOther,
    directPhoneDisplay,
    directAdmissionSource,
    directAdmissionSourceOther,
  ]);

  const directFieldErrors = useMemo(() => {
    if (origin !== "direct" || !directValidationAttempted) return {};
    if (directParsed.success) return {};
    const next: Record<string, string> = {};
    for (const issue of directParsed.error.issues) {
      const k = issue.path[0];
      if (typeof k === "string" && !next[k]) next[k] = issue.message;
    }
    return next;
  }, [origin, directValidationAttempted, directParsed]);

  const directSubmitReady = origin !== "direct" || directParsed.success;

  const canSubmitBase =
    !!selectedFacilityId &&
    isValidFacilityIdForQuery(selectedFacilityId) &&
    !!targetMoveIn.trim() &&
    moveInValidity.ok &&
    !duplicateBlocked &&
    !submitting;

  const canSubmitFinalize =
    canSubmitBase &&
    (origin === "inquiry"
      ? !!residentId
      : origin === "lead"
        ? !!referralLeadId
        : directSubmitReady);

  const submissionBlockers = useMemo(() => {
    const parts: string[] = [];
    if (submitting || duplicateBlocked) return parts;
    if (origin === "inquiry" && !residentId) parts.push("Select an inquiry resident");
    if (origin === "lead" && !referralLeadId) parts.push("Select a referral lead");
    if (origin === "direct" && !directParsed.success) {
      const seen = new Set<string>();
      for (const issue of directParsed.error.issues) {
        if (!seen.has(issue.message)) {
          seen.add(issue.message);
          parts.push(issue.message);
        }
      }
    }
    if (!targetMoveIn.trim()) parts.push("Set target move-in date");
    else if (!moveInValidity.ok) parts.push(moveInValidity.message || "Fix target move-in date");
    return parts;
  }, [
    submitting,
    duplicateBlocked,
    origin,
    residentId,
    referralLeadId,
    directParsed,
    targetMoveIn,
    moveInValidity.ok,
    moveInValidity.message,
  ]);

  const canSaveDraft =
    !!selectedFacilityId &&
    isValidFacilityIdForQuery(selectedFacilityId) &&
    !duplicateBlocked &&
    !submitting &&
    ((origin === "inquiry" && !!residentId) ||
      (origin === "lead" && !!referralLeadId) ||
      (origin === "direct" && directParsed.success));

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
          gender: (modalGender || "prefer_not_to_say") as Database["public"]["Enums"]["gender"],
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
      setModalGender("");
      setCreateModalOpen(false);
    } finally {
      setCreatingResident(false);
    }
  }

  async function handleCreateCaseSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (origin !== "direct") {
      await finalize("submit");
      return;
    }
    const parsed = parseDirectAdmitForSubmit({
      firstName: directFirstName,
      lastName: directLastName,
      nameSuffix: directNameSuffix,
      preferredName: directPreferredName,
      dob: directDob,
      gender: directGender,
      genderOther: directGenderOther,
      phoneDigits: digitsOnlyNanp(directPhoneDisplay),
      source: directAdmissionSource,
      sourceOther: directAdmissionSourceOther,
    });
    if (!parsed.success) {
      setDirectValidationAttempted(true);
      return;
    }
    setDirectValidationAttempted(false);
    setDirectPreviewOpen(true);
  }

  async function confirmDirectAdmissionCreate() {
    setDirectPreviewOpen(false);
    await finalize("submit");
  }

  async function finalize(intent: "draft" | "submit") {
    setError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setError("Select a facility in the header.");
      return;
    }
    if (duplicateBlocked) {
      setError("This intake is already represented by an active admission case.");
      return;
    }

    if (intent === "submit") {
      if (!targetMoveIn.trim()) {
        setError("Target move-in date is required.");
        return;
      }
      if (!moveInValidity.ok) {
        setError(moveInValidity.message || "Target move-in date is not valid.");
        return;
      }
      if (!canSubmitFinalize) return;
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
      let admissionCaseSource: Database["public"]["Enums"]["admission_case_source"] | null = null;
      let admissionCaseSourceOther: string | null = null;

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
        if (intent === "submit") {
          await supabase
            .from("referral_leads")
            .update({ converted_resident_id: finalResidentId, updated_by: user.id })
            .eq("id", referralLeadId);
        }
      } else {
        const parsed = parseDirectAdmitForSubmit({
          firstName: directFirstName,
          lastName: directLastName,
          nameSuffix: directNameSuffix,
          preferredName: directPreferredName,
          dob: directDob,
          gender: directGender,
          genderOther: directGenderOther,
          phoneDigits: digitsOnlyNanp(directPhoneDisplay),
          source: directAdmissionSource,
          sourceOther: directAdmissionSourceOther,
        });
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? "Fix resident intake fields.");
          return;
        }
        const d = parsed.data;
        const phoneDigits = digitsOnlyNanp(directPhoneDisplay);
        const srcTok = d.source.trim();
        let referral_source_row: string | null = null;
        let admission_source_col: string | null = null;
        if (srcTok.startsWith("src:")) {
          referral_source_row = srcTok.slice(4);
        } else if (srcTok === "other") {
          admission_source_col = (d.sourceOther ?? "").trim() || null;
        } else {
          admission_source_col = admissionSourceLabel(srcTok as DirectAdmissionSourceValue);
        }
        const { data: newRes, error: resErr } = await supabase
          .from("residents")
          .insert({
            facility_id: selectedFacilityId,
            organization_id: fac.organization_id,
            first_name: d.firstName.trim(),
            last_name: d.lastName.trim(),
            name_suffix: d.nameSuffix?.trim() || null,
            preferred_name: d.preferredName?.trim() || null,
            date_of_birth: d.dob.trim(),
            gender: d.gender as Database["public"]["Enums"]["gender"],
            gender_other: d.gender === "other" ? (d.genderOther?.trim() || null) : null,
            primary_phone: phoneDigits.length === 10 ? phoneDigits : null,
            status: "inquiry",
            referral_source_id: referral_source_row,
            admission_source: admission_source_col,
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
        if (!srcTok.startsWith("src:")) {
          admissionCaseSource = srcTok as Database["public"]["Enums"]["admission_case_source"];
          admissionCaseSourceOther =
            srcTok === "other" ? (d.sourceOther?.trim() || null) : null;
        }
      }

      const payerSrc =
        anticipatedPayerSource && ANTICIPATED_PAYER_OPTIONS.some((x) => x.value === anticipatedPayerSource)
          ? (anticipatedPayerSource as AnticipatedPayerDb)
          : null;
      const payerOtherTxt =
        payerSrc === "other" ? anticipatedPayerOther.trim() || null : null;

      const payload = {
        facility_id: selectedFacilityId,
        resident_id: finalResidentId,
        referral_lead_id: payloadLeadId,
        bed_id: intent === "draft" ? null : bedId || null,
        target_move_in_date: intent === "draft" ? (targetMoveIn.trim() || null) : targetMoveIn.trim(),
        notes: notes.trim() || null,
        intake_program_type: intakeProgramType.trim() || null,
        create_intent: intent,
        anticipated_payer_source: payerSrc,
        anticipated_payer_other: payerOtherTxt,
        ...(admissionCaseSource
          ? {
              source: admissionCaseSource,
              source_other: admissionCaseSourceOther,
            }
          : {}),
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

      if (intent === "draft") {
        toast.success("Draft saved.", { duration: 5000 });
      } else {
        const toastBed = bedId ? "Bed reserved." : "Bed pending.";
        toast.success(`Case opened. ${toastBed}`, { duration: 6000 });
      }
      router.push(`/admin/admissions/${result.id}`);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  const noFacility = !selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId);

  const inquiryEmpty = origin === "inquiry" && residents.length === 0 && !loadingRefs;
  const leadEmpty = origin === "lead" && leads.length === 0 && !loadingRefs;
  const showCaseDetails = origin === "direct" || (!inquiryEmpty && !leadEmpty);

  const directIntakeHref = useMemo(() => {
    const p = new URLSearchParams(searchParams.toString());
    p.set(TAB_QUERY, "direct");
    p.delete(LEGACY_TAB_QUERY);
    p.delete("lead");
    p.delete(RESIDENT_QUERY);
    return `/admin/admissions/new?${p.toString()}`;
  }, [searchParams]);

  const readmitFromDuplicateHref = useMemo(() => {
    if (!duplicateCandidate?.id) {
      const p = new URLSearchParams();
      p.set(TAB_QUERY, "inquiry");
      return `/admin/admissions/new?${p.toString()}`;
    }
    const p = new URLSearchParams(searchParams.toString());
    p.set(TAB_QUERY, "inquiry");
    p.set(RESIDENT_QUERY, duplicateCandidate.id);
    p.delete("lead");
    p.delete(LEGACY_TAB_QUERY);
    return `/admin/admissions/new?${p.toString()}`;
  }, [duplicateCandidate, searchParams]);

  const pathTab = (value: AdmissionOrigin, label: string, count: number | null) => {
    const active = origin === value;
    const mutedZero =
      typeof count === "number" && count === 0 && !active && value !== "direct";

    const text = count === null ? label : `${label} (${count})`;

    return (
      <button
        key={value}
        type="button"
        role="radio"
        aria-checked={active}
        onClick={() => commitAdmissionTab(value)}
        className={cn(
          "flex items-center rounded-md border px-3 py-2 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          mutedZero ? "opacity-70" : "",
          active
            ? "border-border bg-muted/70 text-foreground ring-1 ring-border/80 border-b-2 border-b-primary rounded-b-sm"
            : cn(
                "border-transparent bg-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                mutedZero ? "text-muted-foreground/80" : "",
              ),
        )}
      >
        <span>{text}</span>
      </button>
    );
  };

  return (
    <TooltipProvider delay={300}>
      <div className="mx-auto max-w-[1040px] space-y-8 px-4 pb-14">
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
          facilityDisplayName ? (
            <>
              Start the intake workflow for a resident at <span className="text-foreground">{facilityDisplayName}</span>.
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
        <form
          onSubmit={(e) => void handleCreateCaseSubmit(e)}
          className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-10"
          noValidate
        >
          <div className="flex w-full max-w-[640px] shrink-0 flex-col gap-8">
            <div className="flex flex-col gap-8">
            <div>
              <p className="mb-3 text-[12px] font-medium uppercase tracking-wide text-muted-foreground">Path</p>
              <div
                role="radiogroup"
                aria-label="Admission path"
                className="flex flex-wrap gap-2 rounded-lg border border-border bg-muted/20 p-1.5"
              >
                {pathTab("inquiry", "Existing inquiry", residents.length)}
                {pathTab("lead", "Referral lead", leads.length)}
                {pathTab("direct", "Direct admit", null)}
              </div>
            </div>

            <div className="h-px w-full bg-border" aria-hidden />

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

          {origin === "inquiry" ? (
            <div className="space-y-6">
              {inquiryEmpty ? (
                <div className="rounded-lg border border-dashed border-border bg-muted/25 px-5 py-8 text-center space-y-4">
                  <p className="text-[13px] font-medium text-foreground">No inquiry residents available.</p>
                  <p className="text-[12px] text-muted-foreground leading-relaxed max-w-md mx-auto">
                    To use an existing record, set inquiry status on a current resident first.
                  </p>
                  <Link
                    href={directIntakeHref}
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-2 inline-flex")}
                  >
                    + Create new resident
                  </Link>
                </div>
              ) : (
                <>
                  <div className="h-px w-full bg-border" aria-hidden />
                  <div className="space-y-2">
                    <Label htmlFor="resident-combobox" className="text-[13px]">
                      Resident
                      <RequiredMark />
                    </Label>
                    <Popover open={residentOpen} onOpenChange={setResidentOpen}>
                      <PopoverTrigger
                        id="resident-combobox"
                        type="button"
                        disabled={loadingRefs}
                        onFocus={() => {
                          if (!loadingRefs) setResidentOpen(true);
                        }}
                        className={cn(
                          buttonVariants({ variant: "outline", size: "sm" }),
                          "h-10 w-full justify-between px-3 font-normal",
                        )}
                        aria-required
                      >
                        <span className={cn("min-w-0 flex-1 truncate text-left", !selectedResidentLabel && "text-muted-foreground")}>
                          {selectedResidentLabel || "Search inquiry residents..."}
                        </span>
                        <ChevronDown className="size-4 shrink-0 opacity-70" aria-hidden />
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
                                  value={residentPickerLine(r, referralSources)}
                                  onSelect={() => {
                                    setResidentId(r.id);
                                    setResidentOpen(false);
                                  }}
                                >
                                  <span className="whitespace-normal leading-snug">{residentPickerLine(r, referralSources)}</span>
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
                </>
              )}
            </div>
          ) : null}

          {origin === "lead" ? (
            <div className="space-y-6">
              {leadEmpty ? (
                <div className="rounded-lg border border-dashed border-border bg-muted/25 px-5 py-8 space-y-4 text-center">
                  <p className="text-[13px] leading-relaxed text-muted-foreground">
                    No active referral leads at {facilityDisplayName ?? "this facility"}.{" "}
                    <span className="text-foreground">→</span>{" "}
                    <Link href="/pipeline/referrals/new" className="font-medium text-primary underline-offset-4 hover:underline">
                      Add a referral lead in CRM
                    </Link>
                  </p>
                </div>
              ) : (
                <>
                  <div className="h-px w-full bg-border" aria-hidden />
                  <div className="space-y-2">
                    <Label htmlFor="lead-combobox" className="text-[13px] font-medium">
                      Referral lead
                      <RequiredMark />
                    </Label>
                    <Popover open={leadOpen} onOpenChange={setLeadOpen}>
                      <PopoverTrigger
                        id="lead-combobox"
                        type="button"
                        disabled={loadingRefs}
                        aria-haspopup="dialog"
                        aria-expanded={leadOpen}
                        aria-required={true}
                        onFocus={() => {
                          if (!loadingRefs) setLeadOpen(true);
                        }}
                        className={cn(
                          buttonVariants({ variant: "outline", size: "sm" }),
                          "h-10 w-full justify-between border-primary/25 bg-card px-3 font-normal shadow-sm ring-1 ring-primary/25",
                        )}
                      >
                        <span className={cn("min-w-0 flex-1 truncate text-left", !selectedLeadLabel && "text-muted-foreground")}>
                          {selectedLeadLabel || "Pick an active referral lead…"}
                        </span>
                        <ChevronDown className="size-4 shrink-0 opacity-80" aria-hidden />
                      </PopoverTrigger>
                      <PopoverContent className="w-[min(100vw-2rem,440px)] p-0" align="start">
                        <Command>
                          <CommandInput placeholder="Search by name, source, or stage…" />
                          <CommandList>
                            <CommandEmpty>No matching leads.</CommandEmpty>
                            <CommandGroup heading="Active referral leads">
                              {leads.map((l) => (
                                <CommandItem
                                  key={l.id}
                                  value={`${leadComboboxLine(l, referralSources)} · ${l.id}`}
                                  onSelect={() => {
                                    setReferralLeadId(l.id);
                                    setLeadOpen(false);
                                  }}
                                >
                                  <span className="whitespace-normal leading-snug">{leadComboboxLine(l, referralSources)}</span>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    <p className="text-[12px] text-muted-foreground">
                      {leads.length} active referral lead{leads.length === 1 ? "" : "s"} at{" "}
                      {facilityDisplayName ?? "this facility"}.
                    </p>
                    {selectedLead ? (
                      <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-3 text-[12px] leading-relaxed">
                        <dl className="grid gap-2 sm:grid-cols-2">
                          <div className="space-y-0.5">
                            <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Source</dt>
                            <dd className="text-foreground">{referralSourceLookup(referralSources, selectedLead.referral_source_id) ?? "—"}</dd>
                          </div>
                          <div className="space-y-0.5">
                            <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Lead contact</dt>
                            <dd className="text-foreground">{leadContactLine(selectedLead)}</dd>
                          </div>
                          <div className="space-y-0.5">
                            <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Original inquiry</dt>
                            <dd className="tabular-nums text-foreground">{formatIsoDate(selectedLead.inquiry_date) ?? "—"}</dd>
                          </div>
                          <div className="space-y-0.5">
                            <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Last contact</dt>
                            <dd className="tabular-nums text-foreground">
                              {selectedLead.updated_at
                                ? formatIsoDate(selectedLead.updated_at.slice(0, 10)) ?? selectedLead.updated_at.slice(0, 10)
                                : "—"}
                            </dd>
                          </div>
                        </dl>
                        <div className="mt-3 border-t border-primary/10 pt-2">
                          <Link
                            href={`/pipeline/referrals/${selectedLead.id}`}
                            className="inline-flex text-[12px] font-medium text-primary underline-offset-4 hover:underline"
                          >
                            View full lead in CRM ↗
                          </Link>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          ) : null}

          {origin === "direct" ? (
            <>
              <div className="h-px w-full bg-border" aria-hidden />
              <div className="space-y-8">
                <div className="space-y-6">
                  <IntakeSectionTitle>Resident details</IntakeSectionTitle>

                  <div className="flex flex-wrap gap-4">
                    <div className="w-[280px] max-w-full space-y-2">
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
                        aria-invalid={Boolean(directFieldErrors.firstName)}
                        aria-describedby={directFieldErrors.firstName ? "dir-fn-err" : undefined}
                      />
                      {directFieldErrors.firstName ? (
                        <p id="dir-fn-err" className="text-[12px] text-destructive" role="alert">
                          {directFieldErrors.firstName}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-end gap-4">
                    <div className="w-[280px] max-w-full space-y-2">
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
                        aria-invalid={Boolean(directFieldErrors.lastName)}
                        aria-describedby={directFieldErrors.lastName ? "dir-ln-err" : undefined}
                      />
                      {directFieldErrors.lastName ? (
                        <p id="dir-ln-err" className="text-[12px] text-destructive" role="alert">
                          {directFieldErrors.lastName}
                        </p>
                      ) : null}
                    </div>
                    <div className="w-[60px] shrink-0 space-y-2">
                      <Label htmlFor="dir-suffix" className="text-[13px]">
                        Suffix <span className="font-normal text-muted-foreground">(optional)</span>
                      </Label>
                      <Input
                        id="dir-suffix"
                        list="dir-suffix-options"
                        maxLength={32}
                        value={directNameSuffix}
                        onChange={(e) => setDirectNameSuffix(e.target.value)}
                        placeholder="Jr."
                        autoComplete="honorific-suffix"
                        className="w-full px-2 text-[13px]"
                      />
                      <datalist id="dir-suffix-options">
                        {NAME_SUFFIX_PRESETS.map((s) => (
                          <option key={s} value={s} />
                        ))}
                      </datalist>
                    </div>
                  </div>

                  <div className="w-[min(100%,584px)] space-y-2">
                    <Label htmlFor="dir-preferred" className="text-[13px]">
                      Preferred name <span className="font-normal text-muted-foreground">(optional)</span>
                    </Label>
                    <Input
                      id="dir-preferred"
                      value={directPreferredName}
                      onChange={(e) => setDirectPreferredName(e.target.value)}
                      maxLength={120}
                      placeholder="What they like to be called"
                    />
                  </div>

                  <div className="flex flex-wrap gap-8">
                    <div className="space-y-2">
                      <Label htmlFor="dir-dob" className="text-[13px]">
                        Date of birth
                        <RequiredMark />
                      </Label>
                      <QuietDatePicker
                        id="dir-dob"
                        mode="dob"
                        value={directDob}
                        onValueChange={setDirectDob}
                        calendarIconAlign="end"
                        aria-required
                        aria-invalid={Boolean(directFieldErrors.dob)}
                        aria-describedby={directFieldErrors.dob ? "dir-dob-err" : undefined}
                        className="w-[220px]"
                      />
                      {directFieldErrors.dob ? (
                        <p id="dir-dob-err" className="text-[12px] text-destructive" role="alert">
                          {directFieldErrors.dob}
                        </p>
                      ) : null}
                    </div>
                    <div className="min-w-[220px] flex-1 space-y-2">
                      <Label htmlFor="dir-gender" className="text-[13px]">
                        Gender
                        <RequiredMark />
                      </Label>
                      <Select
                        value={directGender || undefined}
                        onValueChange={(v) => setDirectGender(v)}
                        required
                      >
                        <SelectTrigger
                          id="dir-gender"
                          aria-required
                          aria-invalid={Boolean(directFieldErrors.gender)}
                          aria-describedby={directFieldErrors.gender ? "dir-gender-err" : undefined}
                        >
                          <SelectValue placeholder="Select…" />
                        </SelectTrigger>
                        <SelectContent position="popper">
                          {GENDERS.map((g) => (
                            <SelectItem key={g.value} value={g.value}>
                              {g.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {directFieldErrors.gender ? (
                        <p id="dir-gender-err" className="text-[12px] text-destructive" role="alert">
                          {directFieldErrors.gender}
                        </p>
                      ) : null}
                      {directGender === "other" ? (
                        <Textarea
                          value={directGenderOther}
                          onChange={(e) => setDirectGenderOther(e.target.value)}
                          placeholder="Optional detail (how the resident identifies)"
                          rows={2}
                          className="text-[13px]"
                        />
                      ) : null}
                    </div>
                  </div>

                  <div className="w-[min(100%,320px)] space-y-2">
                    <Label htmlFor="dir-phone" className="text-[13px]">
                      Phone <span className="font-normal text-muted-foreground">(optional)</span>
                    </Label>
                    <Input
                      id="dir-phone"
                      inputMode="numeric"
                      autoComplete="tel"
                      placeholder="(555) 555-5555"
                      value={directPhoneDisplay}
                      onChange={(e) => setDirectPhoneDisplay(formatUsPhoneMask(e.target.value))}
                      className="tabular-nums"
                    />
                    <p className="text-[12px] text-muted-foreground">
                      Resident or primary family contact. Used for follow-up before full intake.
                    </p>
                  </div>
                </div>
              </div>
            </>
          ) : null}

          {showCaseDetails ? (
            <>
              <div className={cn("h-px w-full bg-border", origin === "direct" && "mt-8")} aria-hidden />
              <div className="space-y-8">
                {origin === "direct" ? (
                  <IntakeSectionTitle>Case details</IntakeSectionTitle>
                ) : (
                  <p className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">Case details</p>
                )}

                {origin === "direct" ? (
                  <div className="space-y-2">
                    <Label htmlFor="dir-case-source" className="text-[13px]">
                      Admission source
                      <RequiredMark />
                    </Label>
                    <Select
                      value={directAdmissionSource || undefined}
                      onValueChange={(v) => setDirectAdmissionSource(v as DirectAdmissionSourceValue)}
                    >
                      <SelectTrigger
                        id="dir-case-source"
                        aria-required
                        aria-invalid={Boolean(directFieldErrors.source)}
                        aria-describedby={directFieldErrors.source ? "dir-case-source-err" : undefined}
                      >
                        <SelectValue placeholder="Select…" />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        {DIRECT_ADMISSION_SOURCES.map((s) => (
                          <SelectItem key={s.value} value={s.value}>
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {directFieldErrors.source ? (
                      <p id="dir-case-source-err" className="text-[12px] text-destructive" role="alert">
                        {directFieldErrors.source}
                      </p>
                    ) : null}
                    {directAdmissionSource === "other" ? (
                      <Textarea
                        id="dir-case-source-other"
                        value={directAdmissionSourceOther}
                        onChange={(e) => setDirectAdmissionSourceOther(e.target.value)}
                        placeholder="Describe the admission source"
                        rows={3}
                        aria-invalid={Boolean(directFieldErrors.sourceOther)}
                        aria-describedby={directFieldErrors.sourceOther ? "dir-case-source-other-err" : undefined}
                        className="text-[13px]"
                      />
                    ) : null}
                    {directFieldErrors.sourceOther ? (
                      <p id="dir-case-source-other-err" className="text-[12px] text-destructive" role="alert">
                        {directFieldErrors.sourceOther}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {origin === "inquiry" ? (
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
                ) : null}

                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Label htmlFor="bed-combobox" className="text-[13px]">
                      Bed <span className="font-normal text-muted-foreground">(optional)</span>
                    </Label>
                    <Tooltip>
                      <TooltipTrigger
                        type="button"
                        className="rounded-sm text-muted-foreground hover:text-foreground"
                        aria-label="Bed reservation information"
                      >
                        <Info className="size-3.5" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs text-left text-[12px]" side="top">
                        Selecting reserves the bed immediately. You can change later from the resident profile.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Popover open={bedOpen} onOpenChange={setBedOpen}>
                    <PopoverTrigger
                      id="bed-combobox"
                      type="button"
                      disabled={loadingRefs}
                      onFocus={() => {
                        if (!loadingRefs) setBedOpen(true);
                      }}
                      className={cn(
                        buttonVariants({ variant: "outline", size: "sm" }),
                        "h-10 w-full justify-between border-border bg-muted/25 px-3 font-normal",
                      )}
                    >
                      <span className={cn("min-w-0 flex-1 truncate text-left", !selectedBedLabel && "text-muted-foreground")}>
                        {selectedBedLabel || "Select an open bed…"}
                      </span>
                      <ChevronDown className="size-4 shrink-0 opacity-70" aria-hidden />
                    </PopoverTrigger>
                    <PopoverContent className="w-[min(100vw-2rem,440px)] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search beds…" />
                        <CommandList>
                          <CommandEmpty>No matching beds.</CommandEmpty>
                          <CommandGroup heading="Open beds">
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
                                value={b.display_line}
                                onSelect={() => {
                                  setBedId(b.id);
                                  setBedOpen(false);
                                }}
                              >
                                <span className="whitespace-normal leading-snug">{b.display_line}</span>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  {selectedBedChoice && bedId ? (
                    <p className="text-[12px] text-muted-foreground" role="status">
                      ✓ {bedTitling(selectedBedChoice.bed_label)} will be reserved on Create.
                    </p>
                  ) : null}
                  <p className="text-[12px] text-muted-foreground">
                    {facilityDisplayName
                      ? `${beds.length} beds open at ${facilityDisplayName}. Selecting one reserves it.`
                      : `${beds.length} beds open at this facility. Selecting one reserves it.`}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="adm-target-move-in" className="text-[13px]">
                    Target move-in date
                    <RequiredMark />
                  </Label>
                  <QuietDatePicker
                    id="adm-target-move-in"
                    value={targetMoveIn}
                    onValueChange={setTargetMoveIn}
                    mode="move_in"
                    initialVisibleMonthIso={facilityTodayIso}
                    calendarIconAlign="end"
                    aria-required
                    aria-invalid={!moveInValidity.ok && Boolean(targetMoveIn.trim())}
                  />
                  {targetMoveIn.trim() ? (
                    <p className="text-[12px] text-muted-foreground">
                      <span className="font-mono tabular-nums text-foreground">
                        {formatQuietIsoForDisplay(targetMoveIn.trim())}
                      </span>
                      {" — "}
                      {format(parseISO(`${targetMoveIn.trim()}T12:00:00`), "MMMM d, yyyy")}
                    </p>
                  ) : null}
                  {!moveInValidity.ok && targetMoveIn.trim() ? (
                    <p className="text-[12px] text-destructive" role="alert">
                      {moveInValidity.message}
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
                    Choose based on the resident&apos;s expected length of stay and care needs.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="adm-payer" className="text-[13px]">
                    Anticipated payer source <span className="font-normal text-muted-foreground">(optional)</span>
                  </Label>
                  <Select
                    value={anticipatedPayerSource ? anticipatedPayerSource : OPTIONAL_PAYER_NONE}
                    onValueChange={(v) => setAnticipatedPayerSource(v === OPTIONAL_PAYER_NONE ? "" : v)}
                  >
                    <SelectTrigger id="adm-payer">
                      <SelectValue placeholder="Select anticipated payer..." />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      <SelectItem value={OPTIONAL_PAYER_NONE}>None</SelectItem>
                      {ANTICIPATED_PAYER_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[12px] text-muted-foreground">
                    Used to estimate rates and route follow-ups. Final payer setup happens after case creation.
                  </p>
                  {anticipatedPayerSource === "other" ? (
                    <Textarea
                      value={anticipatedPayerOther}
                      onChange={(e) => setAnticipatedPayerOther(e.target.value)}
                      placeholder="Describe other payer source"
                      rows={3}
                      className="text-[13px]"
                    />
                  ) : null}
                </div>

                <div className="relative space-y-2">
                  <Label htmlFor="adm-notes" className="text-[13px]">
                    Notes <span className="font-normal text-muted-foreground">(optional)</span>
                  </Label>
                  <Textarea
                    id="adm-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="What should the team know?"
                    rows={4}
                    className="min-h-[6rem] max-h-[18rem] resize-y overflow-auto pr-6 pb-6 text-[13px] [resize:vertical] [&::-webkit-resizer]:hidden"
                  />
                  <GripHorizontal
                    className="pointer-events-none absolute bottom-2 right-2 size-4 text-muted-foreground/60"
                    aria-hidden
                  />
                  <p className="text-[12px] text-muted-foreground">
                    Reason for admission, payer details, family preferences.
                  </p>
                </div>
              </div>
            </>
          ) : null}

          {error ? (
            <p className="text-[13px] text-destructive" role="alert">
              {error}
            </p>
          ) : null}
            </div>

            <div className="sticky bottom-0 z-30 -mx-2 space-y-3 border-t border-border bg-background/95 px-2 py-4 shadow-[0_-10px_28px_-14px_rgba(0,0,0,0.18)] backdrop-blur supports-[backdrop-filter]:bg-background/90 sm:-mx-3 sm:rounded-b-lg sm:px-3">
              <p className="text-[11px] text-muted-foreground" aria-live="polite">
                Creating case for{" "}
                <span className="font-medium text-foreground">{intakeSummarySubject}</span>
                <span className="text-muted-foreground"> · </span>
                Move-in <span className="font-medium tabular-nums text-foreground">{intakeSummaryMoveIn}</span>
              </p>
              {origin === "direct" && duplicateLookupLoading ? (
                <p className="text-[12px] text-muted-foreground" role="status">
                  Checking for similar residents…
                </p>
              ) : null}

              {origin === "direct" && duplicateCandidate && !duplicateWarningDismissed && !duplicateLookupLoading ? (
                <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-3 text-[13px] text-foreground">
                  <div className="flex gap-3">
                    <AlertTriangle
                      className="mt-0.5 size-4 shrink-0 text-amber-800 dark:text-amber-300"
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <p>
                          <span aria-hidden className="mr-1">
                            ⚠
                          </span>
                          <span className="font-medium">Possible duplicate:</span>{" "}
                          {duplicateResidentHumanSummary(duplicateCandidate)}
                        </p>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
                          aria-label="Dismiss duplicate warning"
                          onClick={() => setDuplicateWarningDismissed(true)}
                        >
                          <X className="size-4" aria-hidden />
                        </Button>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-2 text-[13px] font-medium">
                        <Link href={readmitFromDuplicateHref} className="text-primary underline-offset-4 hover:underline">
                          Re-admit instead
                        </Link>
                        <Link
                          href={`/admin/residents/${duplicateCandidate.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary underline-offset-4 hover:underline"
                        >
                          View record
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
              <div className="flex w-full flex-wrap justify-end gap-2">
              <Link
                href="/pipeline/recent-admissions"
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex min-w-[88px] items-center justify-center")}
              >
                Cancel
              </Link>
              <Button
                variant="outline"
                type="button"
                size="sm"
                className="min-w-[112px]"
                disabled={!canSaveDraft || submitting}
                onClick={() => void finalize("draft")}
              >
                Save draft
              </Button>
              {!canSubmitFinalize ? (
                <Button
                  type="submit"
                  disabled
                  className="min-w-[140px]"
                  aria-describedby={
                    submissionBlockers.length ? "admissions-create-case-blockers" : undefined
                  }
                >
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                      Saving…
                    </>
                  ) : (
                    "Create case"
                  )}
                </Button>
              ) : (
                <Button type="submit" disabled={submitting} className="min-w-[140px]">
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                      Saving…
                    </>
                  ) : (
                    "Create case"
                  )}
                </Button>
              )}
            </div>
            {!canSubmitFinalize && submissionBlockers.length > 0 ? (
              <p
                id="admissions-create-case-blockers"
                className="max-w-xl self-end text-right text-[12px] text-muted-foreground"
              >
                {submissionBlockers.join(" · ")}
              </p>
            ) : null}
            </div>
          </div>

          <aside
            className="w-full max-w-[320px] shrink-0 space-y-5 rounded-xl border border-border bg-muted/15 p-4 text-[13px] lg:sticky lg:top-6"
            aria-label="Facility intake context"
          >
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Facility</p>
              <p className="mt-1 text-[15px] font-semibold text-foreground">{facilityDisplayName ?? "—"}</p>
            </div>
            <div className="h-px w-full bg-border" aria-hidden />
            <div className="space-y-1">
              <p className="text-[12px] font-medium text-foreground">Capacity</p>
              <p className="text-[13px] text-muted-foreground">
                <span className="font-medium text-foreground">{beds.length}</span> open beds ·{" "}
                <span className="font-medium text-foreground">{facilityPanel?.totalLicensedBeds ?? "—"}</span> licensed
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Pending inquiries</span>
                <span className="font-semibold tabular-nums text-foreground">{residents.length}</span>
              </div>
              <Link href="/admin/residents" className="text-[12px] font-medium text-primary hover:underline">
                View residents list
              </Link>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Active referral leads</span>
                <span className="font-semibold tabular-nums text-foreground">{leads.length}</span>
              </div>
              <Link href="/admin/referrals" className="text-[12px] font-medium text-primary hover:underline">
                Open referrals CRM
              </Link>
            </div>
            <div className="h-px w-full bg-border" aria-hidden />
            <div className="space-y-2">
              <p className="text-[12px] font-semibold text-foreground">Steps after case creation</p>
              <ol className="list-decimal space-y-1.5 pl-4 text-[12px] text-muted-foreground">
                <li>Reserve bed</li>
                <li>Payer source</li>
                <li>Family contacts</li>
                <li>Initial care plan</li>
              </ol>
              <p className="text-[12px] text-muted-foreground">Typical time-to-complete: 25–40 min</p>
            </div>
          </aside>
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
              <QuietDatePicker id="modal-dob" mode="dob" value={modalDob} onValueChange={setModalDob} calendarIconAlign="end" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="modal-gender">Gender</Label>
              <Select value={modalGender || undefined} onValueChange={setModalGender}>
                <SelectTrigger id="modal-gender">
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

      <Dialog open={directPreviewOpen} onOpenChange={setDirectPreviewOpen}>
        <DialogContent className="bg-card sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Confirm intake</DialogTitle>
            <DialogDescription>
              Review before creating the resident profile and admission case. This action will be logged.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2 text-[13px] text-muted-foreground">
            <p className="font-medium text-foreground">You&apos;re about to create:</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <span className="text-foreground">New resident:</span>{" "}
                {[directFirstName.trim(), directLastName.trim()].filter(Boolean).join(" ")}
                {directNameSuffix.trim() ? ` ${directNameSuffix.trim()}` : ""}, born{" "}
                <span className="font-mono tabular-nums">
                  {directDob.trim() ? formatQuietIsoForDisplay(directDob.trim()) : "—"}
                </span>
                , {directGender ? genderDisplayLabel(directGender) : "—"}
              </li>
              <li>
                <span className="text-foreground">New admission case at</span> {facilityDisplayName ?? "—"}
              </li>
              <li>
                <span className="text-foreground">Target move-in:</span>{" "}
                <span className="font-mono tabular-nums">
                  {targetMoveIn.trim() ? formatQuietIsoForDisplay(targetMoveIn.trim()) : "—"}
                </span>
              </li>
              <li>
                <span className="text-foreground">Source:</span>{" "}
                {directAdmissionSource
                  ? admissionSourceLabel(directAdmissionSource as DirectAdmissionSourceValue)
                  : "—"}
              </li>
            </ul>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setDirectPreviewOpen(false)}>
              Back to form
            </Button>
            <Button type="button" size="sm" disabled={submitting} onClick={() => void confirmDirectAdmissionCreate()}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                  Saving…
                </>
              ) : (
                "Confirm and create"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </TooltipProvider>
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
