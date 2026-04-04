"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ChevronRight, ClipboardCheck, Plus } from "lucide-react";

import {
  AdminEmptyState,
  AdminFilterBar,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const TYPE_LABELS: Record<string, string> = {
  katz_adl: "Katz ADL",
  morse_fall: "Morse Fall Scale",
  braden: "Braden Scale",
  phq9: "PHQ-9",
};

function formatType(t: string): string {
  return TYPE_LABELS[t] ?? t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const RISK_COLORS: Record<string, string> = {
  low: "bg-emerald-900/60 text-emerald-200",
  standard: "bg-amber-900/60 text-amber-200",
  high: "bg-red-900/60 text-red-200",
  level_1: "bg-emerald-900/60 text-emerald-200",
  level_2: "bg-amber-900/60 text-amber-200",
  level_3: "bg-red-900/60 text-red-200",
  none: "bg-emerald-900/60 text-emerald-200",
  mild: "bg-emerald-900/60 text-emerald-200",
  moderate: "bg-amber-900/60 text-amber-200",
  very_high: "bg-red-900/60 text-red-200",
  minimal: "bg-emerald-900/60 text-emerald-200",
  moderately_severe: "bg-orange-900/60 text-orange-200",
  severe: "bg-red-900/60 text-red-200",
};

type Row = {
  id: string;
  assessmentType: string;
  assessmentDate: string;
  totalScore: number | null;
  riskLevel: string | null;
  assessedBy: string;
};

export default function ResidentAssessmentHistoryPage() {
  const params = useParams<{ id: string }>();
  const residentId = params?.id ?? "";
  const { selectedFacilityId } = useFacilityStore();
  const supabase = useMemo(() => createClient(), []);

  const [rows, setRows] = useState<Row[]>([]);
  const [residentName, setResidentName] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState("all");

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const facilityFilter = isValidFacilityIdForQuery(selectedFacilityId) ? selectedFacilityId : undefined;

      // Fetch resident name
      const { data: resident } = await supabase
        .from("residents")
        .select("first_name, last_name")
        .eq("id", residentId)
        .maybeSingle();
      if (resident) setResidentName(`${resident.first_name ?? ""} ${resident.last_name ?? ""}`.trim());

      // Fetch assessments
      let q = supabase
        .from("assessments")
        .select("id, assessment_type, assessment_date, total_score, risk_level, assessed_by")
        .eq("resident_id", residentId)
        .is("deleted_at", null)
        .order("assessment_date", { ascending: false });

      if (facilityFilter) q = q.eq("facility_id", facilityFilter);

      const { data, error: qErr } = await q;
      if (qErr) throw new Error(qErr.message);

      // Fetch assessor names
      const userIds = [...new Set((data ?? []).map((a) => a.assessed_by).filter(Boolean))];
      const nameMap = new Map<string, string>();
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("user_profiles")
          .select("id, full_name")
          .in("id", userIds);
        for (const p of profiles ?? []) nameMap.set(p.id, p.full_name ?? "Staff");
      }

      setRows(
        (data ?? []).map((a) => ({
          id: a.id,
          assessmentType: a.assessment_type,
          assessmentDate: a.assessment_date,
          totalScore: typeof a.total_score === "number" ? a.total_score : null,
          riskLevel: a.risk_level,
          assessedBy: nameMap.get(a.assessed_by) ?? "Staff",
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load assessments");
    } finally {
      setIsLoading(false);
    }
  }, [supabase, residentId, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const typeOptions = useMemo(() => {
    const types = [...new Set(rows.map((r) => r.assessmentType))].sort();
    return [{ value: "all", label: "All types" }, ...types.map((t) => ({ value: t, label: formatType(t) }))];
  }, [rows]);

  const filtered = useMemo(() => {
    if (typeFilter === "all") return rows;
    return rows.filter((r) => r.assessmentType === typeFilter);
  }, [rows, typeFilter]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href={`/admin/residents/${residentId}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to Profile
        </Link>
      </div>

      <Card className="border-slate-700/50 bg-slate-900/80">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg text-slate-100">
              <ClipboardCheck className="h-5 w-5 text-cyan-400" />
              Assessment History{residentName ? ` — ${residentName}` : ""}
            </CardTitle>
            <CardDescription className="text-slate-400">
              {rows.length} assessment{rows.length !== 1 ? "s" : ""} on record
            </CardDescription>
          </div>
          <Link
            href={`/admin/residents/${residentId}/assessments/new`}
            className={cn(buttonVariants({ size: "sm" }), "gap-1")}
          >
            <Plus className="h-4 w-4" /> New Assessment
          </Link>
        </CardHeader>

        <CardContent className="space-y-4">
          <AdminFilterBar
            searchPlaceholder="Filter by type…"
            searchValue=""
            onSearchChange={() => {}}
            filters={[{ id: "type", value: typeFilter, onChange: setTypeFilter, options: typeOptions }]}
            onReset={() => setTypeFilter("all")}
          />

          {isLoading && <AdminTableLoadingState />}
          {error && <AdminLiveDataFallbackNotice message={error} onRetry={load} />}
          {!isLoading && !error && filtered.length === 0 && (
            <AdminEmptyState
              title="No assessments yet"
              description="Complete the first assessment to establish baseline scores."
            />
          )}
          {!isLoading && !error && filtered.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-slate-700/50">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-700/50 hover:bg-transparent">
                    <TableHead className="text-slate-400">Date</TableHead>
                    <TableHead className="text-slate-400">Type</TableHead>
                    <TableHead className="text-slate-400">Score</TableHead>
                    <TableHead className="text-slate-400">Risk Level</TableHead>
                    <TableHead className="text-slate-400">Assessed By</TableHead>
                    <TableHead className="w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow key={r.id} className="border-slate-700/40 text-slate-200">
                      <TableCell className="font-mono text-sm">{r.assessmentDate}</TableCell>
                      <TableCell>{formatType(r.assessmentType)}</TableCell>
                      <TableCell>{r.totalScore !== null ? r.totalScore : "—"}</TableCell>
                      <TableCell>
                        {r.riskLevel ? (
                          <Badge className={cn("text-xs", RISK_COLORS[r.riskLevel] ?? "bg-slate-700 text-slate-300")}>
                            {r.riskLevel.replace(/_/g, " ")}
                          </Badge>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-slate-400">{r.assessedBy}</TableCell>
                      <TableCell>
                        <ChevronRight className="h-4 w-4 text-slate-500" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
