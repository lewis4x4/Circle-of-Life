"use client";

import React from "react";
import Link from "next/link";
import { Loader2, Users } from "lucide-react";
import { useFacility } from "@/hooks/useFacility";

interface StaffingTabProps {
  facilityId: string;
}

export function StaffingTab({ facilityId }: StaffingTabProps) {
  const { facility, isLoading, error } = useFacility(facilityId);

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
      <div className="rounded-lg border border-slate-200/50 dark:border-white/10 bg-white p-6 space-y-3">
        <h3 className="font-semibold flex items-center gap-2">
          <Users className="h-5 w-5 text-teal-600" />
          Key roles
        </h3>
        <div className="text-sm grid gap-2 sm:grid-cols-2">
          <div>
            <p className="text-[10px] font-mono tracking-widest uppercase font-semibold text-slate-500 dark:text-slate-400">Administrator (recorded)</p>
            <p className="font-medium">{facility.administrator_name ?? "—"}</p>
          </div>
          <div>
            <p className="text-[10px] font-mono tracking-widest uppercase font-semibold text-slate-500 dark:text-slate-400">Ratio rule set</p>
            <p className="font-medium font-mono text-xs break-all">
              {facility.facility_ratio_rule_set_id ?? "—"}
            </p>
          </div>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Detailed staffing ratios, schedules, and certifications live in Workforce hubs.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/admin/staff"
          className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-2 text-sm font-medium text-teal-900 hover:bg-teal-100"
        >
          Staff roster
        </Link>
        <Link
          href="/admin/staffing"
          className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-2 text-sm font-medium text-teal-900 hover:bg-teal-100"
        >
          Staffing alerts
        </Link>
        <Link
          href="/admin/schedules"
          className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-2 text-sm font-medium text-teal-900 hover:bg-teal-100"
        >
          Schedules
        </Link>
      </div>
    </div>
  );
}
