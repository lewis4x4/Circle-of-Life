/**
 * Human-readable labels, grouping, and formatting for report executor output.
 * Used by run preview, CSV export, and print/PDF popup HTML.
 */

export type MetricFormat = "integer" | "percent" | "currency_cents" | "decimal" | "text";

export type MetricPresentation = {
  label: string;
  /** Used for grouped UI and print section ordering */
  group: string;
  groupOrder: number;
  format: MetricFormat;
};

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** Canonical presentation for executor metric keys (extend when adding executors). */
export const METRIC_PRESENTATION: Record<string, MetricPresentation> = {
  // Executive KPI snapshot (shared across several template slugs)
  occupiedResidents: {
    label: "Occupied residents",
    group: "Census & occupancy",
    groupOrder: 10,
    format: "integer",
  },
  licensedBeds: {
    label: "Licensed beds",
    group: "Census & occupancy",
    groupOrder: 10,
    format: "integer",
  },
  occupancyPct: {
    label: "Occupancy",
    group: "Census & occupancy",
    groupOrder: 10,
    format: "percent",
  },
  openInvoices: {
    label: "Open invoices",
    group: "Financial",
    groupOrder: 20,
    format: "integer",
  },
  balanceDueCents: {
    label: "Total balance due",
    group: "Financial",
    groupOrder: 20,
    format: "currency_cents",
  },
  openIncidents: {
    label: "Open incidents",
    group: "Clinical & safety",
    groupOrder: 30,
    format: "integer",
  },
  medicationErrorsMtd: {
    label: "Medication events (MTD)",
    group: "Clinical & safety",
    groupOrder: 30,
    format: "integer",
  },
  openSurveyDeficiencies: {
    label: "Open survey deficiencies",
    group: "Compliance",
    groupOrder: 40,
    format: "integer",
  },
  certificationsExpiring30d: {
    label: "Certifications expiring (30d)",
    group: "Workforce",
    groupOrder: 50,
    format: "integer",
  },
  activeOutbreaks: {
    label: "Active outbreaks",
    group: "Infection control",
    groupOrder: 60,
    format: "integer",
  },
  // AR aging
  arOpenInvoiceCount: {
    label: "Open AR invoices",
    group: "AR aging — summary",
    groupOrder: 15,
    format: "integer",
  },
  arTotalBalanceCents: {
    label: "Total AR balance",
    group: "AR aging — summary",
    groupOrder: 15,
    format: "currency_cents",
  },
  arNotYetDueCents: {
    label: "Current (not past due)",
    group: "AR aging — buckets",
    groupOrder: 16,
    format: "currency_cents",
  },
  arDays1To30Cents: {
    label: "Past due 1–30 days",
    group: "AR aging — buckets",
    groupOrder: 16,
    format: "currency_cents",
  },
  arDays31To60Cents: {
    label: "Past due 31–60 days",
    group: "AR aging — buckets",
    groupOrder: 16,
    format: "currency_cents",
  },
  arDays61To90Cents: {
    label: "Past due 61–90 days",
    group: "AR aging — buckets",
    groupOrder: 16,
    format: "currency_cents",
  },
  arDaysOver90Cents: {
    label: "Past due over 90 days",
    group: "AR aging — buckets",
    groupOrder: 16,
    format: "currency_cents",
  },
  // Incidents
  incidentsRecorded30d: {
    label: "Incidents recorded (30 days)",
    group: "Incident trends",
    groupOrder: 35,
    format: "integer",
  },
  incidentsFallRelated30d: {
    label: "Fall-related (30 days)",
    group: "Incident trends",
    groupOrder: 35,
    format: "integer",
  },
  incidentsMedicationRelated30d: {
    label: "Medication-related (30 days)",
    group: "Incident trends",
    groupOrder: 35,
    format: "integer",
  },
  openIncidentsSnapshot: {
    label: "Open incidents (current)",
    group: "Incident trends",
    groupOrder: 35,
    format: "integer",
  },
  // Staffing
  shiftAssignmentsScheduled14d: {
    label: "Shift assignments scheduled (14 days)",
    group: "Staffing coverage",
    groupOrder: 55,
    format: "integer",
  },
  coverageDayShifts14d: {
    label: "Day shifts",
    group: "Staffing coverage",
    groupOrder: 55,
    format: "integer",
  },
  coverageEveningShifts14d: {
    label: "Evening shifts",
    group: "Staffing coverage",
    groupOrder: 55,
    format: "integer",
  },
  coverageNightShifts14d: {
    label: "Night shifts",
    group: "Staffing coverage",
    groupOrder: 55,
    format: "integer",
  },
  // Labor
  timePunches30d: {
    label: "Time punches (30 days)",
    group: "Labor & overtime",
    groupOrder: 56,
    format: "integer",
  },
  overtimeHoursTotal30d: {
    label: "Overtime hours (30 days)",
    group: "Labor & overtime",
    groupOrder: 56,
    format: "decimal",
  },
  distinctStaffWithOvertime30d: {
    label: "Staff with overtime (30 days)",
    group: "Labor & overtime",
    groupOrder: 56,
    format: "integer",
  },
  // Medication
  medicationErrorsYtd: {
    label: "Medication events (YTD)",
    group: "Medication",
    groupOrder: 36,
    format: "integer",
  },
  // Rounding / resident assurance
  roundingTasksDue7d: {
    label: "Rounding tasks due (7 days)",
    group: "Resident assurance",
    groupOrder: 37,
    format: "integer",
  },
  roundingTasksCompleted7d: {
    label: "Tasks completed on time (7 days)",
    group: "Resident assurance",
    groupOrder: 37,
    format: "integer",
  },
  roundingTasksOverdue7d: {
    label: "Tasks overdue (7 days)",
    group: "Resident assurance",
    groupOrder: 37,
    format: "integer",
  },
  roundingOnTimePct7d: {
    label: "Task closure rate (7 days)",
    group: "Resident assurance",
    groupOrder: 37,
    format: "percent",
  },
  // Training (extended)
  activeStaffCount: {
    label: "Active staff (org scope)",
    group: "Training & credentials",
    groupOrder: 57,
    format: "integer",
  },
  // Survey
  surveyDeficienciesClosed30d: {
    label: "Deficiencies closed (30 days)",
    group: "Survey readiness",
    groupOrder: 41,
    format: "integer",
  },
};

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function humanizeKey(key: string): string {
  const withSpaces = key.replace(/([A-Z])/g, " $1").replace(/_/g, " ");
  const trimmed = withSpaces.trim();
  if (!trimmed) return key;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function resolvePresentation(key: string): MetricPresentation {
  const found = METRIC_PRESENTATION[key];
  if (found) return found;
  return {
    label: humanizeKey(key),
    group: "Other",
    groupOrder: 100,
    format: "text",
  };
}

export function formatMetricValue(
  value: string | number | null | undefined,
  format: MetricFormat,
): string {
  if (value === null || value === undefined) return "—";
  if (format === "text") return String(value);
  if (typeof value === "string" && value.trim() === "") return "—";

  const n = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(n)) return String(value);

  switch (format) {
    case "integer":
      return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
    case "percent":
      return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(n)}%`;
    case "currency_cents":
      return money.format(n / 100);
    case "decimal":
      return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(n);
    default:
      return String(value);
  }
}

export type SummaryRow = { key: string; value: string | number | null };

export function summaryRowsToCsv(rows: SummaryRow[]): string {
  if (rows.length === 0) return "";
  const escape = (value: string) =>
    /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  const lines = [
    ["metric_key", "metric_label", "value"].map(escape).join(","),
    ...rows.map((row) => {
      const pres = resolvePresentation(row.key);
      const formatted = formatMetricValue(row.value, pres.format);
      return [row.key, pres.label, formatted].map(escape).join(",");
    }),
  ];
  return lines.join("\n");
}

export function detailRowsToCsv(rows: Record<string, string | number | null>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (value: string) =>
    /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  const humanHeader = (h: string) => resolvePresentation(h).label;
  const lines = [
    headers.map((h) => escape(humanHeader(h))).join(","),
    ...rows.map((row) => headers.map((h) => escape(String(row[h] ?? ""))).join(",")),
  ];
  return lines.join("\n");
}

/** Full print document: branded layout, works in browser print-to-PDF. */
export function buildReportPrintHtml(props: {
  reportTitle: string;
  templateLabel: string;
  scopeLabel: string;
  summary: SummaryRow[];
  footnotes?: string[];
}): string {
  const { reportTitle, templateLabel, scopeLabel, summary, footnotes } = props;
  const generatedAt = new Date().toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const byGroup = new Map<string, SummaryRow[]>();
  for (const row of summary) {
    const pres = resolvePresentation(row.key);
    const list = byGroup.get(pres.group) ?? [];
    list.push(row);
    byGroup.set(pres.group, list);
  }

  const orderedGroups = [...byGroup.entries()].sort((a, b) => {
    const oa = Math.min(...a[1].map((r) => resolvePresentation(r.key).groupOrder));
    const ob = Math.min(...b[1].map((r) => resolvePresentation(r.key).groupOrder));
    return oa - ob || a[0].localeCompare(b[0]);
  });

  const sectionHtml = orderedGroups
    .map(([groupName, groupRows]) => {
      const body = groupRows
        .map((row) => {
          const pres = resolvePresentation(row.key);
          const formatted = formatMetricValue(row.value, pres.format);
          return `<tr><td>${escapeHtml(pres.label)}</td><td class="num">${escapeHtml(formatted)}</td></tr>`;
        })
        .join("");
      return `<section class="grp"><h2>${escapeHtml(groupName)}</h2><table class="metrics"><tbody>${body}</tbody></table></section>`;
    })
    .join("");

  const footHtml =
    footnotes && footnotes.length > 0
      ? `<footer class="notes"><p><strong>Notes</strong></p><ul>${footnotes.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul></footer>`
      : "";

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${escapeHtml(reportTitle)}</title>
<style>
  :root { --ink: #0f172a; --muted: #64748b; --line: #e2e8f0; --band: #f8fafc; --accent: #4f46e5; }
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; margin: 0; color: var(--ink); background: #fff; font-size: 11pt; line-height: 1.45; }
  .sheet { max-width: 720px; margin: 0 auto; padding: 24px 28px 48px; }
  .brand { display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid var(--accent); padding-bottom: 12px; margin-bottom: 20px; }
  .brand h1 { margin: 0; font-size: 1.35rem; font-weight: 700; letter-spacing: -0.02em; }
  .brand .product { font-size: 0.75rem; font-weight: 700; color: var(--accent); text-transform: uppercase; letter-spacing: 0.12em; }
  .meta { font-size: 0.85rem; color: var(--muted); margin-bottom: 24px; }
  .meta strong { color: var(--ink); font-weight: 600; }
  .grp { margin-bottom: 22px; page-break-inside: avoid; }
  .grp h2 { font-size: 0.7rem; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); font-weight: 700; }
  table.metrics { width: 100%; border-collapse: collapse; font-size: 0.95rem; }
  table.metrics td { padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
  table.metrics td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; font-weight: 600; }
  table.metrics tr:nth-child(even) td { background: var(--band); }
  .foot { margin-top: 28px; padding-top: 12px; border-top: 1px solid var(--line); font-size: 0.72rem; color: var(--muted); }
  footer.notes { margin-top: 20px; font-size: 0.8rem; color: var(--muted); }
  footer.notes ul { margin: 8px 0 0 18px; padding: 0; }
  @page { size: letter; margin: 14mm 16mm; }
  @media print {
    body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    .sheet { padding: 8px 0 32px; max-width: none; }
    .brand { page-break-after: avoid; }
    .grp { page-break-inside: avoid; }
  }
</style></head><body><div class="sheet">
  <div class="brand">
    <div>
      <div class="product">Haven</div>
      <h1>${escapeHtml(reportTitle)}</h1>
    </div>
  </div>
  <div class="meta">
    <strong>Template</strong> ${escapeHtml(templateLabel)}
    · <strong>Scope</strong> ${escapeHtml(scopeLabel)}
    · <strong>Generated</strong> ${escapeHtml(generatedAt)}
  </div>
  ${sectionHtml}
  ${footHtml}
  <p class="foot">Confidential — Circle of Life operations. Values reflect live aggregates at generation time. Use your browser &ldquo;Print&rdquo; dialog and choose &ldquo;Save as PDF&rdquo; where available.</p>
</div></body></html>`;
}
