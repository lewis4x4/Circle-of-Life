"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ClipboardCheck, Plus } from "lucide-react";

import { AdminEmptyState, AdminFilterBar, AdminLiveDataFallbackNotice, AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { formatLiveDataLoadError } from "@/lib/live-data-fallback";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import {
  RecordDetailHeader,
  RecordDetailSection,
} from "@/design-system/components/record-detail";

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
  low: "border-success/20 bg-success/10 text-success",
  standard: "border-warning/20 bg-warning/10 text-warning",
  high: "border-destructive/30 bg-destructive/10 text-destructive",
  level_1: "border-success/20 bg-success/10 text-success",
  level_2: "border-warning/20 bg-warning/10 text-warning",
  level_3: "border-destructive/30 bg-destructive/10 text-destructive",
  none: "border-success/20 bg-success/10 text-success",
  mild: "border-success/20 bg-success/10 text-success",
  moderate: "border-warning/20 bg-warning/10 text-warning",
  very_high: "border-destructive/30 bg-destructive/10 text-destructive",
  minimal: "border-success/20 bg-success/10 text-success",
  moderately_severe: "border-warning/20 bg-warning/10 text-warning",
  severe: "border-destructive/30 bg-destructive/10 text-destructive",
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

      let q = supabase
        .from("assessments")
        .select("id, assessment_type, assessment_date, total_score, risk_level, assessed_by")
        .eq("resident_id", residentId)
        .is("deleted_at", null)
        .order("assessment_date", { ascending: false });

      if (facilityFilter) q = q.eq("facility_id", facilityFilter);

      const [{ data: resident }, { data, error: qErr }] = await Promise.all([
        supabase
          .from("residents")
          .select("first_name, last_name")
          .eq("id", residentId)
          .maybeSingle(),
        q,
      ]);
      if (resident) setResidentName(`${resident.first_name ?? ""} ${resident.last_name ?? ""}`.trim());
      if (qErr) throw new Error(qErr.message);

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
      setError(formatLiveDataLoadError(err, "Failed to load assessments"));
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
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-[var(--motion-duration)]">
        <RecordDetailHeader
          title="Assessments"
          subtitle={`${rows.length} assessment${rows.length !== 1 ? "s" : ""} on record${residentName ? ` · ${residentName}` : ""}`}
          backLink={{ label: "Back to profile", href: `/admin/residents/${residentId}` }}
          actions={
            <Link
              href={`/admin/residents/${residentId}/assessments/new`}
              className={cn(buttonVariants({ size: "sm" }), "font-medium")}
            >
              <Plus className="h-4 w-4 mr-1.5" /> New assessment
            </Link>
          }
        />

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
          <RecordDetailSection title="Assessment history">
            <div className="w-full overflow-hidden">
              <div className="hidden lg:grid grid-cols-[auto_1fr_1fr_0.5fr_1fr] gap-4 px-2 pb-3 border-b border-border text-right first:text-left [&>*:nth-child(2)]:text-left [&>*:nth-child(3)]:text-left">
                <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground text-left min-w-[120px]">Date</div>
                <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-2"><ClipboardCheck className="w-3.5 h-3.5 text-muted-foreground" /> Type</div>
                <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Risk level</div>
                <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Score</div>
                <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground text-right">Assessed by</div>
              </div>

              <div className="space-y-2 mt-3">
                <MotionList className="space-y-2">
                  {filtered.map((r) => (
                    <MotionItem key={r.id}>
                      <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr_1fr_0.5fr_1fr] gap-4 lg:items-center p-[14px] rounded-[8px] bg-card border border-border shadow-[var(--shadow-card)] tap-responsive group hover:border-primary/20 hover:-translate-y-0.5 transition-all duration-[var(--motion-duration)] w-full outline-none">

                        <div className="flex flex-col min-w-[120px]">
                          <span className="lg:hidden text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Date</span>
                          <span className="tabular-nums text-sm text-foreground">{r.assessmentDate}</span>
                        </div>

                        <div className="flex flex-col">
                          <span className="lg:hidden text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Type</span>
                          <span className="font-semibold text-base text-foreground truncate tracking-tight">{formatType(r.assessmentType)}</span>
                        </div>

                        <div className="flex flex-col items-start lg:items-start">
                          <span className="lg:hidden text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Risk level</span>
                          {r.riskLevel ? (
                            <Badge className={cn("px-2 py-0.5 text-[10px] uppercase font-bold tracking-wider shadow-none", RISK_COLORS[r.riskLevel] ?? "bg-muted text-muted-foreground border-border")}>
                              {r.riskLevel.replace(/_/g, " ")}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </div>

                        <div className="flex flex-col lg:items-end">
                          <span className="lg:hidden text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Score</span>
                          <span className="tabular-nums text-xl font-medium text-foreground">{r.totalScore !== null ? r.totalScore : "—"}</span>
                        </div>

                        <div className="flex flex-row justify-between lg:justify-end items-center">
                          <span className="lg:hidden text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Assessed by</span>
                          <span className="text-sm font-medium text-muted-foreground">
                            {r.assessedBy}
                          </span>
                        </div>
                      </div>
                    </MotionItem>
                  ))}
                </MotionList>
              </div>
            </div>
          </RecordDetailSection>
        )}
      </div>
    </div>
  );
}
