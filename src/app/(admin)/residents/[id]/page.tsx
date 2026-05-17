"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Brain,
  ClipboardList,
  FileText,
  Stethoscope,
  User,
  CheckCircle2,
} from "lucide-react";

import { adlTypeLabel, assistanceLabel } from "@/lib/caregiver/adl-form-options";

import { AdminLiveDataFallbackNotice, AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { BehaviorLogModal, ConditionLogModal, GeneralNoteModal } from "@/components/admin/resident-log-modals";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { UUID_STRING_RE, isValidFacilityIdForQuery } from "@/lib/supabase/env";
import {
  RecordDetailHeader,
  RecordDetailSection,
} from "@/design-system/components/record-detail";

type Acuity = 1 | 2 | 3;
type ResidencyStatus = "active" | "hospital" | "loa";

type ConditionEventContent = {
  id: string;
  typeLabel: string;
  severity: string;
  description: string;
  loggedByLabel: string;
  nurseNotified: boolean;
};

type BehaviorEventContent = {
  id: string;
  typeLabel: string;
  behaviorText: string;
  loggedByLabel: string;
  injuryOccurred: boolean;
};

type ADLEventContent = {
  id: string;
  summary: string;
  loggedByLabel: string;
};

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
  const [behaviorModalOpen, setBehaviorModalOpen] = useState(false);
  const [conditionModalOpen, setConditionModalOpen] = useState(false);
  const [generalNoteModalOpen, setGeneralNoteModalOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    setDetail(null);

    const uuidOk = UUID_STRING_RE.test(residentId);
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

  const onAfterLog = useCallback(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-6 animate-in fade-in duration-[var(--motion-duration)]">
        <div className="flex items-center gap-3">
          <Link href="/admin/residents" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}>
            <ArrowLeft className="h-4 w-4" /> Census
          </Link>
        </div>
        <AdminTableLoadingState />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="space-y-6 animate-in fade-in duration-[var(--motion-duration)]">
        <Link href="/admin/residents" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}>
          <ArrowLeft className="h-4 w-4" /> Back to census
        </Link>
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-xl">Resident not found</CardTitle>
            <CardDescription>This profile may be outside your current facility filter, removed from the census, or the link may be invalid.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="space-y-6 animate-in fade-in duration-[var(--motion-duration)]">
        <Link href="/admin/residents" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}>
          <ArrowLeft className="h-4 w-4" /> Back to census
        </Link>
        {error ? <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} /> : null}
      </div>
    );
  }

  const feedItems = [
    ...detail.recentConditionChanges.map(c => ({ type: 'condition', time: new Date(c.reportedLabel).getTime() || 0, label: c.reportedLabel, content: c })),
    ...detail.recentBehavior.map(b => ({ type: 'behavior', time: new Date(b.occurredLabel).getTime() || 0, label: b.occurredLabel, content: b })),
    ...detail.recentAdl.filter(a => a.summary.includes('refused')).map(a => ({ type: 'adl', time: new Date(a.logTimeLabel).getTime() || 0, label: a.logTimeLabel, content: a }))
  ].sort((a, b) => b.time - a.time);

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col space-y-4 animate-in fade-in duration-[var(--motion-duration)] pb-2">

      {/* HEADER */}
      <RecordDetailHeader
        title={detail.fullName}
        statusChips={
          detail.status === "hospital"
            ? <Badge variant="destructive" className="text-[10px] font-bold uppercase tracking-wider">HOSPITAL HOLD</Badge>
            : undefined
        }
        backLink={{ label: "Census", href: "/admin/residents" }}
        actions={
          <div className="flex gap-2 flex-wrap">
            {['Assessments', 'Care Plan', 'Medications', 'Vitals', 'Billing'].map(tab => (
              <Link key={tab} href={`/admin/residents/${detail.id}/${tab.toLowerCase().replace(' ', '-')}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8 text-[11px] font-medium")}>
                {tab}
              </Link>
            ))}
          </div>
        }
        className="shrink-0"
      />

      {/* ─── TOP ACTION BAR ─────────────────────────────────────────────────────── */}
      <div className="flex gap-3 pb-2 shrink-0">
        <Button
          type="button"
          onClick={() => setBehaviorModalOpen(true)}
          className="h-12 flex-1 font-medium text-sm sm:text-base"
        >
          <Brain className="mr-2 h-5 w-5" />
          <span className="hidden sm:inline">Log behavior</span>
          <span className="sm:hidden">Behavior</span>
        </Button>
        <Button
          type="button"
          onClick={() => setConditionModalOpen(true)}
          className="h-12 flex-1 font-medium text-sm sm:text-base"
        >
          <Stethoscope className="mr-2 h-5 w-5" />
          <span className="hidden sm:inline">Log condition</span>
          <span className="sm:hidden">Condition</span>
        </Button>
        <Button
          type="button"
          onClick={() => setGeneralNoteModalOpen(true)}
          className="h-12 flex-1 font-medium text-sm sm:text-base"
        >
          <FileText className="mr-2 h-5 w-5" />
          <span className="hidden sm:inline">General note</span>
          <span className="sm:hidden">Note</span>
        </Button>
      </div>

      {/* COCKPIT 3-COLUMN GRID */}
      <div className="flex-1 min-h-0 grid lg:grid-cols-12 gap-5 px-1">

        {/* LEFT COLUMN: Face Sheet */}
        <div className="lg:col-span-3 flex flex-col gap-4 h-full overflow-hidden">
          <div className="flex flex-col h-full rounded-[8px] border border-border bg-card shadow-[var(--shadow-card)] overflow-y-auto scrollbar-hide">
            <div className="bg-muted/50 border-b border-border pb-4 p-[14px]">
              <div className="flex items-start gap-4">
                <Avatar className="h-16 w-16 shadow-[var(--shadow-card)] border border-border">
                  <AvatarImage src={detail.photoUrl!} alt={detail.fullName} />
                  <AvatarFallback className="bg-muted text-muted-foreground font-medium text-lg">{detail.initials}</AvatarFallback>
                </Avatar>
                <div className="flex flex-col gap-1.5 mt-1">
                  <span className="tabular-nums text-xs text-muted-foreground">M/F: {detail.gender ? detail.gender.charAt(0).toUpperCase() : 'U'} · DOB: {detail.dobLabel}</span>
                  <ResidentStatusBadge status={detail.status} />
                  <AcuityBadge acuity={detail.acuity} />
                </div>
              </div>
            </div>
            <div className="p-[14px] space-y-5">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Code status</p>
                <p className="font-semibold text-destructive">{formatCodeStatus(detail.codeStatus)}</p>
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Allergies</p>
                {detail.allergiesLine !== "—" ? (
                  <Badge variant="destructive" className="bg-destructive/10 text-destructive border-destructive/30 hover:bg-destructive/10 border">{detail.allergiesLine}</Badge>
                ) : <span className="text-sm text-muted-foreground">NKA</span>}
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Primary Dx</p>
                <p className="text-sm font-medium text-foreground">{detail.primaryDiagnosis || "—"}</p>
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Contacts</p>
                <p className="text-sm font-medium text-foreground">{detail.emergency1Name || "—"}</p>
                <p className="text-xs text-muted-foreground">{detail.emergency1Relationship} · {detail.emergency1Phone}</p>
              </div>
            </div>
          </div>
        </div>

        {/* CENTER COLUMN: Triage Feed */}
        <div className="lg:col-span-6 flex flex-col h-full overflow-hidden">
          <RecordDetailSection
            title="Activity timeline"
            className="flex flex-col h-full overflow-hidden"
          >
            <div className="flex-1 overflow-y-auto space-y-4 min-h-0 -mx-[14px] px-[14px]">
              {feedItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                  <CheckCircle2 className="w-8 h-8 mb-2 opacity-50" />
                  <p className="text-sm font-medium">No recent exceptions or behavioral triggers.</p>
                </div>
              ) : (
                feedItems.map((item, idx) => {
                  if (item.type === 'condition') {
                    const c = item.content as ConditionEventContent;
                    return (
                      <div key={`cond-${c.id}-${idx}`} className="flex gap-4">
                        <div className="w-8 h-8 rounded-full bg-destructive/10 text-destructive flex items-center justify-center shrink-0">
                          <Stethoscope className="w-4 h-4" />
                        </div>
                        <div className="flex-1 rounded-[8px] border border-destructive/20 bg-card p-3 shadow-[var(--shadow-card)]">
                          <div className="flex justify-between items-start mb-1">
                            <span className="font-semibold text-sm text-foreground">{c.typeLabel} <span className="uppercase text-[10px] text-destructive ml-1 font-bold">({c.severity})</span></span>
                            <span className="tabular-nums text-[10px] text-muted-foreground">{item.label}</span>
                          </div>
                          <p className="text-xs text-muted-foreground mb-2">{c.description}</p>
                          <p className="text-[10px] text-muted-foreground">By {c.loggedByLabel} {c.nurseNotified && '· MD Notified'}</p>
                        </div>
                      </div>
                    );
                  } else if (item.type === 'behavior') {
                    const b = item.content as BehaviorEventContent;
                    return (
                      <div key={`beh-${b.id}-${idx}`} className="flex gap-4">
                        <div className="w-8 h-8 rounded-full bg-warning/10 text-warning flex items-center justify-center shrink-0">
                          <Brain className="w-4 h-4" />
                        </div>
                        <div className="flex-1 rounded-[8px] border border-warning/20 bg-card p-3 shadow-[var(--shadow-card)]">
                          <div className="flex justify-between items-start mb-1">
                            <span className="font-semibold text-sm text-foreground">{b.typeLabel}</span>
                            <span className="tabular-nums text-[10px] text-muted-foreground">{item.label}</span>
                          </div>
                          <p className="text-xs text-muted-foreground mb-2">{b.behaviorText}</p>
                          <p className="text-[10px] text-muted-foreground">By {b.loggedByLabel} {b.injuryOccurred && "· INJURY REPORTED"}</p>
                        </div>
                      </div>
                    );
                  } else {
                    const a = item.content as ADLEventContent;
                    return (
                      <div key={`adl-${a.id}-${idx}`} className="flex gap-4">
                        <div className="w-8 h-8 rounded-full bg-muted text-muted-foreground flex items-center justify-center shrink-0">
                          <User className="w-4 h-4" />
                        </div>
                        <div className="flex-1 rounded-[8px] border border-border bg-card p-3 shadow-[var(--shadow-card)]">
                          <div className="flex justify-between items-start mb-1">
                            <span className="font-semibold text-sm text-foreground">{a.summary}</span>
                            <span className="tabular-nums text-[10px] text-muted-foreground">{item.label}</span>
                          </div>
                          <p className="text-[10px] text-muted-foreground mt-1">Logged by {a.loggedByLabel}</p>
                        </div>
                      </div>
                    );
                  }
                })
              )}
            </div>
          </RecordDetailSection>
        </div>

        {/* RIGHT COLUMN: Context Vectors */}
        <div className="lg:col-span-3 flex flex-col h-full gap-4 overflow-hidden">
          <RecordDetailSection title="Location context">
            <div className="space-y-4">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-0.5">Unit</p>
                <p className="text-sm font-medium text-foreground">{detail.unitName}</p>
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-0.5">Room &amp; bed</p>
                <p className="tabular-nums text-sm font-medium text-foreground">{detail.roomLabel}</p>
              </div>
            </div>
          </RecordDetailSection>

          <RecordDetailSection
            title="Active orders"
            className="flex-1 overflow-y-auto scrollbar-hide"
          >
            <div className="space-y-5">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Diet order</p>
                <p className="text-sm font-medium text-foreground">{detail.dietOrder || "Regular"}</p>
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Fall risk</p>
                {detail.fallRiskLabel ? (
                  <Badge variant="outline" className="border-warning/30 text-warning font-medium">{detail.fallRiskLabel}</Badge>
                ) : <span className="text-sm text-muted-foreground">Not assessed</span>}
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-2 mt-4 inline-flex items-center gap-1.5"><ClipboardList className="w-3.5 h-3.5"/> Care plan status</p>
                <div className="p-3 bg-muted border border-border rounded-[8px]">
                  <p className="text-sm font-medium text-foreground mb-1">Active (v3)</p>
                  <p className="tabular-nums text-[10px] text-muted-foreground">Effective Since: Oct 12, 2024</p>
                </div>
              </div>
            </div>
          </RecordDetailSection>
        </div>

      </div>

      {/* ─── LOGGING MODALS ──────────────────────────────────────────────────────── */}
      <BehaviorLogModal
        open={behaviorModalOpen}
        onOpenChange={setBehaviorModalOpen}
        residentId={residentId}
        residentName={detail?.fullName ?? "Resident"}
        onSuccess={onAfterLog}
      />
      <ConditionLogModal
        open={conditionModalOpen}
        onOpenChange={setConditionModalOpen}
        residentId={residentId}
        residentName={detail?.fullName ?? "Resident"}
        onSuccess={onAfterLog}
      />
      <GeneralNoteModal
        open={generalNoteModalOpen}
        onOpenChange={setGeneralNoteModalOpen}
        residentId={residentId}
        residentName={detail?.fullName ?? "Resident"}
        onSuccess={onAfterLog}
      />
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

function formatCodeStatus(value: string | null): string {
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

function AcuityBadge({ acuity }: { acuity: Acuity }) {
  if (acuity === 3) {
    return <Badge className="bg-destructive/10 text-destructive border-destructive/20 border">Acuity 3</Badge>;
  }
  if (acuity === 2) {
    return <Badge className="bg-warning/10 text-warning border-warning/20 border">Acuity 2</Badge>;
  }
  return <Badge className="bg-success/10 text-success border-success/20 border">Acuity 1</Badge>;
}

function ResidentStatusBadge({ status }: { status: ResidencyStatus }) {
  const map: Record<ResidencyStatus, { label: string; className: string }> = {
    active: {
      label: "In Facility",
      className: "bg-success/10 text-success border-success/20 border",
    },
    hospital: {
      label: "Hospital",
      className: "bg-destructive/10 text-destructive border-destructive/20 border",
    },
    loa: {
      label: "LOA",
      className: "bg-warning/10 text-warning border-warning/20 border",
    },
  };

  return <Badge className={map[status].className}>{map[status].label}</Badge>;
}
