"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Brain,
  ClipboardList,
  CreditCard,
  FileText,
  HeartPulse,
  ListChecks,
  MapPin,
  Phone,
  Shield,
  Stethoscope,
  User,
  Utensils,
} from "lucide-react";

import { adlTypeLabel, assistanceLabel } from "@/lib/caregiver/adl-form-options";

import { AdminLiveDataFallbackNotice, AdminTableLoadingState } from "@/components/common/admin-list-patterns";
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
        {error ? <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} /> : null}
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
            {detail.photoUrl ? (
              <Avatar className="h-16 w-16 ring-2 ring-slate-200 dark:ring-slate-700">
                <AvatarImage src={detail.photoUrl} alt={detail.fullName} />
                <AvatarFallback className="bg-brand-100 text-lg font-medium text-brand-900 dark:bg-brand-900 dark:text-brand-100">
                  {detail.initials}
                </AvatarFallback>
              </Avatar>
            ) : (
              <div
                className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-slate-200 text-lg font-medium text-slate-600 ring-2 ring-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:ring-slate-700"
                aria-hidden
              >
                {detail.fullName.charAt(0).toUpperCase()}
              </div>
            )}
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
          <div className="flex flex-wrap justify-end gap-2">
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
            <Link
              href={`/admin/residents/${detail.id}/billing`}
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "inline-flex gap-2 border-slate-200 dark:border-slate-700",
              )}
            >
              <CreditCard className="h-3.5 w-3.5" />
              Billing
            </Link>
          </div>
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

        <Card className="border-slate-200/70 shadow-soft dark:border-slate-800 lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-display text-lg">
              <ListChecks className="h-4 w-4 text-brand-600" />
              Recent daily notes &amp; ADL
            </CardTitle>
            <CardDescription>Latest documentation from the floor (RLS-scoped to your organization)</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                <FileText className="h-4 w-4 text-slate-500" />
                Daily log notes
              </div>
              {detail.recentDailyNotes.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">No daily log rows yet.</p>
              ) : (
                <ul className="space-y-3">
                  {detail.recentDailyNotes.map((row) => (
                    <li
                      key={row.id}
                      className="rounded-lg border border-slate-200/80 bg-slate-50/80 p-3 text-sm dark:border-slate-700 dark:bg-slate-900/40"
                    >
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {row.logDate} · {row.shift} · {row.loggedByLabel}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-slate-800 dark:text-slate-200">{row.snippet}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                <ListChecks className="h-4 w-4 text-slate-500" />
                ADL passes
              </div>
              {detail.recentAdl.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">No ADL entries yet.</p>
              ) : (
                <ul className="space-y-3">
                  {detail.recentAdl.map((row) => (
                    <li
                      key={row.id}
                      className="rounded-lg border border-slate-200/80 bg-slate-50/80 p-3 text-sm dark:border-slate-700 dark:bg-slate-900/40"
                    >
                      <p className="font-medium text-slate-800 dark:text-slate-200">{row.summary}</p>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {row.logTimeLabel} · {row.shift} · {row.logDate} · {row.loggedByLabel}
                      </p>
                      {row.detailNote ? (
                        <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">{row.detailNote}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200/70 shadow-soft dark:border-slate-800 lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-display text-lg">
              <Brain className="h-4 w-4 text-brand-600" />
              Behavior &amp; condition reports
            </CardTitle>
            <CardDescription>Recent behavioral events and reported condition changes from floor documentation</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                <Brain className="h-4 w-4 text-slate-500" />
                Behavioral events
              </div>
              {detail.recentBehavior.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">No behavioral log entries yet.</p>
              ) : (
                <ul className="space-y-3">
                  {detail.recentBehavior.map((row) => (
                    <li
                      key={row.id}
                      className="rounded-lg border border-slate-200/80 bg-slate-50/80 p-3 text-sm dark:border-slate-700 dark:bg-slate-900/40"
                    >
                      <p className="font-medium text-slate-800 dark:text-slate-200">{row.typeLabel}</p>
                      <p className="mt-1 text-slate-700 dark:text-slate-300">{truncateSnippet(row.behaviorText, 320)}</p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {row.occurredLabel} · {row.shift} · {row.loggedByLabel}
                      </p>
                      {row.injuryOccurred ? (
                        <p className="mt-1 text-xs font-medium text-rose-600 dark:text-rose-400">Injury documented</p>
                      ) : null}
                      {row.notesSnippet ? (
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{row.notesSnippet}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                <Stethoscope className="h-4 w-4 text-slate-500" />
                Condition changes
              </div>
              {detail.recentConditionChanges.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">No condition change reports yet.</p>
              ) : (
                <ul className="space-y-3">
                  {detail.recentConditionChanges.map((row) => (
                    <li
                      key={row.id}
                      className="rounded-lg border border-slate-200/80 bg-slate-50/80 p-3 text-sm dark:border-slate-700 dark:bg-slate-900/40"
                    >
                      <p className="font-medium text-slate-800 dark:text-slate-200">
                        {row.typeLabel}
                        <span className="font-normal text-slate-500"> · </span>
                        <span className="capitalize text-slate-600 dark:text-slate-300">{row.severity}</span>
                      </p>
                      <p className="mt-1 text-slate-700 dark:text-slate-300">{truncateSnippet(row.description, 360)}</p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {row.reportedLabel} · {row.shift} · {row.loggedByLabel}
                        {row.nurseNotified ? (
                          <span className="text-emerald-600 dark:text-emerald-400"> · nurse notified</span>
                        ) : null}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
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
  recentDailyNotes: Array<{
    id: string;
    logDate: string;
    shift: string;
    snippet: string;
    loggedByLabel: string;
  }>;
  recentAdl: Array<{
    id: string;
    logTimeLabel: string;
    logDate: string;
    shift: string;
    summary: string;
    detailNote: string | null;
    loggedByLabel: string;
  }>;
  recentBehavior: Array<{
    id: string;
    typeLabel: string;
    behaviorText: string;
    occurredLabel: string;
    shift: string;
    loggedByLabel: string;
    injuryOccurred: boolean;
    notesSnippet: string | null;
  }>;
  recentConditionChanges: Array<{
    id: string;
    typeLabel: string;
    severity: string;
    description: string;
    reportedLabel: string;
    shift: string;
    loggedByLabel: string;
    nurseNotified: boolean;
  }>;
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

  const facilityId = resident.facility_id;
  const [dailyResult, adlResult, behaviorResult, conditionResult] = await Promise.all([
    supabase
      .from("daily_logs")
      .select("id, log_date, shift, general_notes, logged_by")
      .eq("resident_id", residentId)
      .eq("facility_id", facilityId)
      .is("deleted_at", null)
      .order("log_date", { ascending: false })
      .limit(8),
    supabase
      .from("adl_logs")
      .select("id, log_time, log_date, shift, adl_type, assistance_level, refused, notes, logged_by")
      .eq("resident_id", residentId)
      .eq("facility_id", facilityId)
      .is("deleted_at", null)
      .order("log_time", { ascending: false })
      .limit(12),
    supabase
      .from("behavioral_logs")
      .select("id, occurred_at, shift, behavior_type, behavior, injury_occurred, notes, logged_by")
      .eq("resident_id", residentId)
      .eq("facility_id", facilityId)
      .is("deleted_at", null)
      .order("occurred_at", { ascending: false })
      .limit(10),
    supabase
      .from("condition_changes")
      .select("id, reported_at, shift, change_type, description, severity, nurse_notified, reported_by")
      .eq("resident_id", residentId)
      .eq("facility_id", facilityId)
      .is("deleted_at", null)
      .order("reported_at", { ascending: false })
      .limit(10),
  ]);

  if (dailyResult.error) {
    throw dailyResult.error;
  }
  if (adlResult.error) {
    throw adlResult.error;
  }
  if (behaviorResult.error) {
    throw behaviorResult.error;
  }
  if (conditionResult.error) {
    throw conditionResult.error;
  }

  const dailyRows = dailyResult.data ?? [];
  const adlRows = adlResult.data ?? [];
  const behaviorRows = behaviorResult.data ?? [];
  const conditionRows = conditionResult.data ?? [];
  const userIds = [
    ...new Set([
      ...dailyRows.map((r) => r.logged_by),
      ...adlRows.map((r) => r.logged_by),
      ...behaviorRows.map((r) => r.logged_by),
      ...conditionRows.map((r) => r.reported_by),
    ]),
  ];
  const nameById = new Map<string, string>();
  if (userIds.length > 0) {
    const profResult = await supabase.from("user_profiles").select("id, full_name").in("id", userIds);
    if (profResult.error) {
      throw profResult.error;
    }
    for (const p of profResult.data ?? []) {
      nameById.set(p.id, p.full_name);
    }
  }

  const recentDailyNotes = dailyRows.map((r) => ({
    id: r.id,
    logDate: r.log_date,
    shift: r.shift,
    snippet: truncateSnippet(r.general_notes?.trim() || "—", 360),
    loggedByLabel: nameById.get(r.logged_by) ?? "Staff",
  }));

  const recentAdl = adlRows.map((r) => {
    const base = `${adlTypeLabel(r.adl_type)} · ${assistanceLabel(r.assistance_level)}`;
    const summary = r.refused ? `${base} · refused` : base;
    return {
      id: r.id,
      logTimeLabel: formatLogTime(r.log_time),
      logDate: r.log_date,
      shift: r.shift,
      summary,
      detailNote: r.notes?.trim() ? truncateSnippet(r.notes.trim(), 240) : null,
      loggedByLabel: nameById.get(r.logged_by) ?? "Staff",
    };
  });

  const recentBehavior = behaviorRows.map((r) => ({
    id: r.id,
    typeLabel: behaviorTypeLabel(r.behavior_type),
    behaviorText: r.behavior,
    occurredLabel: formatLogTime(r.occurred_at),
    shift: r.shift,
    loggedByLabel: nameById.get(r.logged_by) ?? "Staff",
    injuryOccurred: r.injury_occurred,
    notesSnippet: r.notes?.trim() ? truncateSnippet(r.notes.trim(), 200) : null,
  }));

  const recentConditionChanges = conditionRows.map((r) => ({
    id: r.id,
    typeLabel: conditionChangeTypeLabel(r.change_type),
    severity: r.severity,
    description: r.description,
    reportedLabel: formatLogTime(r.reported_at),
    shift: r.shift,
    loggedByLabel: nameById.get(r.reported_by) ?? "Staff",
    nurseNotified: r.nurse_notified,
  }));

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
    recentDailyNotes,
    recentAdl,
    recentBehavior,
    recentConditionChanges,
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

function truncateSnippet(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function formatLogTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

const BEHAVIOR_TYPE_LABELS: Record<string, string> = {
  agitation: "Agitation / anxiety",
  wandering: "Wandering / elopement risk",
  verbal: "Verbal outburst",
  physical: "Physical aggression",
  self_injury: "Self-injury / SIB",
  withdrawal: "Withdrawal / refusal",
  sundowning: "Sundowning",
  other: "Other",
};

function behaviorTypeLabel(value: string): string {
  return BEHAVIOR_TYPE_LABELS[value] ?? value.replace(/_/g, " ");
}

const CONDITION_TYPE_LABELS: Record<string, string> = {
  vitals: "Vitals / measurements",
  pain: "Pain",
  respiratory: "Respiratory",
  skin_wound: "Skin / wound",
  mental_status: "Mental status / cognition",
  gi: "GI / appetite",
  urinary: "Urinary",
  neurologic: "Neurologic",
  other: "Other",
};

function conditionChangeTypeLabel(value: string): string {
  return CONDITION_TYPE_LABELS[value] ?? value.replace(/_/g, " ");
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
