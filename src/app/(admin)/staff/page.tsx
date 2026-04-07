"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpDown, ChevronRight, UserRoundCheck } from "lucide-react";

import {
  AdminEmptyState,
  AdminFilterBar,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { adminListFilteredEmptyCopy } from "@/lib/admin-list-empty-copy";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

export default function AdminStaffPage() {
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        <div className="relative overflow-hidden rounded-2xl border border-white/10 dark:border-white/5 bg-white/40 dark:bg-[#0A0A0A]/50 backdrop-blur-2xl shadow-2xl">
          <div className="absolute inset-0 bg-gradient-to-b from-white/40 to-white/10 dark:from-white/5 dark:to-transparent pointer-events-none" />
          <div className="relative z-10 border-b border-white/20 dark:border-white/10 bg-white/20 dark:bg-black/20 p-6 flex flex-col gap-1">
            <h3 className="text-lg font-display font-semibold text-slate-900 dark:text-slate-100">Team Directory</h3>
            <p className="text-sm font-mono text-slate-500 dark:text-slate-400">Roster from staff, certifications, and upcoming shift assignments.</p>
          </div>
          <div className="relative z-10 overflow-x-auto">
            <Table>
              <TableHeader className="bg-white/40 dark:bg-black/40 border-b border-white/20 dark:border-white/10">
                <TableRow className="border-none hover:bg-transparent">
                  <TableHead className="pl-4 font-medium">Staff</TableHead>
                  <TableHead className="font-medium">Role</TableHead>
                  <TableHead className="font-medium">Status</TableHead>
                  <TableHead className="font-medium">Certifications</TableHead>
                  <TableHead className="font-medium">Next Shift</TableHead>
                  <TableHead className="font-medium">
                    <span className="inline-flex items-center gap-1">
                      Overtime Risk
                      <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
                    </span>
                  </TableHead>
                  <TableHead className="w-10 pr-4 text-right font-medium"> </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((staff) => (
                  <TableRow key={staff.id} className="border-slate-100 dark:border-slate-800 hover:bg-blue-500/5 dark:hover:bg-blue-500/10 transition-colors cursor-pointer group">
                    <TableCell className="pl-4">
                      <div className="flex items-center gap-3">
                        {staff.photoUrl ? (
                          <Avatar size="default" className="ring-1 ring-slate-200 dark:ring-slate-700">
                            <AvatarImage src={staff.photoUrl} alt={staff.name} />
                            <AvatarFallback className="bg-brand-100 text-brand-900 dark:bg-brand-900 dark:text-brand-100">
                              {staff.initials}
                            </AvatarFallback>
                          </Avatar>
                        ) : (
                          <div
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-medium text-slate-600 ring-1 ring-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:ring-slate-700"
                            aria-hidden
                          >
                            {staff.name.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <span className="font-medium text-slate-900 dark:text-slate-100">{staff.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <RoleBadge role={staff.role} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={staff.status} />
                    </TableCell>
                    <TableCell>
                      <CertificationBadge certifications={staff.certifications} />
                    </TableCell>
                    <TableCell className="text-slate-500 dark:text-slate-400">{staff.nextShift}</TableCell>
                    <TableCell>
                      <OvertimeRiskBadge risk={staff.overtimeRisk} />
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <Link
                        href={`/admin/staff/${staff.id}`}
                        className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}
                        aria-label={`Open ${staff.name}`}
                      >
                        <ChevronRight className="h-4 w-4 text-slate-500" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
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

function RoleBadge({ role }: { role: StaffRole }) {
  const map: Record<StaffRole, { label: string; className: string }> = {
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

function StatusBadge({ status }: { status: StaffStatus }) {
  const map: Record<StaffStatus, { label: string; className: string }> = {
    active: { label: "Active", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
    off_shift: {
      label: "Off Shift",
      className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    },
    on_leave: { label: "On Leave", className: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" },
  };
  return <Badge className={map[status].className}>{map[status].label}</Badge>;
}

function CertificationBadge({ certifications }: { certifications: CertificationStatus }) {
  const map: Record<CertificationStatus, { label: string; className: string }> = {
    current: { label: "Current", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
    expiring_soon: {
      label: "Expiring Soon",
      className: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    },
    expired: { label: "Expired", className: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300" },
  };
  return <Badge className={map[certifications].className}>{map[certifications].label}</Badge>;
}

function OvertimeRiskBadge({ risk }: { risk: "low" | "medium" | "high" }) {
  const map = {
    low: { label: "Low", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
    medium: { label: "Medium", className: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" },
    high: { label: "High", className: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300" },
  } as const;
  return <Badge className={map[risk].className}>{map[risk].label}</Badge>;
}
