"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { ArrowUpDown, ChevronRight, Download, UserRoundCheck } from "lucide-react";

import {
  AdminEmptyState,
  AdminFilterBar,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { adminListFilteredEmptyCopy } from "@/lib/admin-list-empty-copy";
import { csvEscapeCell, triggerCsvDownload } from "@/lib/csv-export";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { PulseDot } from "@/components/ui/moonshot/pulse-dot";
import { Sparkline } from "@/components/ui/moonshot/sparkline";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";

type StaffRole = "nurse" | "caregiver" | "med_tech" | "admin";
type StaffStatus = "active" | "on_leave" | "off_shift";
type CertificationStatus = "current" | "expiring_soon" | "expired";

type StaffRow = {
  id: string;
  name: string;
  initials: string;
  role: StaffRole;
  status: StaffStatus;
  certifications: CertificationStatus;
  nextShift: string;
  overtimeRisk: "low" | "medium" | "high";
  photoUrl?: string | null;
};

const DEFAULT_FILTERS = {
  search: "",
  role: "all",
  status: "all",
  cert: "all",
};

type SupabaseStaffRow = {
  id: string;
  first_name: string;
  last_name: string;
  staff_role: string;
  employment_status: string;
  photo_url: string | null;
  deleted_at: string | null;
};

type SupabaseCertRow = {
  staff_id: string;
  status: string;
  expiration_date: string | null;
  deleted_at: string | null;
};

type SupabaseShiftRow = {
  staff_id: string;
  shift_date: string;
  shift_type: string;
};

type QueryError = { message: string };
type QueryResult<T> = { data: T[] | null; error: QueryError | null };

/** Roster CSV excludes `ssn_last_four` and `date_of_birth` (minimize accidental PHI spread). */
type StaffCsvRow = Omit<
  Database["public"]["Tables"]["staff"]["Row"],
  "ssn_last_four" | "date_of_birth"
>;

function buildStaffRosterCsv(rows: StaffCsvRow[]): string {
  const header = [
    "id",
    "organization_id",
    "facility_id",
    "first_name",
    "last_name",
    "preferred_name",
    "staff_role",
    "employment_status",
    "hire_date",
    "email",
    "phone",
    "phone_alt",
    "address_line_1",
    "address_line_2",
    "city",
    "state",
    "zip",
    "emergency_contact_name",
    "emergency_contact_phone",
    "emergency_contact_relationship",
    "is_full_time",
    "is_float_pool",
    "excluded_from_care",
    "max_hours_per_week",
    "hourly_rate",
    "overtime_rate",
    "termination_date",
    "termination_reason",
    "notes",
    "photo_url",
    "user_id",
    "deleted_at",
    "created_at",
    "updated_at",
    "created_by",
    "updated_by",
  ].join(",");
  const body = rows.map((row) =>
    [
      csvEscapeCell(row.id),
      csvEscapeCell(row.organization_id),
      csvEscapeCell(row.facility_id),
      csvEscapeCell(row.first_name),
      csvEscapeCell(row.last_name),
      csvEscapeCell(row.preferred_name ?? ""),
      csvEscapeCell(row.staff_role),
      csvEscapeCell(row.employment_status),
      csvEscapeCell(row.hire_date),
      csvEscapeCell(row.email ?? ""),
      csvEscapeCell(row.phone ?? ""),
      csvEscapeCell(row.phone_alt ?? ""),
      csvEscapeCell(row.address_line_1 ?? ""),
      csvEscapeCell(row.address_line_2 ?? ""),
      csvEscapeCell(row.city ?? ""),
      csvEscapeCell(row.state ?? ""),
      csvEscapeCell(row.zip ?? ""),
      csvEscapeCell(row.emergency_contact_name ?? ""),
      csvEscapeCell(row.emergency_contact_phone ?? ""),
      csvEscapeCell(row.emergency_contact_relationship ?? ""),
      csvEscapeCell(row.is_full_time ? "true" : "false"),
      csvEscapeCell(row.is_float_pool ? "true" : "false"),
      csvEscapeCell(row.excluded_from_care ? "true" : "false"),
      csvEscapeCell(row.max_hours_per_week != null ? String(row.max_hours_per_week) : ""),
      csvEscapeCell(row.hourly_rate != null ? String(row.hourly_rate) : ""),
      csvEscapeCell(row.overtime_rate != null ? String(row.overtime_rate) : ""),
      csvEscapeCell(row.termination_date ?? ""),
      csvEscapeCell(row.termination_reason ?? ""),
      csvEscapeCell(row.notes ?? ""),
      csvEscapeCell(row.photo_url ?? ""),
      csvEscapeCell(row.user_id ?? ""),
      csvEscapeCell(row.deleted_at ?? ""),
      csvEscapeCell(row.created_at),
      csvEscapeCell(row.updated_at),
      csvEscapeCell(row.created_by ?? ""),
      csvEscapeCell(row.updated_by ?? ""),
    ].join(","),
  );
  return [header, ...body].join("\r\n");
}

export default function AdminStaffPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportingCsv, setExportingCsv] = useState(false);

  const [search, setSearch] = useState(DEFAULT_FILTERS.search);
  const [role, setRole] = useState(DEFAULT_FILTERS.role);
  const [status, setStatus] = useState(DEFAULT_FILTERS.status);
  const [cert, setCert] = useState(DEFAULT_FILTERS.cert);

  const loadStaff = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const liveRows = await fetchStaffFromSupabase(selectedFacilityId);
      setRows(liveRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId]);

  useEffect(() => {
    void loadStaff();
  }, [loadStaff]);

  const exportStaffRosterCsv = useCallback(async () => {
    setExportingCsv(true);
    setError(null);
    try {
      let q = supabase
        .from("staff" as never)
        .select(
          `id, organization_id, facility_id, first_name, last_name, preferred_name,
          staff_role, employment_status, hire_date, email, phone, phone_alt,
          address_line_1, address_line_2, city, state, zip,
          emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
          is_full_time, is_float_pool, excluded_from_care,
          max_hours_per_week, hourly_rate, overtime_rate,
          termination_date, termination_reason, notes,
          photo_url, user_id, created_at, updated_at, created_by, updated_by, deleted_at`,
        )
        .is("deleted_at", null)
        .order("last_name", { ascending: true })
        .order("first_name", { ascending: true })
        .limit(500);

      if (isValidFacilityIdForQuery(selectedFacilityId)) {
        q = q.eq("facility_id", selectedFacilityId);
      }

      const { data, error: qErr } = await q;
      if (qErr) throw qErr;
      const list = (data ?? []) as StaffCsvRow[];
      const csv = buildStaffRosterCsv(list);
      const stamp = format(new Date(), "yyyy-MM-dd");
      triggerCsvDownload(`staff-roster-${stamp}.csv`, csv);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to export staff roster.");
    } finally {
      setExportingCsv(false);
    }
  }, [supabase, selectedFacilityId]);

  const filteredRows = useMemo(() => {
    const loweredSearch = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesSearch =
        loweredSearch.length === 0 ||
        row.name.toLowerCase().includes(loweredSearch) ||
        row.nextShift.toLowerCase().includes(loweredSearch);
      const matchesRole = role === "all" || row.role === role;
      const matchesStatus = status === "all" || row.status === status;
      const matchesCert = cert === "all" || row.certifications === cert;
      return matchesSearch && matchesRole && matchesStatus && matchesCert;
    });
  }, [rows, search, role, status, cert]);

  const listEmptyCopy = useMemo(
    () =>
      adminListFilteredEmptyCopy({
        datasetRowCount: rows.length,
        whenDatasetEmpty: {
          title: "No staff in this scope",
          description:
            "Live roster returned no staff rows for the selected facility. Use Add staff or adjust scope.",
        },
        whenFiltersExcludeAll: {
          title: "No staff match the current filters",
          description:
            "Try broadening role, status, or certification filters. Live roster is scoped by your current facility selection.",
        },
      }),
    [rows.length],
  );

  const activeCount = rows.filter((row) => row.status === "active").length;
  const certRiskCount = rows.filter((row) => row.certifications !== "current").length;

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix hasCriticals={certRiskCount > 0} 
        primaryClass="bg-blue-700/10"
        secondaryClass="bg-indigo-900/10"
        criticalPrimaryClass="bg-amber-700/20"
        criticalSecondaryClass="bg-orange-900/10"
      />
      <div className="relative z-10 space-y-6">
        <header className="mb-8">
          <div>
            <p className="text-[10px] uppercase font-mono tracking-widest text-slate-500 mb-2">SYS: Module 06 / Human Capital</p>
            <h2 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-3">
              Staffing Roster {certRiskCount > 0 && <PulseDot colorClass="bg-amber-500" />}
            </h2>
          </div>
        </header>

        <KineticGrid className="grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6" staggerMs={75}>
          <div className="h-[160px]">
            <V2Card hoverColor="blue">
              <Sparkline colorClass="text-blue-500" variant={3} />
              <MonolithicWatermark value={activeCount} className="text-blue-900/5 dark:text-blue-100/5 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] font-mono tracking-widest uppercase text-slate-500 flex items-center gap-2">
                  <UserRoundCheck className="h-3.5 w-3.5" /> Total Active Roster
                </h3>
                <p className="text-4xl font-mono tracking-tighter bg-clip-text text-transparent bg-gradient-to-b from-slate-900 to-slate-500 dark:from-white dark:to-slate-500 pb-1">{activeCount}</p>
              </div>
            </V2Card>
          </div>
          <div className="h-[160px]">
            <V2Card hoverColor="orange" className="border-amber-500/20 dark:border-amber-500/20 shadow-[inset_0_0_15px_rgba(245,158,11,0.05)]">
              <Sparkline colorClass="text-amber-500" variant={4} />
              <MonolithicWatermark value={certRiskCount} className="text-amber-600/5 dark:text-amber-400/5 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] font-mono tracking-widest uppercase text-amber-600 dark:text-amber-400 flex items-center gap-2">
                   Cert Attention
                </h3>
                <p className="text-4xl font-mono tracking-tighter text-amber-600 dark:text-amber-400 pb-1">{certRiskCount}</p>
              </div>
            </V2Card>
          </div>
          <div className="col-span-1 md:col-span-2 h-[160px]">
            <V2Card hoverColor="indigo" className="flex flex-col justify-center items-start lg:items-end">
              <div className="relative z-10 text-left lg:text-right w-full">
                 <p className="hidden lg:block text-xs font-mono text-slate-500 mb-4">Certification-aware workforce array with predictive shift tracking.</p>
                 <Link href="/admin/staff/new" className={cn(buttonVariants({ size: "default" }), "font-mono uppercase tracking-widest text-[10px] tap-responsive bg-indigo-600 hover:bg-indigo-700 text-white dark:bg-indigo-500 dark:hover:bg-indigo-600 border-none")} >
                   + Add Staff Member
                 </Link>
              </div>
            </V2Card>
          </div>
        </KineticGrid>

      <AdminFilterBar
        searchValue={search}
        searchPlaceholder="Search staff name or shift..."
        onSearchChange={setSearch}
        filters={[
          {
            id: "role",
            value: role,
            onChange: setRole,
            options: [
              { value: "all", label: "All Roles" },
              { value: "nurse", label: "Nurse" },
              { value: "caregiver", label: "Caregiver" },
              { value: "med_tech", label: "Med Tech" },
              { value: "admin", label: "Admin" },
            ],
          },
          {
            id: "status",
            value: status,
            onChange: setStatus,
            options: [
              { value: "all", label: "All Statuses" },
              { value: "active", label: "Active" },
              { value: "off_shift", label: "Off Shift" },
              { value: "on_leave", label: "On Leave" },
            ],
          },
          {
            id: "cert",
            value: cert,
            onChange: setCert,
            options: [
              { value: "all", label: "All Certification States" },
              { value: "current", label: "Current" },
              { value: "expiring_soon", label: "Expiring Soon" },
              { value: "expired", label: "Expired" },
            ],
          },
        ]}
        onReset={() => {
          setSearch(DEFAULT_FILTERS.search);
          setRole(DEFAULT_FILTERS.role);
          setStatus(DEFAULT_FILTERS.status);
          setCert(DEFAULT_FILTERS.cert);
        }}
      />

      {isLoading ? <AdminTableLoadingState /> : null}
      {!isLoading && error ? (
        <AdminLiveDataFallbackNotice message={error} onRetry={() => void loadStaff()} />
      ) : null}
      {!isLoading && filteredRows.length === 0 ? (
        <AdminEmptyState title={listEmptyCopy.title} description={listEmptyCopy.description} />
      ) : null}

      {!isLoading && filteredRows.length > 0 ? (
        <div className="relative overflow-visible z-10 w-full mt-4">
          <div className="relative z-10 p-4 sm:p-6 mb-4 glass-panel rounded-3xl border border-white/20 dark:border-white/5 bg-white/40 dark:bg-black/20 backdrop-blur-2xl shadow-2xl flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-slate-100 mb-1">Team Directory</h3>
              <p className="text-sm font-mono tracking-wide text-slate-500 dark:text-slate-400">
                Roster from staff, certifications, and upcoming shift assignments.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 font-mono text-[10px] uppercase tracking-widest"
              disabled={exportingCsv}
              aria-busy={exportingCsv}
              onClick={() => void exportStaffRosterCsv()}
            >
              <Download className="mr-2 h-3.5 w-3.5" aria-hidden />
              {exportingCsv ? "Exporting…" : "Download roster CSV"}
            </Button>
          </div>
          
          <MotionList className="space-y-3">
            {filteredRows.map((staff) => (
              <MotionItem key={staff.id}>
                <Link href={`/admin/staff/${staff.id}`} className="block focus-visible:outline-none focus:ring-2 focus:ring-indigo-500 rounded-2xl">
                  <div className="p-4 sm:p-5 rounded-2xl glass-panel group transition-all duration-300 hover:scale-[1.01] hover:border-indigo-500/30 hover:bg-white/70 dark:hover:bg-indigo-900/10 cursor-pointer border border-white/20 dark:border-white/5 bg-white/40 dark:bg-slate-900/40 w-full">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      
                      {/* Avatar and Name */}
                      <div className="flex items-center gap-4 min-w-[220px]">
                        {staff.photoUrl ? (
                          <Avatar size="default" className="ring-2 ring-white/50 dark:ring-slate-800/80 shadow-md">
                            <AvatarImage src={staff.photoUrl} alt={staff.name} />
                            <AvatarFallback className="bg-indigo-100 text-indigo-900 dark:bg-indigo-900/50 dark:text-indigo-100">
                              {staff.initials}
                            </AvatarFallback>
                          </Avatar>
                        ) : (
                          <div
                            className="flex h-10 w-10 shrink-0 shadow-md items-center justify-center rounded-full bg-slate-200/80 text-sm font-bold text-slate-600 ring-2 ring-white/50 dark:bg-slate-800/80 dark:text-slate-300 dark:ring-slate-800"
                            aria-hidden
                          >
                            {staff.name.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="flex flex-col">
                           <span className="font-bold text-slate-900 dark:text-slate-100">{staff.name}</span>
                           <span className="text-[10px] uppercase tracking-widest font-mono text-slate-500 mt-0.5">{staff.role}</span>
                        </div>
                      </div>

                      {/* Role & Status Data */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 w-full md:w-3/4 items-center">
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400">Status</span>
                          <div><StatusBadge status={staff.status} /></div>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400">Certifications</span>
                          <div><CertificationBadge certifications={staff.certifications} /></div>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400">Next Shift</span>
                          <span className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-300 bg-white/60 dark:bg-black/30 w-fit px-2 py-0.5 rounded shadow-sm">{staff.nextShift}</span>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400 flex items-center gap-1">Overtime Risk <ArrowUpDown className="h-2.5 w-2.5" /></span>
                          <div><OvertimeRiskBadge risk={staff.overtimeRisk} /></div>
                        </div>
                      </div>
                      
                      <div className="hidden sm:flex shrink-0">
                         <div className="w-8 h-8 rounded-full bg-white/50 dark:bg-white/5 flex items-center justify-center group-hover:bg-indigo-100 dark:group-hover:bg-indigo-900/50 transition-colors">
                           <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-400" />
                         </div>
                      </div>

                    </div>
                  </div>
                </Link>
              </MotionItem>
            ))}
          </MotionList>
        </div>
      ) : null}
      </div>
    </div>
  );
}

async function fetchStaffFromSupabase(selectedFacilityId: string | null): Promise<StaffRow[]> {
  const supabase = createClient();
  let staffQuery = supabase
    .from("staff" as never)
    .select("id, first_name, last_name, staff_role, employment_status, photo_url, deleted_at")
    .is("deleted_at", null)
    .limit(300);

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    staffQuery = staffQuery.eq("facility_id", selectedFacilityId);
  }

  const staffResult = (await staffQuery) as unknown as QueryResult<SupabaseStaffRow>;
  const staffList = staffResult.data ?? [];
  if (staffResult.error) {
    throw staffResult.error;
  }
  if (staffList.length === 0) {
    return [];
  }

  const staffIds = staffList.map((s) => s.id);
  const today = new Date().toISOString().slice(0, 10);

  const certsResult = (await supabase
    .from("staff_certifications" as never)
    .select("staff_id, status, expiration_date, deleted_at")
    .in("staff_id", staffIds)
    .is("deleted_at", null)) as unknown as QueryResult<SupabaseCertRow>;
  if (certsResult.error) {
    throw certsResult.error;
  }

  let shiftsQuery = supabase
    .from("shift_assignments" as never)
    .select("staff_id, shift_date, shift_type")
    .in("staff_id", staffIds)
    .gte("shift_date", today)
    .is("deleted_at", null)
    .in("status", ["assigned", "confirmed"])
    .order("shift_date", { ascending: true });

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    shiftsQuery = shiftsQuery.eq("facility_id", selectedFacilityId);
  }

  const shiftsResult = (await shiftsQuery) as unknown as QueryResult<SupabaseShiftRow>;
  if (shiftsResult.error) {
    throw shiftsResult.error;
  }

  const certsByStaff = new Map<string, SupabaseCertRow[]>();
  for (const row of certsResult.data ?? []) {
    const list = certsByStaff.get(row.staff_id) ?? [];
    list.push(row);
    certsByStaff.set(row.staff_id, list);
  }

  const nextShiftByStaff = new Map<string, SupabaseShiftRow>();
  for (const row of shiftsResult.data ?? []) {
    if (!nextShiftByStaff.has(row.staff_id)) {
      nextShiftByStaff.set(row.staff_id, row);
    }
  }

  return staffList.map((s) => {
    const first = s.first_name?.trim() ?? "";
    const last = s.last_name?.trim() ?? "";
    const name = `${first} ${last}`.trim() || "Staff member";
    const initials = `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase() || "ST";
    const certState = aggregateCertStatus(certsByStaff.get(s.id) ?? []);
    const uiRole = mapDbStaffRoleToUi(s.staff_role);
    const uiStatus = mapEmploymentToUiStatus(s.employment_status);
    const shift = nextShiftByStaff.get(s.id);
    const nextShift = shift ? formatNextShiftLabel(shift.shift_date, shift.shift_type) : "—";
    const overtimeRisk = deriveOvertimeRisk(certState, s.employment_status);

    return {
      id: s.id,
      name,
      initials,
      role: uiRole,
      status: uiStatus,
      certifications: certState,
      nextShift,
      overtimeRisk,
      photoUrl: s.photo_url,
    };
  });
}

function mapDbStaffRoleToUi(role: string): StaffRole {
  if (role === "rn" || role === "lpn") return "nurse";
  if (role === "cna") return "caregiver";
  if (role === "dietary_staff") return "med_tech";
  if (role === "administrator" || role === "activities_director" || role === "dietary_manager") return "admin";
  if (role === "maintenance" || role === "housekeeping" || role === "driver" || role === "other") {
    return "caregiver";
  }
  return "admin";
}

function mapEmploymentToUiStatus(employment: string): StaffStatus {
  if (employment === "on_leave") return "on_leave";
  if (employment === "terminated" || employment === "suspended") return "off_shift";
  return "active";
}

function aggregateCertStatus(certs: SupabaseCertRow[]): CertificationStatus {
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

function deriveOvertimeRisk(cert: CertificationStatus, employment: string): "low" | "medium" | "high" {
  if (cert === "expired") return "high";
  if (employment === "on_leave") return "medium";
  if (cert === "expiring_soon") return "medium";
  return "low";
}

function formatNextShiftLabel(shiftDate: string, shiftType: string): string {
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
          : "Shift";
  return `${datePart} · ${typeLabel}`;
}

function StatusBadge({ status }: { status: StaffStatus }) {
  const map: Record<StaffStatus, { label: string; className: string }> = {
    active: { label: "Active", className: "bg-emerald-500/20 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-400 uppercase tracking-widest font-mono text-[9px] font-bold border-0 shadow-sm" },
    off_shift: {
      label: "Off Shift",
      className: "bg-slate-200/50 text-slate-800 dark:bg-slate-800/50 dark:text-slate-300 uppercase tracking-widest font-mono text-[9px] font-bold border-0 shadow-sm",
    },
    on_leave: { label: "On Leave", className: "bg-amber-500/20 text-amber-800 dark:bg-amber-950/60 dark:text-amber-400 uppercase tracking-widest font-mono text-[9px] font-bold border-0 shadow-sm" },
  };
  return <Badge className={map[status].className}>{map[status].label}</Badge>;
}

function CertificationBadge({ certifications }: { certifications: CertificationStatus }) {
  const map: Record<CertificationStatus, { label: string; className: string }> = {
    current: { label: "Current", className: "bg-emerald-500/20 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-400 uppercase tracking-widest font-mono text-[9px] font-bold border-0 shadow-sm" },
    expiring_soon: {
      label: "Expiring Soon",
      className: "bg-amber-500/20 text-amber-800 dark:bg-amber-950/60 dark:text-amber-400 uppercase tracking-widest font-mono text-[9px] font-bold border-0 shadow-sm",
    },
    expired: { label: "Expired", className: "bg-red-500/20 text-red-800 dark:bg-red-950/60 dark:text-red-400 uppercase tracking-widest font-mono text-[9px] font-bold border-0 shadow-sm" },
  };
  return <Badge className={map[certifications].className}>{map[certifications].label}</Badge>;
}

function OvertimeRiskBadge({ risk }: { risk: "low" | "medium" | "high" }) {
  const map = {
    low: { label: "Low", className: "bg-emerald-500/20 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-400 uppercase tracking-widest font-mono text-[9px] font-bold border-0 shadow-sm" },
    medium: { label: "Medium", className: "bg-amber-500/20 text-amber-800 dark:bg-amber-950/60 dark:text-amber-400 uppercase tracking-widest font-mono text-[9px] font-bold border-0 shadow-sm" },
    high: { label: "High", className: "bg-red-500/20 text-red-800 dark:bg-red-950/60 dark:text-red-400 uppercase tracking-widest font-mono text-[9px] font-bold border-0 shadow-sm" },
  } as const;
  return <Badge className={map[risk].className}>{map[risk].label}</Badge>;
}
