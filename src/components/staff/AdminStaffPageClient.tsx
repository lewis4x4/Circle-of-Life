"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { ChevronRight, Download, UserRoundCheck, ShieldAlert } from "lucide-react";

import {
  AdminEmptyState,
  AdminFilterBar,
  AdminLiveDataFallbackNotice,
  AdminOperationalListPanel,
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
import { Button, buttonVariants } from "@/components/ui/button";
import { StatCard } from "@/components/ui/stat-card";
import { StatusPill } from "@/components/ui/status-pill";
import { TableRow, TableRowHeader } from "@/components/ui/table-row";
import { cn } from "@/lib/utils";
import { MotionList, MotionItem } from "@/components/ui/motion-list";

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
    <div className="flex flex-col gap-6">
      {/* Page header — flat, dense. */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold tracking-tight text-foreground">
            Staffing roster
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Roster from staff, certifications, and upcoming shift assignments.
          </p>
        </div>
        <Link
          href="/admin/staff/new"
          className={cn(
            buttonVariants({ size: "default" }),
            "h-9 px-3 text-[12px] font-medium",
          )}
        >
          New staff member
        </Link>
      </div>

      {/* KPI strip — uses the shared StatCard primitive. Attention chrome
          fires only when the count > 0 (StatCard's built-in 0-value guard). */}
      <div className="grid max-w-2xl grid-cols-2 gap-3">
        <StatCard
          label="Active roster"
          value={activeCount}
          icon={<UserRoundCheck aria-hidden />}
        />
        <StatCard
          label="Cert attention"
          value={certRiskCount}
          icon={<ShieldAlert aria-hidden />}
          attentionTone="warning"
        />
      </div>

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
        <AdminOperationalListPanel
          toolbar={
            <>
              <h2 className="text-[13px] font-medium text-foreground">Team directory</h2>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 shrink-0 text-[11px]"
                disabled={exportingCsv}
                aria-busy={exportingCsv}
                onClick={() => void exportStaffRosterCsv()}
              >
                <Download className="mr-1.5 size-3" aria-hidden />
                {exportingCsv ? "Exporting…" : "Download roster CSV"}
              </Button>
            </>
          }
        >
          <TableRowHeader className="hidden lg:flex">
            <div className="flex-[3]">Staff</div>
            <div className="flex-1">Status</div>
            <div className="flex-1">Certifications</div>
            <div className="flex-1">Next shift</div>
            <div className="flex-1">Overtime risk</div>
            <div className="w-6" aria-hidden />
          </TableRowHeader>

          <MotionList className="space-y-1 p-1">
            {filteredRows.map((staff) => (
              <MotionItem key={staff.id}>
                <TableRow render={<Link href={`/admin/staff/${staff.id}`} />}>
                  {/* Staff (avatar + name) — single line, columns share the row height. */}
                  <div className="flex-[3] flex items-center gap-2.5 min-w-0">
                    {staff.photoUrl ? (
                      <Avatar size="sm">
                        <AvatarImage src={staff.photoUrl} alt={staff.name} />
                        <AvatarFallback className="bg-secondary text-[10px] text-foreground">
                          {staff.initials}
                        </AvatarFallback>
                      </Avatar>
                    ) : (
                      <span
                        className="grid size-6 shrink-0 place-items-center rounded-full bg-secondary text-[10px] font-semibold text-foreground"
                        aria-hidden
                      >
                        {staff.initials || staff.name.charAt(0).toUpperCase()}
                      </span>
                    )}
                    <div className="flex items-baseline gap-2 min-w-0">
                      <span className="truncate text-[13px] font-medium text-foreground">
                        {staff.name}
                      </span>
                      <span className="hidden md:inline truncate text-[11px] text-muted-foreground">
                        {staff.roleLabel}
                      </span>
                    </div>
                  </div>

                  <div className="flex-1">
                    <StaffStatusPill status={staff.status} />
                  </div>
                  <div className="flex-1">
                    <CertificationStatusPill certifications={staff.certifications} />
                  </div>
                  <div className="flex-1 text-[12px] tabular-nums text-foreground truncate">
                    {staff.nextShift}
                  </div>
                  <div className="flex-1">
                    <OvertimeRiskPill risk={staff.overtimeRisk} />
                  </div>

                  <div className="w-6 flex justify-end">
                    <ChevronRight
                      className="size-4 text-muted-foreground/60 transition-colors group-hover:text-foreground"
                      aria-hidden
                    />
                  </div>
                </TableRow>
              </MotionItem>
            ))}
          </MotionList>
        </AdminOperationalListPanel>
      ) : null}
    </div>
  );
}

/**
 * Healthy default = `active` → neutral pill + gray dot. Exceptions:
 *   `off_shift` → neutral (calm, no nag — not an exception, just not on)
 *   `on_leave`  → warning (operator attention needed for scheduling)
 *
 * Decorative-color rule: healthy "active" must NOT render green. Green is
 * reserved for "successfully resolved" outcomes, not for default state.
 */
function StaffStatusPill({ status }: { status: StaffStatus }) {
  switch (status) {
    case "on_leave":
      return <StatusPill tone="warning">On leave</StatusPill>;
    case "off_shift":
      return <StatusPill tone="muted">Off shift</StatusPill>;
    case "active":
    default:
      return <StatusPill tone="muted">Active</StatusPill>;
  }
}

/**
 * Healthy default = `current` → neutral. Exceptions earn color.
 */
function CertificationStatusPill({ certifications }: { certifications: CertificationStatus }) {
  switch (certifications) {
    case "expired":
      return <StatusPill tone="danger">Expired</StatusPill>;
    case "expiring_soon":
      return <StatusPill tone="warning">Expiring soon</StatusPill>;
    case "current":
    default:
      return <StatusPill tone="muted">Current</StatusPill>;
  }
}

/**
 * Healthy default = `low` → neutral. Risk earns color only when present.
 */
function OvertimeRiskPill({ risk }: { risk: "low" | "medium" | "high" }) {
  switch (risk) {
    case "high":
      return <StatusPill tone="danger">High</StatusPill>;
    case "medium":
      return <StatusPill tone="warning">Medium</StatusPill>;
    case "low":
    default:
      return <StatusPill tone="muted">Low</StatusPill>;
  }
}
