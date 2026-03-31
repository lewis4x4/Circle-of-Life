"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpDown, ChevronRight, ClipboardCheck } from "lucide-react";

import { AdminEmptyState, AdminFilterBar, AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const DEFAULT_FILTERS = { search: "", type: "all" };

type Row = {
  id: string;
  residentId: string;
  residentName: string;
  assessmentType: string;
  assessmentDate: string;
  nextDueDate: string;
  daysOverdue: number;
  riskLevel: string | null;
  totalScore: string | null;
};

type SupabaseAssessment = {
  id: string;
  resident_id: string;
  facility_id: string;
  assessment_type: string;
  assessment_date: string;
  next_due_date: string;
  risk_level: string | null;
  total_score: number | string | null;
};

type SupabaseResidentMini = {
  id: string;
  first_name: string | null;
  last_name: string | null;
};

type QueryError = { message: string };
type QueryListResult<T> = { data: T[] | null; error: QueryError | null };

function easternDateString(d = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (!y || !m || !day) return d.toISOString().slice(0, 10);
  return `${y}-${m}-${day}`;
}

function parseISODateOnly(value: string): number {
  const [yy, mm, dd] = value.split("-").map(Number);
  if (!yy || !mm || !dd) return NaN;
  return new Date(Date.UTC(yy, mm - 1, dd)).getTime();
}

export default function AdminAssessmentsOverduePage() {
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<Row[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(DEFAULT_FILTERS.search);
  const [typeFilter, setTypeFilter] = useState(DEFAULT_FILTERS.type);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const live = await fetchOverdueAssessments(selectedFacilityId);
      setRows(live.length > 0 ? live : mockRows);
    } catch {
      setRows(mockRows);
      setError("Live assessment queue is unavailable. Showing demo overdue items.");
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const typeOptions = useMemo(() => {
    const types = Array.from(new Set(rows.map((r) => r.assessmentType))).sort((a, b) => a.localeCompare(b));
    return [{ value: "all", label: "All types" }, ...types.map((t) => ({ value: t, label: formatType(t) }))];
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const matchesSearch =
        q.length === 0 ||
        r.residentName.toLowerCase().includes(q) ||
        r.assessmentType.toLowerCase().includes(q);
      const matchesType = typeFilter === "all" || r.assessmentType === typeFilter;
      return matchesSearch && matchesType;
    });
  }, [rows, search, typeFilter]);

  const overdueCount = rows.filter((r) => r.daysOverdue > 0).length;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="font-display text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Overdue assessments
          </h2>
          <p className="mt-1 text-slate-500 dark:text-slate-400">
            Follow-ups where next due date is on or before today (America/New_York).
          </p>
        </div>
        <Badge variant="outline" className="w-fit border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          <ClipboardCheck className="mr-1 h-3.5 w-3.5" />
          {overdueCount} past due
        </Badge>
      </header>

      <AdminFilterBar
        searchValue={search}
        searchPlaceholder="Search resident or assessment type..."
        onSearchChange={setSearch}
        filters={[
          {
            id: "type",
            value: typeFilter,
            onChange: setTypeFilter,
            options: typeOptions,
          },
        ]}
        onReset={() => {
          setSearch(DEFAULT_FILTERS.search);
          setTypeFilter(DEFAULT_FILTERS.type);
        }}
      />

      {isLoading ? <AdminTableLoadingState /> : null}
      {!isLoading && error ? (
        <Card className="border-amber-200/80 bg-amber-50/40 dark:border-amber-900/60 dark:bg-amber-950/20">
          <CardContent className="py-3 text-sm text-amber-700 dark:text-amber-300">{error}</CardContent>
        </Card>
      ) : null}
      {!isLoading && filtered.length === 0 ? (
        <AdminEmptyState
          title="No matching overdue assessments"
          description="When assessments have a next due date on or before today, they appear here for clinical follow-up."
        />
      ) : null}

      {!isLoading && filtered.length > 0 ? (
        <Card className="overflow-hidden border-slate-200/70 bg-white shadow-soft dark:border-slate-800 dark:bg-slate-950">
          <CardHeader className="border-b border-slate-100 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/30">
            <CardTitle className="font-display text-lg">Queue</CardTitle>
            <CardDescription>Sorted by due date (oldest first)</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-slate-50/70 dark:bg-slate-900/60">
                <TableRow className="border-slate-100 hover:bg-transparent dark:border-slate-800">
                  <TableHead className="pl-4 font-medium">Resident</TableHead>
                  <TableHead className="font-medium">Type</TableHead>
                  <TableHead className="font-medium">Assessed</TableHead>
                  <TableHead className="font-medium">Due</TableHead>
                  <TableHead className="font-medium">Risk</TableHead>
                  <TableHead className="font-medium">Score</TableHead>
                  <TableHead className="font-medium">
                    <span className="inline-flex items-center gap-1">
                      Overdue
                      <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
                    </span>
                  </TableHead>
                  <TableHead className="w-10 pr-4 text-right font-medium"> </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id} className="border-slate-100 dark:border-slate-800">
                    <TableCell className="pl-4 font-medium text-slate-900 dark:text-slate-100">{r.residentName}</TableCell>
                    <TableCell>{formatType(r.assessmentType)}</TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-400">{r.assessmentDate}</TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-400">{r.nextDueDate}</TableCell>
                    <TableCell>
                      {r.riskLevel ? (
                        <Badge variant="outline" className="font-normal">
                          {r.riskLevel}
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>{r.totalScore ?? "—"}</TableCell>
                    <TableCell>
                      <Badge
                        className={
                          r.daysOverdue > 7
                            ? "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200"
                            : "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                        }
                      >
                        {r.daysOverdue}d
                      </Badge>
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <Link
                        href={`/admin/residents/${r.residentId}`}
                        className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}
                        aria-label={`Open ${r.residentName}`}
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

async function fetchOverdueAssessments(selectedFacilityId: string | null): Promise<Row[]> {
  const today = easternDateString();
  const supabase = createClient();
  let q = supabase
    .from("assessments" as never)
    .select("id, resident_id, facility_id, assessment_type, assessment_date, next_due_date, risk_level, total_score")
    .is("deleted_at", null)
    .not("next_due_date", "is", null)
    .lte("next_due_date", today)
    .order("next_due_date", { ascending: true })
    .limit(500);

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    q = q.eq("facility_id", selectedFacilityId);
  }

  const res = (await q) as unknown as QueryListResult<SupabaseAssessment>;
  if (res.error) throw res.error;
  const assessments = res.data ?? [];
  if (assessments.length === 0) return [];

  const residentIds = [...new Set(assessments.map((a) => a.resident_id))];
  const resRes = (await supabase
    .from("residents" as never)
    .select("id, first_name, last_name")
    .in("id", residentIds)
    .is("deleted_at", null)) as unknown as QueryListResult<SupabaseResidentMini>;
  if (resRes.error) throw resRes.error;
  const resById = new Map((resRes.data ?? []).map((r) => [r.id, r] as const));

  const todayMs = parseISODateOnly(today);

  return assessments.map((a) => {
    const rm = resById.get(a.resident_id);
    const name = rm
      ? `${rm.first_name ?? ""} ${rm.last_name ?? ""}`.trim() || "Unknown"
      : "Unknown";
    const dueMs = parseISODateOnly(a.next_due_date);
    const daysOverdue = Number.isNaN(dueMs) || Number.isNaN(todayMs) ? 0 : Math.max(0, Math.round((todayMs - dueMs) / 86400000));
    const score =
      a.total_score == null ? null : typeof a.total_score === "number" ? String(a.total_score) : String(a.total_score);

    return {
      id: a.id,
      residentId: a.resident_id,
      residentName: name,
      assessmentType: a.assessment_type,
      assessmentDate: formatDisplayDate(a.assessment_date),
      nextDueDate: formatDisplayDate(a.next_due_date),
      daysOverdue,
      riskLevel: a.risk_level,
      totalScore: score,
    };
  });
}

function formatDisplayDate(iso: string): string {
  const t = parseISODateOnly(iso);
  if (Number.isNaN(t)) return iso;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(t));
}

function formatType(t: string): string {
  return t.replace(/_/g, " ");
}

const mockRows: Row[] = [
  {
    id: "mock-a1",
    residentId: "00000000-0000-4000-8000-000000000001",
    residentName: "Demo Resident",
    assessmentType: "braden",
    assessmentDate: "Jan 1, 2026",
    nextDueDate: "Mar 15, 2026",
    daysOverdue: 12,
    riskLevel: "moderate",
    totalScore: "14",
  },
];
