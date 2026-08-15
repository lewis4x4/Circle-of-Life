"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Mail } from "lucide-react";

import {
  AdminEmptyState,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { formatLiveDataLoadError } from "@/lib/live-data-fallback";
import { createClient } from "@/lib/supabase/client";
import {
  formatStaffDetailAltPhone,
  formatStaffDetailCertExpirationDate,
  formatStaffDetailCertIssueDate,
  formatStaffDetailEmail,
  formatStaffDetailEmergencyName,
  formatStaffDetailEmergencyPhone,
  formatStaffDetailEmergencyRelationship,
  formatStaffDetailHireDate,
  formatStaffDetailMaxHours,
  formatStaffDetailPhone,
  formatStaffDetailRateCents,
  formatStaffDetailTerminationDate,
  formatStaffDetailUpdatedAt,
} from "@/lib/staff/staff-detail-display-copy";
import { UUID_STRING_RE, isValidFacilityIdForQuery } from "@/lib/supabase/env";
import {
  DetailRow,
  RecordDetailHeader,
  RecordDetailSection,
} from "@/design-system/components/record-detail";

type StaffRoleUi = "nurse" | "caregiver" | "med_tech" | "admin";
type StaffStatusUi = "active" | "on_leave" | "off_shift";
type CertificationStatus = "current" | "expiring_soon" | "expired";

type SupabaseStaff = {
  id: string;
  facility_id: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  phone: string | null;
  phone_alt: string | null;
  email: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relationship: string | null;
  staff_role: string;
  employment_status: string;
  hire_date: string;
  termination_date: string | null;
  termination_reason: string | null;
  hourly_rate: number | null;
  overtime_rate: number | null;
  is_full_time: boolean;
  is_float_pool: boolean;
  max_hours_per_week: number | null;
  photo_url: string | null;
  notes: string | null;
  updated_at: string | null;
};

type SupabaseCertRow = {
  id: string;
  certification_name: string;
  certification_type: string;
  issuing_authority: string | null;
  issue_date: string;
  expiration_date: string | null;
  status: string;
};

type SupabaseShiftRow = {
  shift_date: string;
  shift_type: string;
  status: string;
};

type QueryError = { message: string };
type QueryResult<T> = { data: T | null; error: QueryError | null };
type QueryListResult<T> = { data: T[] | null; error: QueryError | null };

export default function AdminStaffDetailPage() {
  const params = useParams();
  const rawId = params?.id;
  const staffId = typeof rawId === "string" ? rawId : Array.isArray(rawId) ? rawId[0] : "";
  const { selectedFacilityId } = useFacilityStore();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [staff, setStaff] = useState<SupabaseStaff | null>(null);
  const [certs, setCerts] = useState<SupabaseCertRow[]>([]);
  const [shifts, setShifts] = useState<SupabaseShiftRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    setStaff(null);
    setCerts([]);
    setShifts([]);

    if (!staffId || !UUID_STRING_RE.test(staffId)) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    try {
      const supabase = createClient();
      const staffRes = (await supabase
        .from("staff" as never)
        .select(
          [
            "id",
            "facility_id",
            "first_name",
            "last_name",
            "preferred_name",
            "phone",
            "phone_alt",
            "email",
            "address_line_1",
            "address_line_2",
            "city",
            "state",
            "zip",
            "emergency_contact_name",
            "emergency_contact_phone",
            "emergency_contact_relationship",
            "staff_role",
            "employment_status",
            "hire_date",
            "termination_date",
            "termination_reason",
            "hourly_rate",
            "overtime_rate",
            "is_full_time",
            "is_float_pool",
            "max_hours_per_week",
            "photo_url",
            "notes",
            "updated_at",
          ].join(", "),
        )
        .eq("id", staffId)
        .is("deleted_at", null)
        .maybeSingle()) as unknown as QueryResult<SupabaseStaff>;

      if (staffRes.error) throw staffRes.error;
      const row = staffRes.data;
      if (!row) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      if (isValidFacilityIdForQuery(selectedFacilityId) && row.facility_id !== selectedFacilityId) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      setStaff(row);

      const certRes = (await supabase
        .from("staff_certifications" as never)
        .select(
          "id, certification_name, certification_type, issuing_authority, issue_date, expiration_date, status",
        )
        .eq("staff_id", staffId)
        .is("deleted_at", null)
        .order("expiration_date", { ascending: true })) as unknown as QueryListResult<SupabaseCertRow>;
      if (certRes.error) throw certRes.error;
      setCerts(certRes.data ?? []);

      const today = new Date().toISOString().slice(0, 10);
      let shiftQ = supabase
        .from("shift_assignments" as never)
        .select("shift_date, shift_type, status")
        .eq("staff_id", staffId)
        .gte("shift_date", today)
        .is("deleted_at", null)
        .in("status", ["assigned", "confirmed"])
        .order("shift_date", { ascending: true })
        .limit(8);
      if (isValidFacilityIdForQuery(selectedFacilityId)) {
        shiftQ = shiftQ.eq("facility_id", selectedFacilityId);
      }
      const shiftRes = (await shiftQ) as unknown as QueryListResult<SupabaseShiftRow>;
      if (shiftRes.error) throw shiftRes.error;
      setShifts(shiftRes.data ?? []);
    } catch (err) {
      setError(
        formatLiveDataLoadError(
          err,
          "Staff profile could not be loaded. Try again or return to the roster.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [staffId, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        <Link href="/admin/staff" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}>
          <ArrowLeft className="h-4 w-4" />
          Roster
        </Link>
        <AdminTableLoadingState />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        <Link href="/admin/staff" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}>
          <ArrowLeft className="h-4 w-4" />
          Back to roster
        </Link>
        <AdminEmptyState
          title="Staff member not found"
          description="They may be outside your facility filter or removed from the directory."
        />
      </div>
    );
  }

  if (error || !staff) {
    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        <Link href="/admin/staff" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}>
          <ArrowLeft className="h-4 w-4" />
          Back to roster
        </Link>
        {error ? <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} /> : null}
      </div>
    );
  }

  const first = staff.first_name?.trim() ?? "";
  const last = staff.last_name?.trim() ?? "";
  const fullName = `${first} ${last}`.trim() || "Staff member";
  // initials retained for potential avatar future use
  const roleUi = mapDbStaffRoleToUi(staff.staff_role);
  const statusUi = mapEmploymentToUiStatus(staff.employment_status);
  const certAgg = aggregateCertStatus(
    certs.map((c) => ({
      status: c.status,
      expiration_date: c.expiration_date,
    })),
  );
  const addressLine = [staff.address_line_1, staff.address_line_2].filter(Boolean).join(", ");
  const cityState = [staff.city, staff.state].filter(Boolean).join(", ");
  const addrRest = [cityState, staff.zip].filter(Boolean).join(" ");

  return (
    <div className="space-y-6 animate-in fade-in duration-[var(--motion-duration)]">
      <RecordDetailHeader
        title={fullName}
        subtitle={`${formatSnake(staff.staff_role)} · Updated ${formatStaffDetailUpdatedAt(staff.updated_at)}${staff.preferred_name ? ` · "${staff.preferred_name}"` : ""}`}
        statusChips={
          <>
            <StatusBadge status={statusUi} />
            <RoleBadge role={roleUi} />
            <CertificationBadge certifications={certAgg} />
            {staff.is_float_pool ? (
              <Badge variant="outline" className="text-[10px] font-medium uppercase tracking-wider">
                Float pool
              </Badge>
            ) : null}
          </>
        }
        backLink={{ label: "Roster", href: "/admin/staff" }}
      />

        <div className="grid gap-6 lg:grid-cols-2">
          <RecordDetailSection title="Contact">
            <div className="space-y-4 text-sm">
              <DetailRow label="Phone" value={formatStaffDetailPhone(staff.phone)} />
              <DetailRow label="Alt phone" value={formatStaffDetailAltPhone(staff.phone_alt)} />
              <DetailRow
                label="Email"
                value={
                  staff.email?.trim() ? (
                    <a
                      href={`mailto:${staff.email}`}
                      className="inline-flex items-center gap-1.5 font-medium underline-offset-4 hover:underline"
                    >
                      <Mail className="h-3.5 w-3.5" />
                      {staff.email}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">{formatStaffDetailEmail(staff.email)}</span>
                  )
                }
              />
            </div>
          </RecordDetailSection>

          <RecordDetailSection title="Emergency contact">
            <div className="space-y-4 text-sm">
              <DetailRow
                label="Name"
                value={formatStaffDetailEmergencyName(staff.emergency_contact_name)}
              />
              <DetailRow
                label="Relationship"
                value={formatStaffDetailEmergencyRelationship(staff.emergency_contact_relationship)}
              />
              <DetailRow
                label="Phone"
                value={formatStaffDetailEmergencyPhone(staff.emergency_contact_phone)}
              />
            </div>
          </RecordDetailSection>

          <RecordDetailSection title="Address" className="lg:col-span-2">
            <div className="text-sm">
              {!addressLine && !addrRest ? (
                <p className="text-muted-foreground">No address on file.</p>
              ) : (
                <p className="whitespace-pre-line leading-relaxed font-medium text-foreground">
                  {[addressLine, addrRest].filter(Boolean).join("\n")}
                </p>
              )}
            </div>
          </RecordDetailSection>

          <RecordDetailSection title="Employment">
            <div className="space-y-4 text-sm">
              <DetailRow label="Hire date" value={formatStaffDetailHireDate(staff.hire_date)} />
              <DetailRow label="Status" value={formatSnake(staff.employment_status)} />
              {staff.termination_date ? (
                <DetailRow
                  label="Termination"
                  value={formatStaffDetailTerminationDate(staff.termination_date)}
                />
              ) : null}
              {staff.termination_reason ? (
                <DetailRow label="Termination reason" value={staff.termination_reason} />
              ) : null}
              <DetailRow label="Schedule" value={staff.is_full_time ? "Full time" : "Part time"} />
              <DetailRow
                label="Max hrs / week"
                value={formatStaffDetailMaxHours(staff.max_hours_per_week)}
              />
            </div>
          </RecordDetailSection>

          <RecordDetailSection title="Compensation">
            <div className="space-y-4 text-sm">
              <DetailRow
                label="Base hourly"
                value={
                  <span className="tabular-nums text-lg font-medium">
                    {formatStaffDetailRateCents(staff.hourly_rate)}
                  </span>
                }
              />
              <DetailRow
                label="Overtime"
                value={
                  <span className="tabular-nums text-lg font-medium">
                    {formatStaffDetailRateCents(staff.overtime_rate)}
                  </span>
                }
              />
            </div>
          </RecordDetailSection>

          <RecordDetailSection title="Certifications" description="Active directory credentials" className="lg:col-span-2">
            {certs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No certification rows on file.</p>
            ) : (
              <ul className="divide-y divide-border">
                {certs.map((c) => (
                  <li key={c.id} className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-semibold text-foreground">{c.certification_name}</p>
                      <p className="mt-1 text-xs uppercase font-medium tracking-wider text-muted-foreground">
                        {c.certification_type}
                        {c.issuing_authority ? ` · ${c.issuing_authority}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground tabular-nums">
                      <span>Issued: {formatStaffDetailCertIssueDate(c.issue_date)}</span>
                      <span>Exp: {formatStaffDetailCertExpirationDate(c.expiration_date)}</span>
                      <Badge variant="outline" className="text-[9px]">
                        {c.status.replace(/_/g, " ")}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </RecordDetailSection>

          <RecordDetailSection title="Upcoming shifts" description="Next assigned blocks" className="lg:col-span-2">
            {shifts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No upcoming shifts in range.</p>
            ) : (
              <ul className="flex flex-wrap gap-3">
                {shifts.map((s, i) => (
                  <li
                    key={`${s.shift_date}-${s.shift_type}-${i}`}
                    className="rounded-[8px] border border-border bg-card px-4 py-2.5 text-sm tabular-nums transition-[transform,box-shadow] duration-[var(--motion-duration)] hover:-translate-y-0.5"
                  >
                    <span className="font-semibold text-foreground">
                      {formatShiftLabel(s.shift_date, s.shift_type)}
                    </span>
                    <span className="ml-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{s.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </RecordDetailSection>

          {staff.notes ? (
            <RecordDetailSection title="Notes" className="lg:col-span-2">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{staff.notes}</p>
            </RecordDetailSection>
          ) : null}
        </div>
    </div>
  );
}

function mapDbStaffRoleToUi(role: string): StaffRoleUi {
  if (role === "rn" || role === "lpn") return "nurse";
  if (role === "medication_tech" || role === "dietary_staff") return "med_tech";
  if (
    role === "administrator" ||
    role === "assistant_administrator" ||
    role === "admin_support_coordinator" ||
    role === "activities_director" ||
    role === "dietary_manager" ||
    role === "owner" ||
    role === "ceo" ||
    role === "coo" ||
    role === "cfo"
  ) return "admin";
  if (
    role === "cna" ||
    role === "resident_aide" ||
    role === "resident_services_coordinator" ||
    role === "maintenance" ||
    role === "maintenance_director" ||
    role === "maintenance_standby" ||
    role === "housekeeping" ||
    role === "driver" ||
    role === "dietary_aide" ||
    role === "activity_aide" ||
    role === "marketing_consultant" ||
    role === "other"
  ) {
    return "caregiver";
  }
  return "admin";
}

function mapEmploymentToUiStatus(employment: string): StaffStatusUi {
  if (employment === "on_leave") return "on_leave";
  if (employment === "terminated" || employment === "suspended") return "off_shift";
  return "active";
}

function aggregateCertStatus(
  certs: Array<{ status: string; expiration_date: string | null }>,
): CertificationStatus {
  if (certs.length === 0) return "current";
  const now = new Date();
  const soon = new Date();
  soon.setDate(soon.getDate() + 60);
  let worst: CertificationStatus = "current";
  for (const c of certs) {
    if (c.status === "expired" || c.status === "revoked") {
      return "expired";
    }
    if (c.expiration_date) {
      const exp = new Date(`${c.expiration_date}T23:59:59`);
      if (exp < now) return "expired";
      if (exp <= soon) worst = "expiring_soon";
    }
    if (c.status === "pending_renewal") {
      worst = "expiring_soon";
    }
  }
  return worst;
}

function formatSnake(value: string): string {
  return value.replace(/_/g, " ");
}

function formatShiftLabel(shiftDate: string, shiftType: string): string {
  const parsed = new Date(`${shiftDate}T12:00:00`);
  const datePart = Number.isNaN(parsed.getTime())
    ? shiftDate
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(parsed);
  const typeLabel =
    shiftType === "day"
      ? "Day"
      : shiftType === "evening"
        ? "Evening"
        : shiftType === "night"
          ? "Night"
          : shiftType;
  return `${datePart} · ${typeLabel}`;
}

const RECORD_HEADER_CHIP = "text-[10px] font-semibold uppercase tracking-wider";

function RoleBadge({ role }: { role: StaffRoleUi }) {
  const map: Record<StaffRoleUi, string> = {
    nurse: "Nurse",
    caregiver: "Caregiver",
    med_tech: "Med Tech",
    admin: "Admin",
  };
  /** Role taxonomy — neutral outline only (Quiet Operator §7 — not a binary positive state). */
  return (
    <Badge variant="outline" className={RECORD_HEADER_CHIP}>
      {map[role]}
    </Badge>
  );
}

function StatusBadge({ status }: { status: StaffStatusUi }) {
  /** Employment state — semantic tone; Active is the lone success chip when healthy. */
  if (status === "active") {
    return (
      <Badge variant="default" tone="success" className={RECORD_HEADER_CHIP}>
        Active
      </Badge>
    );
  }
  if (status === "off_shift") {
    return (
      <Badge variant="outline" tone="none" className={RECORD_HEADER_CHIP}>
        Off roster
      </Badge>
    );
  }
  return (
    <Badge variant="default" tone="warning" className={RECORD_HEADER_CHIP}>
      On leave
    </Badge>
  );
}

function CertificationBadge({ certifications }: { certifications: CertificationStatus }) {
  if (certifications === "current") {
    return (
      <Badge variant="default" tone="success" className={RECORD_HEADER_CHIP}>
        Certs OK
      </Badge>
    );
  }
  if (certifications === "expiring_soon") {
    return (
      <Badge variant="default" tone="warning" className={RECORD_HEADER_CHIP}>
        Expiring soon
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className={RECORD_HEADER_CHIP}>
      Cert issue
    </Badge>
  );
}
