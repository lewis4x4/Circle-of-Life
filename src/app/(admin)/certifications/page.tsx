"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { Award, ChevronRight, Download } from "lucide-react";

import {
  AdminEmptyState,
  AdminFilterBar,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { adminListFilteredEmptyCopy } from "@/lib/admin-list-empty-copy";
import { csvEscapeCell, triggerCsvDownload } from "@/lib/csv-export";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";
import { V2Card } from "@/components/ui/v2-card";
type TimelineUi = "current" | "expiring_soon" | "expired";

type CertRow = {
  id: string;
  staffId: string;
  staffName: string;
  certificationType: string;
  certificationName: string;
  issuingAuthority: string | null;
  issueDate: string;
  expirationDate: string | null;
  dbStatus: string;
  timeline: TimelineUi;
};

type SupabaseCertRow = {
  id: string;
  staff_id: string;
  certification_type: string;
  certification_name: string;
  issuing_authority: string | null;
  issue_date: string;
  expiration_date: string | null;
  status: string;
  deleted_at: string | null;
};

type SupabaseStaffMini = {
  id: string;
  first_name: string;
  last_name: string;
  deleted_at: string | null;
};

type QueryError = { message: string };
type QueryResult<T> = { data: T[] | null; error: QueryError | null };

type StaffCertExportRow = Database["public"]["Tables"]["staff_certifications"]["Row"] & {
  staff_display_name: string;
};

function buildCertificationsCsv(rows: StaffCertExportRow[]): string {
  const header = [
    "id",
    "organization_id",
    "facility_id",
    "staff_id",
    "staff_display_name",
    "certification_type",
    "certification_name",
    "certificate_number",
    "issuing_authority",
    "issue_date",
    "expiration_date",
    "status",
    "notes",
    "document_id",
    "storage_path",
    "created_at",
    "updated_at",
    "created_by",
    "updated_by",
    "deleted_at",
  ].join(",");
  const body = rows.map((row) =>
    [
      csvEscapeCell(row.id),
      csvEscapeCell(row.organization_id),
      csvEscapeCell(row.facility_id),
      csvEscapeCell(row.staff_id),
      csvEscapeCell(row.staff_display_name),
      csvEscapeCell(row.certification_type),
      csvEscapeCell(row.certification_name),
      csvEscapeCell(row.certificate_number ?? ""),
      csvEscapeCell(row.issuing_authority ?? ""),
      csvEscapeCell(row.issue_date),
      csvEscapeCell(row.expiration_date ?? ""),
      csvEscapeCell(row.status),
      csvEscapeCell(row.notes ?? ""),
      csvEscapeCell(row.document_id ?? ""),
      csvEscapeCell(row.storage_path ?? ""),
      csvEscapeCell(row.created_at),
      csvEscapeCell(row.updated_at),
      csvEscapeCell(row.created_by ?? ""),
      csvEscapeCell(row.updated_by ?? ""),
      csvEscapeCell(row.deleted_at ?? ""),
    ].join(","),
  );
  return [header, ...body].join("\r\n");
}

const DEFAULT_FILTERS = { search: "", timeline: "all", dbStatus: "all", window: "all" };

export default function AdminCertificationsPage() {
  const searchParams = useSearchParams();
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<CertRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [search, setSearch] = useState(DEFAULT_FILTERS.search);
  const [timeline, setTimeline] = useState(DEFAULT_FILTERS.timeline);
  const [dbStatus, setDbStatus] = useState(DEFAULT_FILTERS.dbStatus);
  const [windowFilter, setWindowFilter] = useState(DEFAULT_FILTERS.window);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const live = await fetchCertificationsFromSupabase(selectedFacilityId);
      setRows(live);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const requestedSearch = searchParams.get("search") ?? DEFAULT_FILTERS.search;
    const requestedTimeline = searchParams.get("timeline") ?? DEFAULT_FILTERS.timeline;
    const requestedDbStatus = searchParams.get("dbStatus") ?? DEFAULT_FILTERS.dbStatus;
    const requestedWindow = searchParams.get("window") ?? DEFAULT_FILTERS.window;

    setSearch(requestedSearch);
    setTimeline(
      ["all", "current", "expiring_soon", "expired"].includes(requestedTimeline)
        ? requestedTimeline
        : DEFAULT_FILTERS.timeline,
    );
    setDbStatus(
      ["all", "active", "pending_renewal", "expired", "revoked"].includes(requestedDbStatus)
        ? requestedDbStatus
        : DEFAULT_FILTERS.dbStatus,
    );
    setWindowFilter(["all", "30d"].includes(requestedWindow) ? requestedWindow : DEFAULT_FILTERS.window);
  }, [searchParams]);

  const applyCertificationFilters = useCallback((input: CertRow[], overrides?: Partial<{ timeline: string; dbStatus: string; windowFilter: string; search: string }>) => {
    const effectiveSearch = overrides?.search ?? search;
    const effectiveTimeline = overrides?.timeline ?? timeline;
    const effectiveDbStatus = overrides?.dbStatus ?? dbStatus;
    const effectiveWindow = overrides?.windowFilter ?? windowFilter;
    const q = effectiveSearch.trim().toLowerCase();
    return input.filter((row) => {
      const matchesSearch =
        q.length === 0 ||
        row.staffName.toLowerCase().includes(q) ||
        row.certificationName.toLowerCase().includes(q) ||
        row.certificationType.toLowerCase().includes(q) ||
        (row.issuingAuthority?.toLowerCase().includes(q) ?? false);
      const matchesTimeline = effectiveTimeline === "all" || row.timeline === effectiveTimeline;
      const matchesDb = effectiveDbStatus === "all" || row.dbStatus === effectiveDbStatus;
      const matchesWindow =
        effectiveWindow === "all" ||
        (row.expirationDate
          ? (() => {
              const exp = new Date(`${row.expirationDate}T23:59:59`);
              const now = new Date();
              const soon = new Date();
              soon.setDate(soon.getDate() + 30);
              return exp >= now && exp <= soon;
            })()
          : false);
      return matchesSearch && matchesTimeline && matchesDb && matchesWindow;
    });
  }, [dbStatus, search, timeline, windowFilter]);

  const filteredRows = useMemo(() => {
    return applyCertificationFilters(rows);
  }, [applyCertificationFilters, rows]);

  const exportCertificationsCsv = useCallback(async () => {
    setExportingCsv(true);
    setError(null);
    try {
      const ids = filteredRows.map((r) => r.id);
      const hubFiltersDefault =
        search.trim() === "" &&
        timeline === DEFAULT_FILTERS.timeline &&
        dbStatus === DEFAULT_FILTERS.dbStatus &&
        windowFilter === DEFAULT_FILTERS.window;
      const scope = hubFiltersDefault ? "" : "_filtered";
      const stamp = format(new Date(), "yyyy-MM-dd");

      if (ids.length === 0) {
        triggerCsvDownload(`staff-certifications-${stamp}${scope}.csv`, buildCertificationsCsv([]));
        return;
      }

      const certRes = (await supabase
        .from("staff_certifications" as never)
        .select("*")
        .in("id", ids)
        .is("deleted_at", null)) as unknown as QueryResult<
        Database["public"]["Tables"]["staff_certifications"]["Row"]
      >;
      if (certRes.error) throw certRes.error;
      const certs = certRes.data ?? [];
      const order = new Map(ids.map((id, i) => [id, i]));
      const sortedCerts = [...certs].sort(
        (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
      );

      if (sortedCerts.length === 0) {
        triggerCsvDownload(`staff-certifications-${stamp}${scope}.csv`, buildCertificationsCsv([]));
        return;
      }

      const staffIds = [...new Set(sortedCerts.map((c) => c.staff_id))];
      const staffRes = (await supabase
        .from("staff" as never)
        .select("id, first_name, last_name, deleted_at")
        .in("id", staffIds)
        .is("deleted_at", null)) as unknown as QueryResult<SupabaseStaffMini>;
      if (staffRes.error) throw staffRes.error;

      const nameById = new Map<string, string>();
      for (const s of staffRes.data ?? []) {
        const first = s.first_name?.trim() ?? "";
        const last = s.last_name?.trim() ?? "";
        nameById.set(s.id, `${first} ${last}`.trim() || "Staff member");
      }

      const exportRows: StaffCertExportRow[] = sortedCerts.map((c) => ({
        ...c,
        staff_display_name: nameById.get(c.staff_id) ?? "Unknown staff",
      }));

      const csv = buildCertificationsCsv(exportRows);
      triggerCsvDownload(`staff-certifications-${stamp}${scope}.csv`, csv);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to export certifications.");
    } finally {
      setExportingCsv(false);
    }
  }, [supabase, filteredRows, search, timeline, dbStatus, windowFilter]);

  const listEmptyCopy = useMemo(
    () =>
      adminListFilteredEmptyCopy({
        datasetRowCount: rows.length,
        whenDatasetEmpty: {
          title: "No certifications in this scope",
          description:
            "No certification rows for this facility yet. Use Add certification or import from your prior system.",
        },
        whenFiltersExcludeAll: {
          title: "No certifications match the current filters",
          description:
            "Try clearing search or broadening status filters. Rows respect your facility selector when a facility is chosen.",
        },
      }),
    [rows.length],
  );

  const expiringCount = filteredRows.filter((r) => r.timeline === "expiring_soon").length;
  const expiredCount = filteredRows.filter((r) => r.timeline === "expired").length;

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <></>
      
      <div className="relative z-10 space-y-6">
        <header className="mb-8">
          <div>
            
            <h2 className="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-3">
              Credential Tracking {expiredCount > 0 && <></>}
            </h2>
          </div>
        </header>

        <KineticGrid className="grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6" staggerMs={75}>
          <div className="h-[160px]">
            <V2Card hoverColor="orange" className="border-warning/20">
              <></>
              <MonolithicWatermark value={expiringCount} className="text-warning/10 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] tracking-wider uppercase text-warning flex items-center gap-2">
                  <Award className="h-3.5 w-3.5" /> {windowFilter === "30d" ? "Expiring (30D)" : "Expiring (60D)"}
                </h3>
                <p className="text-4xl font-mono tracking-tighter text-warning pb-1">{expiringCount}</p>
              </div>
            </V2Card>
          </div>
          <div className="h-[160px]">
            <V2Card hoverColor="rose" className="border-destructive/20">
              <></>
              <MonolithicWatermark value={expiredCount} className="text-destructive/10 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] tracking-wider uppercase text-destructive flex items-center gap-2">
                   Expired / Revoked
                </h3>
                <p className="text-4xl font-mono tracking-tighter text-destructive pb-1">{expiredCount}</p>
              </div>
            </V2Card>
          </div>
          <div className="col-span-1 md:col-span-2 h-[180px]">
            <V2Card hoverColor="indigo" className="p-5 lg:p-6">
              <div className="relative z-10 flex h-full w-full flex-col justify-center gap-4 text-left lg:items-end lg:text-right">
                 <p className="hidden max-w-md text-xs leading-relaxed text-muted-foreground lg:block">Facility-scoped license and training records.</p>
                 <Link href="/admin/certifications/new" className={cn(buttonVariants({ size: "default" }), "uppercase tracking-wider text-[10px] tap-responsive bg-primary hover:bg-primary/90 text-primary-foreground border-none whitespace-nowrap")} >
                   + Log Certification
                 </Link>
              </div>
            </V2Card>
          </div>
        </KineticGrid>

      <AdminFilterBar
        searchValue={search}
        searchPlaceholder="Search staff, credential, or authority..."
        onSearchChange={setSearch}
        filters={[
          {
            id: "timeline",
            value: timeline,
            onChange: setTimeline,
            options: [
              { value: "all", label: `All timelines (${applyCertificationFilters(rows, { timeline: "all" }).length})` },
              { value: "current", label: `Current (${applyCertificationFilters(rows, { timeline: "current" }).length})` },
              { value: "expiring_soon", label: `Expiring soon (${applyCertificationFilters(rows, { timeline: "expiring_soon" }).length})` },
              { value: "expired", label: `Expired (${applyCertificationFilters(rows, { timeline: "expired" }).length})` },
            ],
          },
          {
            id: "dbStatus",
            value: dbStatus,
            onChange: setDbStatus,
            options: [
              { value: "all", label: `All record statuses (${applyCertificationFilters(rows, { dbStatus: "all" }).length})` },
              { value: "active", label: `Active (${applyCertificationFilters(rows, { dbStatus: "active" }).length})` },
              { value: "pending_renewal", label: `Pending renewal (${applyCertificationFilters(rows, { dbStatus: "pending_renewal" }).length})` },
              { value: "expired", label: `Expired (${applyCertificationFilters(rows, { dbStatus: "expired" }).length})` },
              { value: "revoked", label: `Revoked (${applyCertificationFilters(rows, { dbStatus: "revoked" }).length})` },
            ],
          },
          {
            id: "window",
            value: windowFilter,
            onChange: setWindowFilter,
            options: [
              { value: "all", label: `All windows (${applyCertificationFilters(rows, { windowFilter: "all" }).length})` },
              { value: "30d", label: `Next 30 days (${applyCertificationFilters(rows, { windowFilter: "30d" }).length})` },
            ],
          },
        ]}
        onReset={() => {
          setSearch(DEFAULT_FILTERS.search);
          setTimeline(DEFAULT_FILTERS.timeline);
          setDbStatus(DEFAULT_FILTERS.dbStatus);
          setWindowFilter(DEFAULT_FILTERS.window);
        }}
      />
      {(timeline !== DEFAULT_FILTERS.timeline || dbStatus !== DEFAULT_FILTERS.dbStatus || windowFilter !== DEFAULT_FILTERS.window) ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-border bg-muted/40 text-muted-foreground">
            {filteredRows.length} visible
          </Badge>
          {timeline !== DEFAULT_FILTERS.timeline ? (
            <Badge variant="outline" className="border-warning/20 bg-warning/10 text-warning">
              Timeline: {timeline.replace(/_/g, " ")}
            </Badge>
          ) : null}
          {dbStatus !== DEFAULT_FILTERS.dbStatus ? (
            <Badge variant="outline" className="border-info/20 bg-info/10 text-info">
              Status: {dbStatus.replace(/_/g, " ")}
            </Badge>
          ) : null}
          {windowFilter !== DEFAULT_FILTERS.window ? (
            <Badge variant="outline" className="border-destructive/20 bg-destructive/10 text-destructive">
              Window: next 30 days
            </Badge>
          ) : null}
          <Link href="/admin/certifications" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-8 px-2 text-xs")}>
            Clear certification filters
          </Link>
        </div>
      ) : null}

      {isLoading ? <AdminTableLoadingState /> : null}
      {!isLoading && error ? (
        <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} />
      ) : null}
      {!isLoading && filteredRows.length === 0 ? (
        <AdminEmptyState title={listEmptyCopy.title} description={listEmptyCopy.description} />
      ) : null}
      {!isLoading && filteredRows.length > 0 ? (
        <div className="w-full mt-4">
          <div className="p-4 sm:p-6 mb-4 rounded-lg border border-border bg-card flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-xl font-semibold text-foreground mb-1">Certifications Matrix</h3>
              <p className="text-[13px] text-muted-foreground">
                Track state-mandated training, background checks, and clinical licenses.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 font-mono text-[10px] uppercase tracking-wider"
              disabled={exportingCsv}
              aria-busy={exportingCsv}
              onClick={() => void exportCertificationsCsv()}
            >
              <Download className="mr-2 h-3.5 w-3.5" aria-hidden />
              {exportingCsv ? "Exporting…" : "Download certifications CSV"}
            </Button>
          </div>
          
          <MotionList className="space-y-3">
            {filteredRows.map((row) => (
              <MotionItem key={row.id}>
                <Link
                  href={`/admin/staff/${row.staffId}`}
                  className="flex items-center gap-3 min-h-[36px] px-[13px] py-2 rounded-lg border border-border bg-card hover:bg-muted/40 hover:-translate-y-0.5 transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 group w-full"
                >
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 w-full">
                      
                      <div className="flex flex-col min-w-[200px]">
                         <span className="font-semibold text-[13px] text-foreground">{row.staffName}</span>
                         <span className="text-[10px] uppercase tracking-wider text-muted-foreground my-1 w-fit px-2 py-0.5 rounded-[4px] bg-muted">{row.certificationName}</span>
                         <span className="text-[12px] text-muted-foreground">{formatCertTypeLabel(row.certificationType)}</span>
                      </div>

                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 w-full md:w-3/4 items-center">
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[9px] uppercase tracking-wider text-muted-foreground">Timeline</span>
                          <div><TimelineBadge timeline={row.timeline} /></div>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[9px] uppercase tracking-wider text-muted-foreground">Record Status</span>
                          <div><DbStatusBadge status={row.dbStatus} /></div>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[9px] uppercase tracking-wider text-muted-foreground">Issued</span>
                          <span className="tabular-nums text-[12px] text-foreground">{formatIsoDate(row.issueDate)}</span>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[9px] uppercase tracking-wider text-muted-foreground">Expires</span>
                          <span className="tabular-nums text-[12px] text-foreground uppercase">{row.expirationDate ? formatIsoDate(row.expirationDate) : "No expiry"}</span>
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

async function fetchCertificationsFromSupabase(selectedFacilityId: string | null): Promise<CertRow[]> {
  const supabase = createClient();
  let q = supabase
    .from("staff_certifications" as never)
    .select(
      "id, staff_id, certification_type, certification_name, issuing_authority, issue_date, expiration_date, status, deleted_at",
    )
    .is("deleted_at", null)
    .order("expiration_date", { ascending: true })
    .limit(500);

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    q = q.eq("facility_id", selectedFacilityId);
  }

  const certRes = (await q) as unknown as QueryResult<SupabaseCertRow>;
  if (certRes.error) throw certRes.error;
  const certs = certRes.data ?? [];
  if (certs.length === 0) return [];

  const staffIds = [...new Set(certs.map((c) => c.staff_id))];
  const staffRes = (await supabase
    .from("staff" as never)
    .select("id, first_name, last_name, deleted_at")
    .in("id", staffIds)
    .is("deleted_at", null)) as unknown as QueryResult<SupabaseStaffMini>;
  if (staffRes.error) throw staffRes.error;

  const nameById = new Map<string, string>();
  for (const s of staffRes.data ?? []) {
    const first = s.first_name?.trim() ?? "";
    const last = s.last_name?.trim() ?? "";
    const name = `${first} ${last}`.trim() || "Staff member";
    nameById.set(s.id, name);
  }

  return certs.map((c) => ({
    id: c.id,
    staffId: c.staff_id,
    staffName: nameById.get(c.staff_id) ?? "Unknown staff",
    certificationType: c.certification_type,
    certificationName: c.certification_name,
    issuingAuthority: c.issuing_authority,
    issueDate: c.issue_date,
    expirationDate: c.expiration_date,
    dbStatus: c.status,
    timeline: deriveTimelineUi(c),
  }));
}

function deriveTimelineUi(c: Pick<SupabaseCertRow, "status" | "expiration_date">): TimelineUi {
  if (c.status === "expired" || c.status === "revoked") return "expired";
  if (c.expiration_date) {
    const exp = new Date(`${c.expiration_date}T23:59:59`);
    const now = new Date();
    if (exp < now) return "expired";
    const soon = new Date();
    soon.setDate(soon.getDate() + 60);
    if (exp <= soon) return "expiring_soon";
  }
  if (c.status === "pending_renewal") return "expiring_soon";
  return "current";
}

function formatIsoDate(isoDate: string): string {
  const parsed = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(parsed);
}

function formatCertTypeLabel(type: string): string {
  return type
    .split(/[_-]+/g)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function TimelineBadge({ timeline }: { timeline: TimelineUi }) {
  const map: Record<TimelineUi, { label: string; className: string }> = {
    current: { label: "Current", className: "bg-success/10 text-success uppercase tracking-wider text-[9px] font-semibold border-0" },
    expiring_soon: {
      label: "Expiring soon",
      className: "bg-warning/10 text-warning uppercase tracking-wider text-[9px] font-semibold border-0",
    },
    expired: { label: "Expired", className: "bg-destructive/10 text-destructive uppercase tracking-wider text-[9px] font-semibold border-0" },
  };
  return <Badge className={map[timeline].className}>{map[timeline].label}</Badge>;
}

function DbStatusBadge({ status }: { status: string }) {
  const label =
    status === "pending_renewal"
      ? "Pending renewal"
      : status === "active"
        ? "Active"
        : status === "expired"
          ? "Expired"
          : status === "revoked"
            ? "Revoked"
            : status;
  const className =
    status === "active"
      ? "bg-muted/40 text-muted-foreground uppercase tracking-wider text-[9px] font-semibold border-0"
      : status === "pending_renewal"
        ? "bg-warning/10 text-warning uppercase tracking-wider text-[9px] font-semibold border-0"
        : status === "expired" || status === "revoked"
          ? "bg-destructive/10 text-destructive uppercase tracking-wider text-[9px] font-semibold border-0"
          : "bg-muted/40 text-muted-foreground uppercase tracking-wider text-[9px] font-semibold border-0";
  return <Badge className={className}>{label}</Badge>;
}
