"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Briefcase, Calendar, Mail, Phone, User } from "lucide-react";

import {
  AdminEmptyState,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { UUID_STRING_RE, isValidFacilityIdForQuery } from "@/lib/supabase/env";

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
    } catch {
      setError("Staff profile could not be loaded. Try again or return to the roster.");
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
  const initials = `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase() || "ST";
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
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-col gap-3">
          <Link
            href="/admin/staff"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex w-fit gap-1 px-0 sm:px-3")}
          >
            <ArrowLeft className="h-4 w-4" />
            Roster
          </Link>
          <div className="flex flex-wrap items-center gap-4">
            {staff.photo_url ? (
              <Avatar className="h-16 w-16 ring-2 ring-slate-200 dark:ring-slate-700">
                <AvatarImage src={staff.photo_url} alt={fullName} />
                <AvatarFallback className="bg-brand-100 text-lg font-medium text-brand-900 dark:bg-brand-900 dark:text-brand-100">
                  {initials}
                </AvatarFallback>
              </Avatar>
            ) : (
              <div
                className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-slate-200 text-lg font-medium text-slate-600 ring-2 ring-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:ring-slate-700"
                aria-hidden
              >
                {fullName.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <h1 className="font-display text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                {fullName}
              </h1>
              {staff.preferred_name ? (
                <p className="text-slate-500 dark:text-slate-400">&ldquo;{staff.preferred_name}&rdquo;</p>
              ) : null}
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {formatSnake(staff.staff_role)} · Updated {formatTs(staff.updated_at)}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <RoleBadge role={roleUi} />
                <StatusBadge status={statusUi} />
                <CertificationBadge certifications={certAgg} />
                {staff.is_float_pool ? (
                  <Badge variant="outline" className="border-slate-300 dark:border-slate-600">
                    Float pool
                  </Badge>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-slate-200/70 shadow-soft dark:border-slate-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-display text-lg">
              <Phone className="h-4 w-4 text-brand-600" />
              Contact
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <DetailRow label="Phone" value={staff.phone ?? "—"} />
            <DetailRow label="Alt phone" value={staff.phone_alt ?? "—"} />
            <DetailRow
              label="Email"
              value={
                staff.email ? (
                  <a
                    href={`mailto:${staff.email}`}
                    className="inline-flex items-center gap-1 text-brand-700 hover:underline dark:text-teal-400"
                  >
                    <Mail className="h-3.5 w-3.5" />
                    {staff.email}
                  </a>
                ) : (
                  "—"
                )
              }
            />
          </CardContent>
        </Card>

        <Card className="border-slate-200/70 shadow-soft dark:border-slate-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-display text-lg">
              <User className="h-4 w-4 text-brand-600" />
              Emergency
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <DetailRow label="Name" value={staff.emergency_contact_name ?? "—"} />
            <DetailRow label="Relationship" value={staff.emergency_contact_relationship ?? "—"} />
            <DetailRow label="Phone" value={staff.emergency_contact_phone ?? "—"} />
          </CardContent>
        </Card>

        <Card className="border-slate-200/70 shadow-soft dark:border-slate-800 lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-display text-lg">Address</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-slate-700 dark:text-slate-300">
            {!addressLine && !addrRest ? (
              <p className="text-slate-500 dark:text-slate-400">No address on file.</p>
            ) : (
              <p className="whitespace-pre-line">
                {[addressLine, addrRest].filter(Boolean).join("\n")}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200/70 shadow-soft dark:border-slate-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-display text-lg">
              <Briefcase className="h-4 w-4 text-brand-600" />
              Employment
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <DetailRow label="Hire date" value={formatDateOnly(staff.hire_date)} />
            <DetailRow label="Status" value={formatSnake(staff.employment_status)} />
            {staff.termination_date ? (
              <DetailRow label="Termination" value={formatDateOnly(staff.termination_date)} />
            ) : null}
            {staff.termination_reason ? (
              <DetailRow label="Termination reason" value={staff.termination_reason} />
            ) : null}
            <DetailRow label="Schedule" value={staff.is_full_time ? "Full time" : "Part time"} />
            <DetailRow
              label="Max hrs / week"
              value={staff.max_hours_per_week != null ? String(staff.max_hours_per_week) : "—"}
            />
          </CardContent>
        </Card>

        <Card className="border-slate-200/70 shadow-soft dark:border-slate-800">
          <CardHeader>
            <CardTitle className="font-display text-lg">Compensation</CardTitle>
            <CardDescription>Rates stored in cents (internal)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <DetailRow label="Base hourly" value={formatCents(staff.hourly_rate)} />
            <DetailRow label="Overtime" value={formatCents(staff.overtime_rate)} />
          </CardContent>
        </Card>

        <Card className="border-slate-200/70 shadow-soft dark:border-slate-800 lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-display text-lg">Certifications</CardTitle>
            <CardDescription>Active directory credentials</CardDescription>
          </CardHeader>
          <CardContent>
            {certs.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No certification rows on file.</p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {certs.map((c) => (
                  <li key={c.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium text-slate-900 dark:text-slate-100">{c.certification_name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {c.certification_type}
                        {c.issuing_authority ? ` · ${c.issuing_authority}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span>Issued {formatDateOnly(c.issue_date)}</span>
                      {c.expiration_date ? <span>Exp {formatDateOnly(c.expiration_date)}</span> : null}
                      <Badge variant="outline" className="font-normal capitalize">
                        {c.status.replace(/_/g, " ")}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200/70 shadow-soft dark:border-slate-800 lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-display text-lg">
              <Calendar className="h-4 w-4 text-brand-600" />
              Upcoming shifts
            </CardTitle>
            <CardDescription>Next assigned blocks (confirmed / assigned)</CardDescription>
          </CardHeader>
          <CardContent>
            {shifts.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No upcoming shifts in range.</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {shifts.map((s, i) => (
                  <li
                    key={`${s.shift_date}-${s.shift_type}-${i}`}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900/40"
                  >
                    <span className="font-medium text-slate-800 dark:text-slate-200">
                      {formatShiftLabel(s.shift_date, s.shift_type)}
                    </span>
                    <span className="ml-2 text-xs text-slate-500">{s.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {staff.notes ? (
          <Card className="border-slate-200/70 shadow-soft dark:border-slate-800 lg:col-span-2">
            <CardHeader>
              <CardTitle className="font-display text-lg">Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{staff.notes}</p>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function mapDbStaffRoleToUi(role: string): StaffRoleUi {
  if (role === "rn" || role === "lpn") return "nurse";
  if (role === "cna") return "caregiver";
  if (role === "dietary_staff") return "med_tech";
  if (role === "administrator" || role === "activities_director" || role === "dietary_manager") return "admin";
  if (role === "maintenance" || role === "housekeeping" || role === "driver" || role === "other") {
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

function formatTs(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function formatDateOnly(iso: string | null): string {
  if (!iso) return "—";
  const parsed = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(parsed);
}

function formatCents(cents: number | null): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
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

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
      <span className="min-w-[8rem] text-xs font-medium uppercase tracking-wide text-slate-400">{label}</span>
      <div className="text-slate-800 dark:text-slate-200">{value}</div>
    </div>
  );
}

function RoleBadge({ role }: { role: StaffRoleUi }) {
  const map: Record<StaffRoleUi, { label: string; className: string }> = {
    nurse: { label: "Nurse", className: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300" },
    caregiver: {
      label: "Caregiver",
      className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    },
    med_tech: {
      label: "Med Tech",
      className: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
    },
    admin: { label: "Admin", className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  };
  return <Badge className={map[role].className}>{map[role].label}</Badge>;
}

function StatusBadge({ status }: { status: StaffStatusUi }) {
  const map: Record<StaffStatusUi, { label: string; className: string }> = {
    active: { label: "Active", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
    off_shift: {
      label: "Off roster",
      className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    },
    on_leave: { label: "On Leave", className: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" },
  };
  return <Badge className={map[status].className}>{map[status].label}</Badge>;
}

function CertificationBadge({ certifications }: { certifications: CertificationStatus }) {
  const map: Record<CertificationStatus, { label: string; className: string }> = {
    current: { label: "Certs OK", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
    expiring_soon: {
      label: "Expiring soon",
      className: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    },
    expired: { label: "Cert issue", className: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300" },
  };
  return <Badge className={map[certifications].className}>{map[certifications].label}</Badge>;
}
