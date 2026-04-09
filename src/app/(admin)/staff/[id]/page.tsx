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
import { cn } from "@/lib/utils";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
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
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix hasCriticals={certAgg === "expired"} />

      <div className="relative z-10 space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between glass-panel p-6 sm:p-8 rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] backdrop-blur-3xl shadow-sm overflow-hidden relative">
          <div className="flex flex-col gap-5 relative z-10">
            <Link
              href="/admin/staff"
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex w-fit gap-2 -ml-2 text-slate-500 dark:text-slate-400 font-mono tracking-widest uppercase text-[10px] items-center hover:bg-slate-200/50 dark:hover:bg-white/5 rounded-full px-4")}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Roster
            </Link>
            <div className="flex flex-wrap items-center gap-6">
              {staff.photo_url ? (
                <Avatar className="h-20 w-20 ring-4 ring-white/50 dark:ring-white/10 shadow-lg rounded-[1.2rem]">
                  <AvatarImage src={staff.photo_url} alt={fullName} className="object-cover rounded-[1.2rem]"/>
                  <AvatarFallback className="bg-gradient-to-br from-indigo-100 to-slate-200 text-xl font-display font-medium text-indigo-900 dark:from-indigo-900 dark:to-slate-800 dark:text-indigo-100 rounded-[1.2rem]">
                    {initials}
                  </AvatarFallback>
                </Avatar>
              ) : (
                <div
                  className="flex h-20 w-20 shrink-0 items-center justify-center rounded-[1.2rem] bg-gradient-to-br from-slate-200 to-slate-300 text-xl font-display font-medium text-slate-600 ring-4 ring-white/50 dark:from-slate-800 dark:to-slate-900 dark:text-slate-300 dark:ring-white/10 shadow-lg"
                  aria-hidden
                >
                  {fullName.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="flex flex-col">
                 <h1 className="font-display text-4xl lg:text-5xl font-light tracking-tight text-slate-900 dark:text-white">
                  {fullName}
                 </h1>
                {staff.preferred_name ? (
                  <p className="text-slate-500 dark:text-slate-400 font-medium">
                    &ldquo;{staff.preferred_name}&rdquo;
                  </p>
                ) : null}
                <p className="mt-2 text-xs font-mono uppercase tracking-widest text-slate-500 dark:text-slate-400 flex flex-wrap gap-2 items-center">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">{formatSnake(staff.staff_role)}</span>
                  <span className="opacity-50">·</span>
                  <span>Updated {formatTs(staff.updated_at)}</span>
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <StatusBadge status={statusUi} />
                  <RoleBadge role={roleUi} />
                  <CertificationBadge certifications={certAgg} />
                  {staff.is_float_pool ? (
                    <Badge variant="outline" className="border-slate-300 dark:border-slate-600 uppercase tracking-widest font-mono text-[9px] font-bold shadow-sm px-2.5 py-1 rounded-full">
                      Float pool
                    </Badge>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="glass-panel p-6 sm:p-8 rounded-[2rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] backdrop-blur-3xl shadow-sm relative overflow-hidden transition-all">
            <div className="mb-6 border-b border-slate-200 dark:border-white/5 pb-4 flex items-center gap-3">
               <div className="w-10 h-10 flex shrink-0 items-center justify-center rounded-full border border-indigo-200 dark:border-indigo-500/20 bg-indigo-50 dark:bg-indigo-500/10">
                   <Phone className="h-4 w-4 text-indigo-500" />
               </div>
               <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white capitalize tracking-tight">Contact</h3>
            </div>
            <div className="space-y-4 text-sm relative z-10">
              <DetailRow label="Phone" value={staff.phone ?? "—"} />
              <DetailRow label="Alt phone" value={staff.phone_alt ?? "—"} />
              <DetailRow
                label="Email"
                value={
                  staff.email ? (
                    <a
                      href={`mailto:${staff.email}`}
                      className="inline-flex items-center gap-1.5 text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 underline underline-offset-4 decoration-indigo-200 dark:decoration-indigo-500/30 font-medium transition-colors"
                    >
                      <Mail className="h-3.5 w-3.5" />
                      {staff.email}
                    </a>
                  ) : (
                    "—"
                  )
                }
              />
            </div>
          </div>

          <div className="glass-panel p-6 sm:p-8 rounded-[2rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] backdrop-blur-3xl shadow-sm relative overflow-hidden transition-all">
            <div className="mb-6 border-b border-slate-200 dark:border-white/5 pb-4 flex items-center gap-3">
               <div className="w-10 h-10 flex shrink-0 items-center justify-center rounded-full border border-rose-200 dark:border-rose-500/20 bg-rose-50 dark:bg-rose-500/10">
                   <User className="h-4 w-4 text-rose-500" />
               </div>
               <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white capitalize tracking-tight">Emergency</h3>
            </div>
            <div className="space-y-4 text-sm relative z-10">
              <DetailRow label="Name" value={staff.emergency_contact_name ?? "—"} />
              <DetailRow label="Relationship" value={staff.emergency_contact_relationship ?? "—"} />
              <DetailRow label="Phone" value={staff.emergency_contact_phone ?? "—"} />
            </div>
          </div>

          <div className="glass-panel p-6 sm:p-8 rounded-[2rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] backdrop-blur-3xl shadow-sm relative overflow-hidden transition-all lg:col-span-2">
            <div className="mb-4 pb-2">
               <h3 className="text-[10px] font-mono tracking-widest uppercase text-slate-400">Address Info</h3>
            </div>
            <div className="text-sm font-semibold text-slate-800 dark:text-slate-200 relative z-10 text-lg">
              {!addressLine && !addrRest ? (
                <p className="text-slate-500 dark:text-slate-500 italic font-normal text-sm">No address on file.</p>
              ) : (
                <p className="whitespace-pre-line leading-relaxed">
                  {[addressLine, addrRest].filter(Boolean).join("\n")}
                </p>
              )}
            </div>
          </div>

          <div className="glass-panel p-6 sm:p-8 rounded-[2rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] backdrop-blur-3xl shadow-sm relative overflow-hidden transition-all">
            <div className="mb-6 border-b border-slate-200 dark:border-white/5 pb-4 flex items-center gap-3">
               <div className="w-10 h-10 flex shrink-0 items-center justify-center rounded-full border border-emerald-200 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-500/10">
                   <Briefcase className="h-4 w-4 text-emerald-500" />
               </div>
               <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white capitalize tracking-tight">Employment</h3>
            </div>
            <div className="space-y-4 text-sm relative z-10">
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
            </div>
          </div>

          <div className="glass-panel p-6 sm:p-8 rounded-[2rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] backdrop-blur-3xl shadow-sm relative overflow-hidden transition-all">
             <div className="mb-6 border-b border-slate-200 dark:border-white/5 pb-4">
                 <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white mt-1">Compensation</h3>
                <p className="text-[10px] font-mono tracking-widest text-slate-400 mt-1 uppercase">Rates stored in cents (internal)</p>
             </div>
            <div className="space-y-4 text-sm relative z-10">
              <DetailRow label="Base hourly" value={<span className="font-mono text-lg">{formatCents(staff.hourly_rate)}</span>} />
              <DetailRow label="Overtime" value={<span className="font-mono text-lg">{formatCents(staff.overtime_rate)}</span>} />
            </div>
          </div>

          <div className="glass-panel p-6 sm:p-8 rounded-[2rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] backdrop-blur-3xl shadow-sm relative overflow-hidden transition-all lg:col-span-2">
            <div className="mb-6 border-b border-slate-200 dark:border-white/5 pb-4">
                 <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white mt-1">Certifications</h3>
                <p className="text-[10px] font-mono tracking-widest text-slate-400 mt-1 uppercase">Active directory credentials</p>
             </div>
            <div className="relative z-10">
              {certs.length === 0 ? (
                <p className="text-sm font-mono text-slate-500 dark:text-slate-400 italic">No certification rows on file.</p>
              ) : (
                <ul className="divide-y divide-slate-200/50 dark:divide-slate-800/50">
                  {certs.map((c) => (
                    <li key={c.id} className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between group">
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-slate-100">{c.certification_name}</p>
                        <p className="text-xs uppercase font-mono tracking-widest text-slate-500 dark:text-slate-400 mt-1">
                          {c.certification_type}
                          {c.issuing_authority ? ` · ${c.issuing_authority}` : ""}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400 font-mono tracking-widest uppercase">
                        <span>Issued: {formatDateOnly(c.issue_date)}</span>
                        {c.expiration_date ? <span>Exp: {formatDateOnly(c.expiration_date)}</span> : null}
                        <Badge className="bg-slate-100 text-slate-700 border border-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 font-bold px-2 py-0.5 rounded-full shadow-sm text-[9px]">
                          {c.status.replace(/_/g, " ")}
                        </Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="glass-panel p-6 sm:p-8 rounded-[2rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] backdrop-blur-3xl shadow-sm relative overflow-hidden transition-all lg:col-span-2">
            <div className="mb-6 border-b border-slate-200 dark:border-white/5 pb-4 flex items-center gap-3">
               <div className="w-10 h-10 flex shrink-0 items-center justify-center rounded-full border border-cyan-200 dark:border-cyan-500/20 bg-cyan-50 dark:bg-cyan-500/10">
                   <Calendar className="h-4 w-4 text-cyan-500" />
               </div>
               <div>
                  <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white capitalize tracking-tight">Upcoming Shifts</h3>
                  <p className="text-[10px] font-mono tracking-widest text-slate-400 mt-0.5 uppercase">Next assigned blocks</p>
               </div>
            </div>
            <div className="relative z-10">
              {shifts.length === 0 ? (
                <p className="text-sm font-mono text-slate-500 dark:text-slate-400 italic">No upcoming shifts in range.</p>
              ) : (
                <ul className="flex flex-wrap gap-3">
                  {shifts.map((s, i) => (
                    <li
                      key={`${s.shift_date}-${s.shift_type}-${i}`}
                      className="rounded-2xl border border-slate-200/60 bg-white/60 px-4 py-2.5 text-sm dark:border-white/5 dark:bg-white/5 backdrop-blur-md shadow-sm transition-transform hover:-translate-y-0.5"
                    >
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {formatShiftLabel(s.shift_date, s.shift_type)}
                      </span>
                      <span className="ml-3 text-[10px] font-mono uppercase tracking-widest font-bold text-slate-500">{s.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {staff.notes ? (
            <div className="glass-panel p-6 sm:p-8 rounded-[2rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] backdrop-blur-3xl shadow-sm relative overflow-hidden transition-all lg:col-span-2">
              <div className="mb-4 pb-2">
                  <h3 className="text-[10px] font-mono tracking-widest uppercase text-slate-400">Notes</h3>
              </div>
              <div className="relative z-10">
                <p className="whitespace-pre-wrap text-sm font-medium leading-relaxed text-slate-700 dark:text-slate-300 bg-white/40 dark:bg-black/20 p-6 rounded-2xl border border-slate-200/40 dark:border-white/5">{staff.notes}</p>
              </div>
            </div>
          ) : null}
        </div>
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
    nurse: { label: "Nurse", className: "bg-blue-50 text-blue-700 border-blue-200 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-400" },
    caregiver: {
      label: "Caregiver",
      className: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400",
    },
    med_tech: {
      label: "Med Tech",
      className: "bg-violet-50 text-violet-700 border-violet-200 dark:border-violet-500/20 dark:bg-violet-500/10 dark:text-violet-400",
    },
    admin: { label: "Admin", className: "bg-slate-100 text-slate-700 border-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-slate-300" },
  };
  return <Badge className={cn("uppercase tracking-widest font-mono text-[9px] font-bold shadow-sm px-2.5 py-1 rounded-full border", map[role].className)}>{map[role].label}</Badge>;
}

function StatusBadge({ status }: { status: StaffStatusUi }) {
  const map: Record<StaffStatusUi, { label: string; className: string }> = {
    active: { label: "Active", className: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400" },
    off_shift: {
      label: "Off roster",
      className: "bg-slate-100 text-slate-700 border-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-slate-300",
    },
    on_leave: { label: "On Leave", className: "bg-amber-50 text-amber-700 border-amber-200 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400" },
  };
  return <Badge className={cn("uppercase tracking-widest font-mono text-[9px] font-bold shadow-sm px-2.5 py-1 rounded-full border", map[status].className)}>{map[status].label}</Badge>;
}

function CertificationBadge({ certifications }: { certifications: CertificationStatus }) {
  const map: Record<CertificationStatus, { label: string; className: string }> = {
    current: { label: "Certs OK", className: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400" },
    expiring_soon: {
      label: "Expiring soon",
      className: "bg-amber-50 text-amber-700 border-amber-200 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400",
    },
    expired: { label: "Cert issue", className: "bg-red-50 text-red-700 border-red-200 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400" },
  };
  return <Badge className={cn("uppercase tracking-widest font-mono text-[9px] font-bold shadow-sm px-2.5 py-1 rounded-full border", map[certifications].className)}>{map[certifications].label}</Badge>;
}
