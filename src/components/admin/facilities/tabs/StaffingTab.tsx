"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Users } from "lucide-react";
import { useFacility } from "@/hooks/useFacility";
import { createClient } from "@/lib/supabase/client";
import { formatStaffRoleLabel } from "@/lib/staff/load-staff";
import { RecordDetailSection } from "@/design-system/components/record-detail";

interface StaffingTabProps {
  facilityId: string;
}

type StaffSummaryRow = {
  id: string;
  staff_role: string;
  employment_status: string;
};

export function StaffingTab({ facilityId }: StaffingTabProps) {
  const { facility, isLoading, error } = useFacility(facilityId);
  const [staffRows, setStaffRows] = useState<StaffSummaryRow[]>([]);
  const [staffLoading, setStaffLoading] = useState(true);
  const [staffError, setStaffError] = useState<string | null>(null);

  const loadStaffSummary = useCallback(async () => {
    setStaffLoading(true);
    setStaffError(null);
    try {
      const supabase = createClient();
      const { data, error: queryError } = await supabase
        .from("staff" as never)
        .select("id, staff_role, employment_status")
        .eq("facility_id", facilityId)
        .is("deleted_at", null)
        .order("staff_role", { ascending: true });

      if (queryError) throw queryError;
      setStaffRows((data ?? []) as unknown as StaffSummaryRow[]);
    } catch (err) {
      setStaffRows([]);
      setStaffError(err instanceof Error ? err.message : "Failed to load staff summary");
    } finally {
      setStaffLoading(false);
    }
  }, [facilityId]);

  useEffect(() => {
    void loadStaffSummary();
  }, [loadStaffSummary]);

  const activeStaffCount = staffRows.filter((row) => row.employment_status === "active").length;
  const roleBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of staffRows) {
      counts.set(row.staff_role, (counts.get(row.staff_role) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([role, count]) => ({ role, count }));
  }, [staffRows]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !facility) {
    return <p className="text-destructive text-sm">{error ?? "Not found"}</p>;
  }

  return (
    <div className="space-y-6">
      <RecordDetailSection
        title="Key roles"
        action={<Users className="h-4 w-4 text-muted-foreground" />}
        description="Detailed staffing ratios, schedules, and certifications live in Workforce hubs. This summary reads the live staff roster for the selected facility."
      >
        <div className="text-sm grid gap-2 sm:grid-cols-3">
          <div>
            <p className="text-[10px] font-medium tracking-wider uppercase text-muted-foreground">Administrator (recorded)</p>
            <p className="font-medium text-foreground mt-1">{facility.administrator_name ?? "—"}</p>
          </div>
          <div>
            <p className="text-[10px] font-medium tracking-wider uppercase text-muted-foreground">Active staff rows</p>
            <p className="font-medium tabular-nums text-foreground mt-1">{staffLoading ? "Loading…" : activeStaffCount}</p>
          </div>
          <div>
            <p className="text-[10px] font-medium tracking-wider uppercase text-muted-foreground">Ratio rule set</p>
            <p className="font-medium text-xs break-all text-foreground mt-1">
              {facility.facility_ratio_rule_set_id ?? "—"}
            </p>
          </div>
        </div>

        {staffError ? (
          <p className="rounded-[8px] border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            Staff roster summary could not load: {staffError}
          </p>
        ) : null}

        {!staffLoading && roleBreakdown.length > 0 ? (
          <div className="flex flex-wrap gap-2 pt-1">
            {roleBreakdown.map(({ role, count }) => (
              <span
                key={role}
                className="rounded-[8px] border border-border bg-muted/10 px-3 py-1 text-xs font-medium text-foreground"
              >
                {formatStaffRoleLabel(role)}: <span className="tabular-nums">{count}</span>
              </span>
            ))}
          </div>
        ) : null}
      </RecordDetailSection>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/admin/staff"
          className="rounded-[8px] border border-border bg-muted/10 px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/20 transition-colors"
        >
          Staff roster
        </Link>
        <Link
          href="/admin/staffing"
          className="rounded-[8px] border border-border bg-muted/10 px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/20 transition-colors"
        >
          Staffing alerts
        </Link>
        <Link
          href="/admin/schedules"
          className="rounded-[8px] border border-border bg-muted/10 px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/20 transition-colors"
        >
          Schedules
        </Link>
      </div>
    </div>
  );
}
