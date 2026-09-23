"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import {
  AdminEmptyState,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { StaffOffboardCard } from "@/components/staff/StaffOffboardCard";
import { StaffProfileSections } from "@/components/staff/StaffProfileSections";
import { StaffTimeclockAccess } from "@/components/staff/StaffTimeclockAccess";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { formatLiveDataLoadError } from "@/lib/live-data-fallback";
import { todayFacilityDateIso } from "@/lib/facility-wall-clock";
import { createClient } from "@/lib/supabase/client";
import {
  formatStaffDetailCertExpirationDate,
  formatStaffDetailCertIssueDate,
  formatStaffDetailUpdatedAt,
  STAFF_DETAIL_NO_CERTS_COPY,
  STAFF_DETAIL_NO_UPCOMING_SHIFTS_COPY,
} from "@/lib/staff/staff-detail-display-copy";
import { mapEmploymentToUiStatus, type StaffStatus } from "@/lib/staff/load-staff";
import {
  buildStaffProfileSectionPatch,
  canEditStaffProfile,
  staffProfileSelectSql,
  type StaffProfileDraft,
  type StaffProfileRow,
  type StaffProfileSection,
} from "@/lib/staff/staff-profile-edit";
import { UUID_STRING_RE, isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { RecordDetailHeader, RecordDetailSection } from "@/design-system/components/record-detail";
import {
  CERT_STATUS_LABEL,
  aggregateCertStatus,
  type CertificationStatus,
} from "@/lib/staff/certification-aggregate";
import { enumLabel } from "@/lib/display/enum-label";

type StaffRoleUi = "nurse" | "caregiver" | "med_tech" | "admin";
type StaffStatusUi = StaffStatus;

type SupabaseStaff = StaffProfileRow;

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
  const { user, appRole } = useHavenAuth();

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
        .select(staffProfileSelectSql())
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

      const today = todayFacilityDateIso();
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

  const handleSaveSection = useCallback(
    async (section: StaffProfileSection, draft: StaffProfileDraft) => {
      if (!staff) return { error: "Staff record is not loaded." };
      if (!user?.id) return { error: "You must be signed in." };

      const built = buildStaffProfileSectionPatch(
        section,
        draft,
        user.id,
        staff.employment_status,
      );
      if (!built.ok) return { error: built.error };

      try {
        const supabase = createClient();
        const res = (await supabase
          .from("staff" as never)
          .update(built.patch as never)
          .eq("id", staffId)
          .select(staffProfileSelectSql())
          .single()) as unknown as QueryResult<SupabaseStaff>;

        if (res.error) return { error: res.error.message };
        if (!res.data) return { error: "Update did not return the staff row." };
        return { staff: res.data };
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : "Failed to save staff profile.",
        };
      }
    },
    [staff, staffId, user?.id],
  );

  const canEditProfile = canEditStaffProfile(appRole);

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

      <Link className={buttonVariants({ variant: "outline" })} href={`/admin/staff/${staffId}/employee-file`}>
        Employee file & onboarding
      </Link>

      <StaffOffboardCard staff={staff} canEdit={canEditProfile} onStaffUpdated={setStaff} />

        <div className="grid gap-6 lg:grid-cols-2">
          <StaffProfileSections
            key={`${staff.id}-${staff.updated_at ?? ""}`}
            staff={staff}
            canEdit={canEditProfile}
            updatedBy={user?.id ?? ""}
            onStaffUpdated={setStaff}
            onSaveSection={handleSaveSection}
          />

          <RecordDetailSection title="Certifications" description="Active directory credentials" className="lg:col-span-2">
            {certs.length === 0 ? (
              <p className="text-sm text-muted-foreground">{STAFF_DETAIL_NO_CERTS_COPY}</p>
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
                        {enumLabel(c.status)}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </RecordDetailSection>

          <RecordDetailSection title="Upcoming shifts" description="Next assigned blocks" className="lg:col-span-2">
            {shifts.length === 0 ? (
              <p className="text-sm text-muted-foreground">{STAFF_DETAIL_NO_UPCOMING_SHIFTS_COPY}</p>
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

          <StaffTimeclockAccess staffId={staff.id} canEdit={canEditProfile} className="lg:col-span-2" />

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
    role === "cook" ||
    role === "activity_aide" ||
    role === "marketing_consultant" ||
    role === "other"
  ) {
    return "caregiver";
  }
  return "admin";
}


function formatSnake(value: string): string {
  return enumLabel(value);
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
  if (status === "inactive") {
    return (
      <Badge variant="outline" tone="none" className={RECORD_HEADER_CHIP}>
        Inactive
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
  const label = CERT_STATUS_LABEL[certifications];
  if (certifications === "current") {
    return (
      <Badge variant="default" tone="success" className={RECORD_HEADER_CHIP}>
        {label}
      </Badge>
    );
  }
  if (certifications === "not_verified") {
    return (
      <Badge variant="outline" tone="none" className={RECORD_HEADER_CHIP}>
        {label}
      </Badge>
    );
  }
  if (certifications === "expiring_soon") {
    return (
      <Badge variant="default" tone="warning" className={RECORD_HEADER_CHIP}>
        {label}
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className={RECORD_HEADER_CHIP}>
      {label}
    </Badge>
  );
}
