"use client";

import type { ReactNode } from "react";
import {
  Activity,
  Building2,
  ClipboardList,
  HeartPulse,
  Landmark,
  Shield,
  Stethoscope,
  Users,
  Wallet,
} from "lucide-react";

import {
  formatMetricValue,
  resolvePresentation,
  type SummaryRow,
} from "@/lib/reports/metric-presentation";
import { MotionItem, MotionList } from "@/components/ui/motion-list";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const GROUP_ICONS: Record<string, ReactNode> = {
  "Census & occupancy": <Building2 className="h-4 w-4 text-sky-400" aria-hidden />,
  "AR aging — summary": <Wallet className="h-4 w-4 text-amber-400" aria-hidden />,
  "AR aging — buckets": <Wallet className="h-4 w-4 text-amber-400" aria-hidden />,
  Financial: <Landmark className="h-4 w-4 text-emerald-400" aria-hidden />,
  "Clinical & safety": <Stethoscope className="h-4 w-4 text-rose-400" aria-hidden />,
  "Incident trends": <Activity className="h-4 w-4 text-orange-400" aria-hidden />,
  Compliance: <Shield className="h-4 w-4 text-violet-400" aria-hidden />,
  "Survey readiness": <ClipboardList className="h-4 w-4 text-violet-400" aria-hidden />,
  Workforce: <Users className="h-4 w-4 text-cyan-400" aria-hidden />,
  "Training & credentials": <Users className="h-4 w-4 text-cyan-400" aria-hidden />,
  "Infection control": <HeartPulse className="h-4 w-4 text-lime-400" aria-hidden />,
  "Staffing coverage": <Users className="h-4 w-4 text-indigo-400" aria-hidden />,
  "Labor & overtime": <Activity className="h-4 w-4 text-fuchsia-400" aria-hidden />,
  Medication: <Stethoscope className="h-4 w-4 text-pink-400" aria-hidden />,
  "Resident assurance": <Shield className="h-4 w-4 text-teal-400" aria-hidden />,
  "Executive pack": <Landmark className="h-4 w-4 text-indigo-400" aria-hidden />,
  Other: <ClipboardList className="h-4 w-4 text-slate-400" aria-hidden />,
};

function groupIcon(groupName: string) {
  return GROUP_ICONS[groupName] ?? <Activity className="h-4 w-4 text-slate-400" aria-hidden />;
}

function buildGrouped(summary: SummaryRow[]) {
  const map = new Map<string, SummaryRow[]>();
  for (const row of summary) {
    const g = resolvePresentation(row.key).group;
    const list = map.get(g) ?? [];
    list.push(row);
    map.set(g, list);
  }
  return [...map.entries()].sort((a, b) => {
    const oa = Math.min(...a[1].map((r) => resolvePresentation(r.key).groupOrder));
    const ob = Math.min(...b[1].map((r) => resolvePresentation(r.key).groupOrder));
    return oa - ob || a[0].localeCompare(b[0]);
  });
}

type ReportRunResultProps = {
  summary: SummaryRow[];
  detailRows: Record<string, string | number | null>[];
};

export function ReportRunResult({ summary, detailRows }: ReportRunResultProps) {
  const grouped = buildGrouped(summary);

  return (
    <div className="space-y-8">
      {grouped.map(([groupName, rows]) => (
        <section key={groupName} className="space-y-3">
          <div className="flex items-center gap-2">
            {groupIcon(groupName)}
            <h4 className="text-sm font-semibold tracking-tight text-slate-800 dark:text-slate-100">
              {groupName}
            </h4>
          </div>
          <MotionList className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((row) => {
              const pres = resolvePresentation(row.key);
              const display = formatMetricValue(row.value, pres.format);
              return (
                <MotionItem key={row.key}>
                  <div className="flex h-full flex-col justify-between rounded-2xl border border-slate-200/80 bg-white/70 p-4 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-slate-900/50">
                    <p className="text-xs font-medium leading-snug text-slate-600 dark:text-slate-300">
                      {pres.label}
                    </p>
                    <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-slate-900 dark:text-white">
                      {display}
                    </p>
                  </div>
                </MotionItem>
              );
            })}
          </MotionList>
        </section>
      ))}

      {detailRows.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-slate-400" aria-hidden />
            <h4 className="text-sm font-semibold tracking-tight text-slate-800 dark:text-slate-100">
              Detail rows
            </h4>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-slate-200/80 dark:border-white/10">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-200 dark:border-white/10 hover:bg-transparent">
                  {Object.keys(detailRows[0]).map((col) => (
                    <TableHead
                      key={col}
                      className="text-xs font-semibold text-slate-600 dark:text-slate-300"
                    >
                      {resolvePresentation(col).label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {detailRows.slice(0, 500).map((row, i) => (
                  <TableRow
                    key={i}
                    className="border-slate-200 dark:border-white/10 font-mono text-xs text-slate-800 dark:text-slate-200"
                  >
                    {Object.keys(detailRows[0]).map((col) => (
                      <TableCell key={col} className="max-w-[240px] truncate">
                        {row[col] == null ? "—" : String(row[col])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {detailRows.length > 500 && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Showing first 500 rows. Export CSV for the full extract.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
