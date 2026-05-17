"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  fetchStaffFromSupabase,
  type CertificationStatus,
  type StaffRow,
  type StaffStatus,
} from "@/lib/staff/load-staff";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";
import { V2Card } from "@/components/ui/v2-card";
const DEFAULT_FILTERS = {
  search: "",
  role: "all",
  status: "all",
  cert: "all",
};

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

type AdminStaffPageClientProps = {
  initialRows: StaffRow[];
  initialError: string | null;
  initialFacilityId: string | null;
};

export function AdminStaffPageClient({
  initialRows,
  initialError,
  initialFacilityId,
}: AdminStaffPageClientProps) {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<StaffRow[]>(initialRows);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [exportingCsv, setExportingCsv] = useState(false);

  const [search, setSearch] = useState(DEFAULT_FILTERS.search);
  const [role, setRole] = useState(DEFAULT_FILTERS.role);
  const [status, setStatus] = useState(DEFAULT_FILTERS.status);
  const [cert, setCert] = useState(DEFAULT_FILTERS.cert);

  // Treat the server-rendered cookie scope as already loaded on first mount.
  // Any later facility scope change falls through and fetches exactly once.
  const skippedInitialLoadRef = useRef(false);
  const loadedFacilityIdRef = useRef<string | null>(initialError == null ? initialFacilityId : null);
  const hasLoadedFacilityScopeRef = useRef(initialError == null);

  const loadStaff = useCallback(async () => {
    if (!skippedInitialLoadRef.current) {
      skippedInitialLoadRef.current = true;

      if (initialError == null) {
        loadedFacilityIdRef.current = initialFacilityId;
        hasLoadedFacilityScopeRef.current = true;
        setIsLoading(false);
        return;
      }
    }

    if (hasLoadedFacilityScopeRef.current && selectedFacilityId === loadedFacilityIdRef.current) {
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const liveRows = await fetchStaffFromSupabase(selectedFacilityId);
      setRows(liveRows);
      loadedFacilityIdRef.current = selectedFacilityId;
      hasLoadedFacilityScopeRef.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId, initialFacilityId, initialError]);

  useEffect(() => {
    void loadStaff();
  }, [loadStaff]);

  const filteredRows = useMemo(() => {
    const loweredSearch = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesSearch =
        loweredSearch.length === 0 ||
        row.name.toLowerCase().includes(loweredSearch) ||
        row.roleLabel.toLowerCase().includes(loweredSearch) ||
        row.nextShift.toLowerCase().includes(loweredSearch);
      const matchesRole = role === "all" || row.role === role;
      const matchesStatus = status === "all" || row.status === status;
      const matchesCert = cert === "all" || row.certifications === cert;
      return matchesSearch && matchesRole && matchesStatus && matchesCert;
    });
  }, [rows, search, role, status, cert]);

  const exportStaffRosterCsv = useCallback(async () => {
    setExportingCsv(true);
    setError(null);
    try {
      const ids = filteredRows.map((r) => r.id);
      const hubFiltersDefault =
        search.trim() === "" &&
        role === DEFAULT_FILTERS.role &&
        status === DEFAULT_FILTERS.status &&
        cert === DEFAULT_FILTERS.cert;
      const scope = hubFiltersDefault ? "" : "_filtered";
      const stamp = format(new Date(), "yyyy-MM-dd");

      if (ids.length === 0) {
        triggerCsvDownload(`staff-roster-${stamp}${scope}.csv`, buildStaffRosterCsv([]));
        return;
      }

      const { data, error: qErr } = await supabase
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
        .in("id", ids)
        .is("deleted_at", null);

      if (qErr) throw qErr;
      const raw = (data ?? []) as StaffCsvRow[];
      const order = new Map(ids.map((id, i) => [id, i]));
      const list = raw.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
      const csv = buildStaffRosterCsv(list);
      triggerCsvDownload(`staff-roster-${stamp}${scope}.csv`, csv);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to export staff roster.");
    } finally {
      setExportingCsv(false);
    }
  }, [supabase, filteredRows, search, role, status, cert]);

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
      <></>
      <div className="relative z-10 space-y-6">
        <header className="mb-8">
          <div>
            
            <h2 className="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-3">
              Staffing Roster {certRiskCount > 0 && <></>}
            </h2>
          </div>
        </header>

        <KineticGrid className="grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6" staggerMs={75}>
          <div className="h-[160px]">
            <V2Card hoverColor="blue">
              <></>
              <MonolithicWatermark value={activeCount} className="text-info/10 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] tracking-wider uppercase text-muted-foreground flex items-center gap-2">
                  <UserRoundCheck className="h-3.5 w-3.5" /> Total Active Roster
                </h3>
                <p className="text-4xl font-mono tracking-tighter pb-1">{activeCount}</p>
              </div>
            </V2Card>
          </div>
          <div className="h-[160px]">
            <V2Card hoverColor="orange" className="border-warning/20">
              <></>
              <MonolithicWatermark value={certRiskCount} className="text-warning/10 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] tracking-wider uppercase text-warning flex items-center gap-2">
                   Cert Attention
                </h3>
                <p className="text-4xl font-mono tracking-tighter text-warning pb-1">{certRiskCount}</p>
              </div>
            </V2Card>
          </div>
          <div className="col-span-1 md:col-span-2 h-[180px]">
            <V2Card hoverColor="indigo" className="p-5 lg:p-6">
              <div className="relative z-10 flex h-full w-full flex-col justify-center gap-4 text-left lg:items-end lg:text-right">
                 <p className="hidden max-w-md text-xs leading-relaxed text-muted-foreground lg:block">Certification-aware workforce array with predictive shift tracking.</p>
                 <Link href="/admin/staff/new" className={cn(buttonVariants({ size: "default" }), "uppercase tracking-wider text-[10px] tap-responsive bg-primary hover:bg-primary/90 text-primary-foreground border-none whitespace-nowrap")} >
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
          <div className="relative z-10 p-4 sm:p-6 mb-4 rounded-lg border border-border bg-card flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-xl font-semibold text-foreground mb-1">Team Directory</h3>
              <p className="text-[13px] text-muted-foreground">
                Roster from staff, certifications, and upcoming shift assignments.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 font-mono text-[10px] uppercase tracking-wider"
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
                <Link
                  href={`/admin/staff/${staff.id}`}
                  className="flex items-center gap-3 min-h-[36px] px-[13px] py-2 rounded-lg border border-border bg-card hover:bg-muted/40 hover:-translate-y-0.5 transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 group w-full"
                >
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 w-full">
                      
                      {/* Avatar and Name */}
                      <div className="flex items-center gap-4 min-w-[220px]">
                        {staff.photoUrl ? (
                          <Avatar size="default">
                            <AvatarImage src={staff.photoUrl} alt={staff.name} />
                            <AvatarFallback className="bg-primary/10 text-primary">
                              {staff.initials}
                            </AvatarFallback>
                          </Avatar>
                        ) : (
                          <div
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-[13px] font-semibold text-muted-foreground"
                            aria-hidden
                          >
                            {staff.name.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="flex flex-col">
                           <span className="font-semibold text-foreground text-[13px]">{staff.name}</span>
                           <span className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">{staff.roleLabel}</span>
                        </div>
                      </div>

                      {/* Role & Status Data */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 w-full md:w-3/4 items-center">
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[9px] uppercase tracking-wider text-muted-foreground">Status</span>
                          <div><StatusBadge status={staff.status} /></div>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[9px] uppercase tracking-wider text-muted-foreground">Certifications</span>
                          <div><CertificationBadge certifications={staff.certifications} /></div>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[9px] uppercase tracking-wider text-muted-foreground">Next Shift</span>
                          <span className="tabular-nums text-[12px] text-foreground">{staff.nextShift}</span>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[9px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">Overtime Risk <ArrowUpDown className="h-2.5 w-2.5" /></span>
                          <div><OvertimeRiskBadge risk={staff.overtimeRisk} /></div>
                        </div>
                      </div>
                      
                      <div className="hidden sm:flex shrink-0">
                         <div className="w-8 h-8 rounded-full bg-muted/40 flex items-center justify-center group-hover:bg-primary/10 transition-colors duration-[var(--motion-duration-micro)]">
                           <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
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

function StatusBadge({ status }: { status: StaffStatus }) {
  const map: Record<StaffStatus, { label: string; className: string }> = {
    active: { label: "Active", className: "bg-success/10 text-success uppercase tracking-widest text-[9px] font-semibold border-0" },
    off_shift: {
      label: "Off Shift",
      className: "bg-muted/40 text-muted-foreground uppercase tracking-widest text-[9px] font-semibold border-0",
    },
    on_leave: { label: "On Leave", className: "bg-warning/10 text-warning uppercase tracking-widest text-[9px] font-semibold border-0" },
  };
  return <Badge className={map[status].className}>{map[status].label}</Badge>;
}

function CertificationBadge({ certifications }: { certifications: CertificationStatus }) {
  const map: Record<CertificationStatus, { label: string; className: string }> = {
    current: { label: "Current", className: "bg-success/10 text-success uppercase tracking-widest text-[9px] font-semibold border-0" },
    expiring_soon: {
      label: "Expiring Soon",
      className: "bg-warning/10 text-warning uppercase tracking-widest text-[9px] font-semibold border-0",
    },
    expired: { label: "Expired", className: "bg-destructive/10 text-destructive uppercase tracking-widest text-[9px] font-semibold border-0" },
  };
  return <Badge className={map[certifications].className}>{map[certifications].label}</Badge>;
}

function OvertimeRiskBadge({ risk }: { risk: "low" | "medium" | "high" }) {
  const map = {
    low: { label: "Low", className: "bg-success/10 text-success uppercase tracking-widest text-[9px] font-semibold border-0" },
    medium: { label: "Medium", className: "bg-warning/10 text-warning uppercase tracking-widest text-[9px] font-semibold border-0" },
    high: { label: "High", className: "bg-destructive/10 text-destructive uppercase tracking-widest text-[9px] font-semibold border-0" },
  } as const;
  return <Badge className={map[risk].className}>{map[risk].label}</Badge>;
}
