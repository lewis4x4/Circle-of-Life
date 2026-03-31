"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  ClipboardList,
  HeartPulse,
  MapPin,
  Phone,
  Shield,
  User,
  Utensils,
} from "lucide-react";

import { AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

type Acuity = 1 | 2 | 3;
type ResidencyStatus = "active" | "hospital" | "loa";

type SupabaseResidentRow = {
  id: string;
  facility_id: string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  date_of_birth: string | null;
  gender: string | null;
  status: string | null;
  acuity_level: string | null;
  bed_id: string | null;
  photo_url: string | null;
  primary_diagnosis: string | null;
  diagnosis_list: string[] | null;
  allergy_list: string[] | null;
  diet_order: string | null;
  code_status: string | null;
  fall_risk_level: string | null;
  primary_payer: string | null;
  responsible_party_name: string | null;
  responsible_party_relationship: string | null;
  responsible_party_phone: string | null;
  responsible_party_email: string | null;
  emergency_contact_1_name: string | null;
  emergency_contact_1_relationship: string | null;
  emergency_contact_1_phone: string | null;
  emergency_contact_2_name: string | null;
  emergency_contact_2_relationship: string | null;
  emergency_contact_2_phone: string | null;
  admission_date: string | null;
  updated_at: string | null;
};

type SupabaseBedRow = {
  id: string;
  room_id: string | null;
  bed_label: string | null;
};

type SupabaseRoomRow = {
  id: string;
  room_number: string | null;
  unit_id: string | null;
};

type SupabaseUnitRow = {
  id: string;
  name: string | null;
};

type QueryError = { message: string };
type QueryResult<T> = { data: T | null; error: QueryError | null };

export default function AdminResidentDetailPage() {
  const params = useParams();
  const rawId = params?.id;
  const residentId = typeof rawId === "string" ? rawId : Array.isArray(rawId) ? rawId[0] : "";

  const { selectedFacilityId } = useFacilityStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [detail, setDetail] = useState<ResidentDetailView | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    setDetail(null);

    const uuidOk = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      residentId,
    );
    if (!residentId || !uuidOk) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    try {
      const row = await fetchResidentDetail(residentId, selectedFacilityId);
      if (!row) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setDetail(row);
    } catch {
      setError("Live resident profile is unavailable. Try again or return to the census list.");
    } finally {
      setLoading(false);
    }
  }, [residentId, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/residents"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}
          >
            <ArrowLeft className="h-4 w-4" />
            Census
          </Link>
        </div>
        <AdminTableLoadingState />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        <Link
          href="/admin/residents"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to census
        </Link>
        <Card className="border-slate-200/70 dark:border-slate-800">
          <CardHeader>
            <CardTitle className="font-display text-xl">Resident not found</CardTitle>
            <CardDescription>
              This profile may be outside your current facility filter, removed from the census, or the link
              may be invalid.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        <Link
          href="/admin/residents"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to census
        </Link>
        {error ? (
          <Card className="border-amber-200/80 bg-amber-50/40 dark:border-amber-900/60 dark:bg-amber-950/20">
            <CardContent className="py-4 text-sm text-amber-800 dark:text-amber-200">{error}</CardContent>
          </Card>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-3">
          <Link
            href="/admin/residents"
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "inline-flex w-fit gap-1 px-0 sm:px-3",
            )}
          >
            <ArrowLeft className="h-4 w-4" />
            Census
          </Link>
          <div className="flex flex-wrap items-center gap-4">
            <Avatar className="h-16 w-16 ring-2 ring-slate-200 dark:ring-slate-700">
              <AvatarImage src={detail.photoUrl ?? `https://i.pravatar.cc/160?u=${detail.id}`} alt={detail.fullName} />
              <AvatarFallback className="bg-brand-100 text-lg font-medium text-brand-900 dark:bg-brand-900 dark:text-brand-100">
                {detail.initials}
              </AvatarFallback>
            </Avatar>
            <div>
              <h1 className="font-display text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                {detail.fullName}
              </h1>
              {detail.preferredName ? (
                <p className="text-slate-500 dark:text-slate-400">&ldquo;{detail.preferredName}&rdquo;</p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-2">
                <AcuityBadge acuity={detail.acuity} />
                <ResidentStatusBadge status={detail.status} />
                {detail.fallRiskLabel ? (
                  <Badge variant="outline" className="border-slate-300 dark:border-slate-600">
                    Fall risk: {detail.fallRiskLabel}
                  </Badge>
                ) : null}
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          <Link
            href={`/admin/residents/${detail.id}/care-plan`}
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "inline-flex gap-2 border-slate-200 dark:border-slate-700",
            )}
          >
            <ClipboardList className="h-3.5 w-3.5" />
            Care plan
          </Link>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Last updated {detail.updatedAtLabel}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-slate-200/70 shadow-soft dark:border-slate-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-display text-lg">
              <MapPin className="h-4 w-4 text-brand-600" />
              Location &amp; stay
            </CardTitle>
            <CardDescription>Bed assignment and admission context</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <DetailRow label="Room" value={detail.roomLabel} />
            <DetailRow label="Unit" value={detail.unitName} />
            <DetailRow label="Admission" value={detail.admissionLabel} />
          </CardContent>
        </Card>

        <Card className="border-slate-200/70 shadow-soft dark:border-slate-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-display text-lg">
              <User className="h-4 w-4 text-brand-600" />
              Demographics
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <DetailRow label="Date of birth" value={detail.dobLabel} />
            <DetailRow label="Gender" value={formatGender(detail.gender)} />
          </CardContent>
        </Card>

        <Card className="border-slate-200/70 shadow-soft dark:border-slate-800 lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-display text-lg">
              <HeartPulse className="h-4 w-4 text-brand-600" />
              Clinical snapshot
            </CardTitle>
            <CardDescription>High-signal fields for shift handoff (full care plan is a separate workflow)</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <DetailRow label="Primary diagnosis" value={detail.primaryDiagnosis ?? "—"} />
            <DetailRow label="Other diagnoses" value={detail.diagnosesLine} />
            <DetailRow label="Allergies" value={detail.allergiesLine} />
            <DetailRow label="Diet order" value={detail.dietOrder ?? "—"} />
            <DetailRow label="Code status" value={formatCodeStatus(detail.codeStatus)} />
          </CardContent>
        </Card>

        <Card className="border-slate-200/70 shadow-soft dark:border-slate-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-display text-lg">
              <Phone className="h-4 w-4 text-brand-600" />
              Responsible party
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <DetailRow label="Name" value={detail.responsiblePartyName ?? "—"} />
            <DetailRow label="Relationship" value={detail.responsiblePartyRelationship ?? "—"} />
            <DetailRow label="Phone" value={detail.responsiblePartyPhone ?? "—"} />
            <DetailRow label="Email" value={detail.responsiblePartyEmail ?? "—"} />
          </CardContent>
        </Card>

        <Card className="border-slate-200/70 shadow-soft dark:border-slate-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-display text-lg">
              <Shield className="h-4 w-4 text-brand-600" />
              Emergency contacts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Contact 1</p>
              <DetailRow label="Name" value={detail.emergency1Name ?? "—"} />
              <DetailRow label="Relationship" value={detail.emergency1Relationship ?? "—"} />
              <DetailRow label="Phone" value={detail.emergency1Phone ?? "—"} />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Contact 2</p>
              <DetailRow label="Name" value={detail.emergency2Name ?? "—"} />
              <DetailRow label="Relationship" value={detail.emergency2Relationship ?? "—"} />
              <DetailRow label="Phone" value={detail.emergency2Phone ?? "—"} />
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200/70 shadow-soft dark:border-slate-800 lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-display text-lg">
              <Utensils className="h-4 w-4 text-brand-600" />
              Billing (read-only)
            </CardTitle>
            <CardDescription>Primary payer classification — ledger detail stays in Billing</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            <DetailRow label="Primary payer" value={formatPayer(detail.primaryPayer)} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

type ResidentDetailView = {
  id: string;
  fullName: string;
  initials: string;
  preferredName: string | null;
  photoUrl: string | null;
  acuity: Acuity;
  status: ResidencyStatus;
  fallRiskLabel: string | null;
  updatedAtLabel: string;
  roomLabel: string;
  unitName: string;
  admissionLabel: string;
  dobLabel: string;
  gender: string | null;
  primaryDiagnosis: string | null;
  diagnosesLine: string;
  allergiesLine: string;
  dietOrder: string | null;
  codeStatus: string | null;
  primaryPayer: string | null;
  responsiblePartyName: string | null;
  responsiblePartyRelationship: string | null;
  responsiblePartyPhone: string | null;
  responsiblePartyEmail: string | null;
  emergency1Name: string | null;
  emergency1Relationship: string | null;
  emergency1Phone: string | null;
  emergency2Name: string | null;
  emergency2Relationship: string | null;
  emergency2Phone: string | null;
};

async function fetchResidentDetail(
  residentId: string,
  selectedFacilityId: string | null,
): Promise<ResidentDetailView | null> {
  const supabase = createClient();
  const residentResult = (await supabase
    .from("residents" as never)
    .select(
      [
        "id",
        "facility_id",
        "first_name",
        "middle_name",
        "last_name",
        "preferred_name",
        "date_of_birth",
        "gender",
        "status",
        "acuity_level",
        "bed_id",
        "photo_url",
        "primary_diagnosis",
        "diagnosis_list",
        "allergy_list",
        "diet_order",
        "code_status",
        "fall_risk_level",
        "primary_payer",
        "responsible_party_name",
        "responsible_party_relationship",
        "responsible_party_phone",
        "responsible_party_email",
        "emergency_contact_1_name",
        "emergency_contact_1_relationship",
        "emergency_contact_1_phone",
        "emergency_contact_2_name",
        "emergency_contact_2_relationship",
        "emergency_contact_2_phone",
        "admission_date",
        "updated_at",
      ].join(", "),
    )
    .eq("id", residentId)
    .is("deleted_at", null)
    .maybeSingle()) as unknown as QueryResult<SupabaseResidentRow>;

  if (residentResult.error) {
    throw residentResult.error;
  }
  const resident = residentResult.data;
  if (!resident) {
    return null;
  }

  if (isValidFacilityIdForQuery(selectedFacilityId) && resident.facility_id !== selectedFacilityId) {
    return null;
  }

  let bed: SupabaseBedRow | null = null;
  if (resident.bed_id) {
    const byId = (await supabase
      .from("beds" as never)
      .select("id, room_id, bed_label")
      .eq("id", resident.bed_id)
      .maybeSingle()) as unknown as QueryResult<SupabaseBedRow>;
    if (byId.error) throw byId.error;
    bed = byId.data;
  }
  if (!bed) {
    const byRes = (await supabase
      .from("beds" as never)
      .select("id, room_id, bed_label")
      .eq("current_resident_id", residentId)
      .maybeSingle()) as unknown as QueryResult<SupabaseBedRow>;
    if (byRes.error) throw byRes.error;
    bed = byRes.data;
  }

  let room: SupabaseRoomRow | null = null;
  if (bed?.room_id) {
    const roomResult = (await supabase
      .from("rooms" as never)
      .select("id, room_number, unit_id")
      .eq("id", bed.room_id)
      .maybeSingle()) as unknown as QueryResult<SupabaseRoomRow>;
    if (roomResult.error) throw roomResult.error;
    room = roomResult.data;
  }

  let unit: SupabaseUnitRow | null = null;
  if (room?.unit_id) {
    const unitResult = (await supabase
      .from("units" as never)
      .select("id, name")
      .eq("id", room.unit_id)
      .maybeSingle()) as unknown as QueryResult<SupabaseUnitRow>;
    if (unitResult.error) throw unitResult.error;
    unit = unitResult.data;
  }

  const firstName = resident.first_name ?? "";
  const lastName = resident.last_name ?? "";
  const fullName = `${firstName} ${lastName}`.trim() || "Unknown Resident";
  const initials = `${firstName[0] ?? ""}${lastName[0] ?? ""}`.toUpperCase() || "NA";
  const acuity = mapAcuity(resident.acuity_level);
  const status = mapResidencyStatus(resident.status);
  const roomLabel = room?.room_number
    ? `${room.room_number}${bed?.bed_label ? `-${bed.bed_label}` : ""}`
    : "Unassigned";
  const unitName = unit?.name ?? "Unassigned";

  return {
    id: resident.id,
    fullName,
    initials,
    preferredName: resident.preferred_name,
    photoUrl: resident.photo_url,
    acuity,
    status,
    fallRiskLabel: resident.fall_risk_level,
    updatedAtLabel: formatUpdatedAt(resident.updated_at),
    roomLabel,
    unitName,
    admissionLabel: formatAdmission(resident.admission_date),
    dobLabel: formatDob(resident.date_of_birth),
    gender: resident.gender,
    primaryDiagnosis: resident.primary_diagnosis,
    diagnosesLine: formatList(resident.diagnosis_list),
    allergiesLine: formatList(resident.allergy_list),
    dietOrder: resident.diet_order,
    codeStatus: resident.code_status,
    primaryPayer: resident.primary_payer,
    responsiblePartyName: resident.responsible_party_name,
    responsiblePartyRelationship: resident.responsible_party_relationship,
    responsiblePartyPhone: resident.responsible_party_phone,
    responsiblePartyEmail: resident.responsible_party_email,
    emergency1Name: resident.emergency_contact_1_name,
    emergency1Relationship: resident.emergency_contact_1_relationship,
    emergency1Phone: resident.emergency_contact_1_phone,
    emergency2Name: resident.emergency_contact_2_name,
    emergency2Relationship: resident.emergency_contact_2_relationship,
    emergency2Phone: resident.emergency_contact_2_phone,
  };
}

function mapAcuity(value: string | null): Acuity {
  if (value === "level_3") return 3;
  if (value === "level_2") return 2;
  return 1;
}

function mapResidencyStatus(value: string | null): ResidencyStatus {
  if (value === "hospital_hold") return "hospital";
  if (value === "loa") return "loa";
  return "active";
}

function formatUpdatedAt(value: string | null): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function formatDob(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(parsed);
}

function formatAdmission(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(parsed);
}

function formatList(items: string[] | null): string {
  if (!items?.length) return "—";
  return items.filter(Boolean).join("; ");
}

function formatGender(value: string | null): string {
  if (!value) return "—";
  return value.replace(/_/g, " ");
}

function formatCodeStatus(value: string | null): string {
  if (!value) return "—";
  return value.replace(/_/g, " ");
}

function formatPayer(value: string | null): string {
  if (!value) return "—";
  return value.replace(/_/g, " ");
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
      <span className="min-w-[8rem] text-xs font-medium uppercase tracking-wide text-slate-400">{label}</span>
      <span className="text-slate-800 dark:text-slate-200">{value}</span>
    </div>
  );
}

function AcuityBadge({ acuity }: { acuity: Acuity }) {
  if (acuity === 3) {
    return <Badge className="bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300">Acuity 3</Badge>;
  }
  if (acuity === 2) {
    return <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">Acuity 2</Badge>;
  }
  return <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">Acuity 1</Badge>;
}

function ResidentStatusBadge({ status }: { status: ResidencyStatus }) {
  const map: Record<ResidencyStatus, { label: string; className: string }> = {
    active: {
      label: "In Facility",
      className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    },
    hospital: {
      label: "Hospital",
      className: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
    },
    loa: {
      label: "LOA",
      className: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    },
  };

  return <Badge className={map[status].className}>{map[status].label}</Badge>;
}
