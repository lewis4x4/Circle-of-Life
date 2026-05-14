"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Users } from "lucide-react";
import { useFacility } from "@/hooks/useFacility";
import { createClient } from "@/lib/supabase/client";
import { formatStaffRoleLabel } from "@/lib/staff/load-staff";

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
        <Loader2 className="h-8 w-8 animate-spin text-teal-500" />
      </div>
    );
  }

  if (error || !facility) {
    return <p className="text-destructive text-sm">{error ?? "Not found"}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200/50 dark:border-white/10 bg-white p-6 space-y-4">
        <h3 className="font-semibold flex items-center gap-2">
          <Users className="h-5 w-5 text-teal-400" />
          Key roles
        </h3>
        <div className="text-sm grid gap-2 sm:grid-cols-3">
          <div>
            <p className="text-[10px] font-mono tracking-widest uppercase font-semibold text-slate-500 dark:text-slate-400">Administrator (recorded)</p>
            <p className="font-medium">{facility.administrator_name ?? "—"}</p>
          </div>
          <div>
            <p className="text-[10px] font-mono tracking-widest uppercase font-semibold text-slate-500 dark:text-slate-400">Active staff rows</p>
            <p className="font-medium">{staffLoading ? "Loading…" : activeStaffCount}</p>
          </div>
          <div>
            <p className="text-[10px] font-mono tracking-widest uppercase font-semibold text-slate-500 dark:text-slate-400">Ratio rule set</p>
            <p className="font-medium font-mono text-xs break-all">
              {facility.facility_ratio_rule_set_id ?? "—"}
            </p>
          </div>
        </div>

        {staffError ? (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
            Staff roster summary could not load: {staffError}
          </p>
        ) : null}

        {!staffLoading && roleBreakdown.length > 0 ? (
          <div className="flex flex-wrap gap-2 pt-1">
            {roleBreakdown.map(({ role, count }) => (
              <span
                key={role}
                className="rounded-full border border-slate-200/70 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200"
              >
                {formatStaffRoleLabel(role)}: {count}
              </span>
            ))}
          </div>
        ) : null}

        <p className="text-xs text-slate-500 dark:text-slate-400">
          Detailed staffing ratios, schedules, and certifications live in Workforce hubs. This summary reads the live staff roster for the selected facility.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/admin/staff"
          className="rounded-lg border border-teal-500/20 bg-teal-500/10 px-4 py-2 text-sm font-medium text-teal-300 hover:bg-teal-500/100/20"
        >
          Staff roster
        </Link>
        <Link
          href="/admin/staffing"
          className="rounded-lg border border-teal-500/20 bg-teal-500/10 px-4 py-2 text-sm font-medium text-teal-300 hover:bg-teal-500/100/20"
        >
          Staffing alerts
        </Link>
        <Link
          href="/admin/schedules"
          className="rounded-lg border border-teal-500/20 bg-teal-500/10 px-4 py-2 text-sm font-medium text-teal-300 hover:bg-teal-500/100/20"
        >
          Schedules
        </Link>
      </div>
    </div>
  );
}
