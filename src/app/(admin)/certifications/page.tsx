"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Award, ChevronRight } from "lucide-react";

import { AdminEmptyState, AdminFilterBar, AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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

const DEFAULT_FILTERS = { search: "", timeline: "all", dbStatus: "all" };

export default function AdminCertificationsPage() {
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<CertRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(DEFAULT_FILTERS.search);
  const [timeline, setTimeline] = useState(DEFAULT_FILTERS.timeline);
  const [dbStatus, setDbStatus] = useState(DEFAULT_FILTERS.dbStatus);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const live = await fetchCertificationsFromSupabase(selectedFacilityId);
      setRows(live.length > 0 ? live : mockCertRows);
    } catch {
      setRows(mockCertRows);
      setError("Live certification directory is unavailable. Showing demo rows.");
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesSearch =
        q.length === 0 ||
        row.staffName.toLowerCase().includes(q) ||
        row.certificationName.toLowerCase().includes(q) ||
        row.certificationType.toLowerCase().includes(q) ||
        (row.issuingAuthority?.toLowerCase().includes(q) ?? false);
      const matchesTimeline = timeline === "all" || row.timeline === timeline;
      const matchesDb = dbStatus === "all" || row.dbStatus === dbStatus;
      return matchesSearch && matchesTimeline && matchesDb;
    });
  }, [rows, search, timeline, dbStatus]);

  const expiringCount = rows.filter((r) => r.timeline === "expiring_soon").length;
  const expiredCount = rows.filter((r) => r.timeline === "expired").length;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Certifications
          </h2>
          <p className="mt-1 text-slate-500 dark:text-slate-400">
            Facility-scoped license and training records with expiration visibility.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className="border-amber-200 bg-amber-50 px-3 py-1 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300"
          >
            <Award className="mr-1 h-3.5 w-3.5" />
            {expiringCount} expiring (60d)
          </Badge>
          <Badge
            variant="outline"
            className="border-red-200 bg-red-50 px-3 py-1 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
          >
            {expiredCount} expired / revoked
          </Badge>
        </div>
      </header>

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
              { value: "all", label: "All timelines" },
              { value: "current", label: "Current" },
              { value: "expiring_soon", label: "Expiring soon" },
              { value: "expired", label: "Expired" },
            ],
          },
          {
            id: "dbStatus",
            value: dbStatus,
            onChange: setDbStatus,
            options: [
              { value: "all", label: "All record statuses" },
              { value: "active", label: "Active" },
              { value: "pending_renewal", label: "Pending renewal" },
              { value: "expired", label: "Expired" },
              { value: "revoked", label: "Revoked" },
            ],
          },
        ]}
        onReset={() => {
          setSearch(DEFAULT_FILTERS.search);
          setTimeline(DEFAULT_FILTERS.timeline);
          setDbStatus(DEFAULT_FILTERS.dbStatus);
        }}
      />

      {isLoading ? <AdminTableLoadingState /> : null}
      {!isLoading && error ? (
        <Card className="border-amber-200/80 bg-amber-50/40 dark:border-amber-900/60 dark:bg-amber-950/20">
          <CardContent className="py-3 text-sm text-amber-700 dark:text-amber-300">{error}</CardContent>
        </Card>
      ) : null}
      {!isLoading && filteredRows.length === 0 ? (
        <AdminEmptyState
          title="No certifications match the current filters"
          description="Try clearing search or broadening status filters. Rows respect your facility selector when a facility is chosen."
        />
      ) : null}
      {!isLoading && filteredRows.length > 0 ? (
        <Card className="border-slate-200/80 shadow-sm dark:border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Credential register</CardTitle>
            <CardDescription>One row per certification on file. Open staff profile for full context.</CardDescription>
          </CardHeader>
          <CardContent className="p-0 sm:p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Staff</TableHead>
                  <TableHead>Credential</TableHead>
                  <TableHead className="hidden md:table-cell">Issued</TableHead>
                  <TableHead className="hidden lg:table-cell">Expires</TableHead>
                  <TableHead>Timeline</TableHead>
                  <TableHead className="hidden sm:table-cell">Record status</TableHead>
                  <TableHead className="pr-4 text-right"> </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium text-slate-900 dark:text-slate-100">{row.staffName}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium text-slate-800 dark:text-slate-200">{row.certificationName}</span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">{formatCertTypeLabel(row.certificationType)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-slate-600 dark:text-slate-400 md:table-cell">
                      {formatIsoDate(row.issueDate)}
                    </TableCell>
                    <TableCell className="hidden text-slate-600 dark:text-slate-400 lg:table-cell">
                      {row.expirationDate ? formatIsoDate(row.expirationDate) : "No expiry"}
                    </TableCell>
                    <TableCell>
                      <TimelineBadge timeline={row.timeline} />
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <DbStatusBadge status={row.dbStatus} />
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <Link
                        href={`/admin/staff/${row.staffId}`}
                        className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}
                        aria-label={`Open ${row.staffName}`}
                      >
                        <ChevronRight className="h-4 w-4 text-slate-500" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
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
    current: { label: "Current", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
    expiring_soon: {
      label: "Expiring soon",
      className: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    },
    expired: { label: "Expired", className: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300" },
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
      ? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
      : status === "pending_renewal"
        ? "bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
        : status === "expired" || status === "revoked"
          ? "bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-200"
          : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400";
  return <Badge className={className}>{label}</Badge>;
}

const mockCertRows: CertRow[] = [
  {
    id: "cert-demo-1",
    staffId: "staff-001",
    staffName: "John Davis",
    certificationType: "rn",
    certificationName: "Registered Nurse — State License",
    issuingAuthority: "State BON",
    issueDate: "2022-04-01",
    expirationDate: "2026-12-31",
    dbStatus: "active",
    timeline: "current",
  },
  {
    id: "cert-demo-2",
    staffId: "staff-002",
    staffName: "Maria Gomez",
    certificationType: "cpr_first_aid",
    certificationName: "CPR / First Aid",
    issuingAuthority: "Red Cross",
    issueDate: "2024-01-10",
    expirationDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    dbStatus: "active",
    timeline: "expiring_soon",
  },
  {
    id: "cert-demo-3",
    staffId: "staff-004",
    staffName: "Samuel Ortiz",
    certificationType: "cna",
    certificationName: "Nurse Aide Registry",
    issuingAuthority: "State registry",
    issueDate: "2019-06-01",
    expirationDate: "2024-08-01",
    dbStatus: "expired",
    timeline: "expired",
  },
];
