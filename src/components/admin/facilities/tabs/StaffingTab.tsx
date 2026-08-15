"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Bell, Calendar, ChevronRight, Users } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SectionLabel, FieldLabel } from "@/design-system/components/record-detail";
import { createClient } from "@/lib/supabase/client";
import {
  countStaffByTaxonomy,
  FACILITY_STAFF_TAXONOMY,
  resolveRequiredRoleContext,
} from "@/lib/admin/facilities/facility-required-staff-roles";
import {
  formatStaffingTabAdministratorName,
  formatStaffingTabRosterDate,
} from "@/lib/facilities/staffing-tab-display-copy";
import type { FacilityDetailRow } from "@/types/facility";
import type { FacilityStaffKpiPayload } from "@/hooks/useFacilityStaffKpis";

interface StaffingTabProps {
  facilityId: string;
  facility: FacilityDetailRow;
  staffKpis: {
    loading: boolean;
    error: string | null;
    data: FacilityStaffKpiPayload | null;
  };
}

type StaffSummaryRow = {
  id: string;
  staff_role: string;
  employment_status: string;
};

function freshnessDays(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

function CoveragePreviewGrid({ configured }: { configured: boolean }) {
  const shifts = ["Day", "Evening", "Night"];
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <div className="space-y-3">
      {!configured ? (
        <p className="text-[13px] text-muted-foreground">
          Configure ratio rule set to enable coverage tracking —{" "}
          <Link href="/admin/staffing" className="font-medium text-foreground underline-offset-4 hover:underline">
            Configure →
          </Link>
        </p>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          Ratio rules are configured. Coverage cells stay neutral until schedule coverage data is available for this view.
        </p>
      )}
      <div className="overflow-x-auto rounded-[8px] border border-border">
        <table className="w-full min-w-[520px] border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-border bg-muted/20">
              <th className="px-2 py-2 text-left font-medium text-muted-foreground">Shift</th>
              {days.map((d) => (
                <th key={d} className="px-1 py-2 text-center font-medium text-muted-foreground">
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shifts.map((shift) => (
              <tr key={shift} className="border-b border-border last:border-b-0">
                <td className="px-2 py-2 font-medium text-foreground">{shift}</td>
                {days.map((d) => (
                  <td key={`${shift}-${d}`} className="p-1">
                    <div
                      className={`h-10 rounded-[6px] border border-border ${
                        configured ? "bg-muted/40" : "bg-muted/20 opacity-70"
                      }`}
                      title={configured ? "Coverage pending schedule data" : "Awaiting ratio rule set"}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {configured ? (
        <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
          <span>
            <span className="inline-block size-2.5 rounded-sm bg-emerald-500/80 align-middle mr-1" aria-hidden />≥100%
          </span>
          <span>
            <span className="inline-block size-2.5 rounded-sm bg-amber-400/90 align-middle mr-1" aria-hidden />
            80–99%
          </span>
          <span>
            <span className="inline-block size-2.5 rounded-sm bg-destructive/80 align-middle mr-1" aria-hidden />
            &lt;80%
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function StaffingTab({ facilityId, facility, staffKpis }: StaffingTabProps) {
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

  const reqCtx = useMemo(() => resolveRequiredRoleContext(facility), [facility]);

  const activeRoleSamples = useMemo(() => {
    return staffRows.filter((r) => r.employment_status === "active").map((r) => r.staff_role);
  }, [staffRows]);

  const taxonomyCounts = useMemo(() => countStaffByTaxonomy(activeRoleSamples), [activeRoleSamples]);

  const ratioConfigured = Boolean(facility.facility_ratio_rule_set_id);

  const kpi = staffKpis.data;
  const rosterLine = useMemo(() => {
    const rosterIso = kpi?.rosterUpdatedAt ?? null;
    const by = kpi?.rosterUpdatedByDisplayName?.trim();
    const fresh = freshnessDays(rosterIso);
    if (!rosterIso && !by && fresh == null) return null;
    const d = formatStaffingTabRosterDate(rosterIso);
    const freshnessBit =
      typeof fresh === "number" ? `· Roster freshness: ${fresh === 0 ? "today" : `${fresh} days`}` : "";
    const byBit = by ? `by ${by}` : "";
    return `Last roster update: ${d} ${byBit} ${freshnessBit}`.replace(/\s+/g, " ").trim();
  }, [kpi?.rosterUpdatedAt, kpi?.rosterUpdatedByDisplayName]);

  const navCards = [
    {
      href: "/admin/staff",
      title: "Staff roster",
      subtitle: "Full roster, profiles, and HR fields for this facility.",
      Icon: Users,
    },
    {
      href: "/admin/staffing",
      title: "Staffing alerts",
      subtitle: "Ratio thresholds, overrides, and escalation routing.",
      Icon: Bell,
    },
    {
      href: "/admin/schedules",
      title: "Schedules",
      subtitle: "Published weeks, assignments, and shift swaps.",
      Icon: Calendar,
    },
  ] as const;

  return (
    <div className="space-y-10">
      <section className="space-y-4" aria-labelledby="staffing-key-roles-heading">
        <div className="flex items-start justify-between gap-3">
          <SectionLabel id="staffing-key-roles-heading">Key roles</SectionLabel>
          <Tooltip>
            <TooltipTrigger type="button" className="rounded-md p-1 text-muted-foreground hover:bg-muted/60">
              <Users className="h-4 w-4" aria-hidden />
              <span className="sr-only">Staff snapshot source</span>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-xs">
              Staff record source: live roster from Workforce (facility-scoped query).
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="h-px w-full bg-border" />

        <div className="grid gap-6 sm:grid-cols-3">
          <div>
            <FieldLabel>Administrator of record</FieldLabel>
            <p className="mt-1 text-[13px] font-medium text-foreground">
              {formatStaffingTabAdministratorName(facility.administrator_name)}
            </p>
          </div>
          <div>
            <FieldLabel>Active staff</FieldLabel>
            <p className="mt-1 text-[13px] font-medium tabular-nums text-foreground">
              {staffLoading ? "Loading…" : staffRows.filter((r) => r.employment_status === "active").length}
            </p>
          </div>
          <div>
            <FieldLabel>Ratio rule set</FieldLabel>
            {ratioConfigured ? (
              <p className="mt-1 text-[13px] text-foreground">
                Configured —{" "}
                <Link href="/admin/staffing" className="font-medium underline-offset-4 hover:underline">
                  Manage in staffing hub →
                </Link>
              </p>
            ) : (
              <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-warning">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                <span>Not configured</span>
                <Link href="/admin/staffing" className="font-medium text-foreground underline-offset-4 hover:underline">
                  Configure →
                </Link>
              </p>
            )}
          </div>
        </div>

        {staffError ? (
          <p className="rounded-[8px] border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">
            Staff roster summary could not load: {staffError}
          </p>
        ) : null}

        <div className="space-y-2">
          <FieldLabel>Role tally (active staff)</FieldLabel>
          <p className="text-[12px] text-muted-foreground">
            Roles flagged with a warning are typically required for FL ALF operations under current assumptions and
            show zero active matches. Verify vendor-staffed or contract coverage before correcting roster data.
          </p>
          <ul className="flex flex-col gap-2 pt-1">
            {FACILITY_STAFF_TAXONOMY.map((def) => {
              const count = taxonomyCounts.get(def.key) ?? 0;
              const required = def.isRequired(reqCtx);
              const warn = required && count === 0;
              return (
                <li
                  key={def.key}
                  className={`flex items-center justify-between gap-3 rounded-[8px] border border-border px-3 py-2 text-[13px] ${
                    warn ? "bg-warning/5 border-warning/30" : "bg-muted/10"
                  }`}
                >
                  <span className={`min-w-0 flex items-center gap-2 ${count === 0 ? "text-muted-foreground" : "text-foreground"}`}>
                    {warn ? (
                      <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden />
                    ) : (
                      <span className="w-4 shrink-0" aria-hidden />
                    )}
                    <span className="truncate">{def.label}</span>
                  </span>
                  <span className="tabular-nums font-medium text-foreground">{count}</span>
                </li>
              );
            })}
          </ul>
        </div>

        {rosterLine ? <p className="text-[12px] text-muted-foreground">{rosterLine}</p> : null}
        {staffKpis.error ? (
          <p className="text-[12px] text-destructive" role="alert">
            Staffing metrics could not load: {staffKpis.error}
          </p>
        ) : null}
      </section>

      <section className="space-y-4" aria-labelledby="staffing-coverage-heading">
        <SectionLabel id="staffing-coverage-heading">Coverage next 7 days</SectionLabel>
        <div className="h-px w-full bg-border" />
        <CoveragePreviewGrid configured={ratioConfigured} />
      </section>

      <section className="space-y-4" aria-labelledby="staffing-activity-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <SectionLabel id="staffing-activity-heading">Recent staffing activity</SectionLabel>
          <Link href="/admin/staff" className="text-[13px] font-medium text-foreground underline-offset-4 hover:underline">
            View all activity →
          </Link>
        </div>
        <div className="h-px w-full bg-border" />
        <p className="text-[13px] text-muted-foreground">
          Use the staff roster for current staff records and staffing alerts for ratio exceptions.
        </p>
        <div className="rounded-[8px] border border-dashed border-border bg-muted/10 px-3 py-4 text-[13px] text-muted-foreground">
          Recent staffing events appear in the staff roster when recorded for this facility.
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="staffing-views-heading">
        <SectionLabel id="staffing-views-heading">Detailed views</SectionLabel>
        <div className="h-px w-full bg-border" />
        <div className="grid gap-3 sm:grid-cols-3">
          {navCards.map(({ href, title, subtitle, Icon }) => (
            <Link
              key={href}
              href={href}
              className="group flex items-stretch gap-3 rounded-[8px] border border-border bg-muted/10 p-4 transition-colors hover:bg-muted/20"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-foreground">
                <Icon className="h-5 w-5" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold text-foreground">{title}</p>
                <p className="mt-1 text-[12px] text-muted-foreground leading-snug">{subtitle}</p>
              </div>
              <ChevronRight
                className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
