import type { MorningHuddleData } from "@/lib/office/morning-huddle";

function escapeHtml(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDateLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function humanize(value: string): string {
  return value.replace(/_/g, " ");
}

const MOVE_LABEL: Record<string, string> = {
  move_in: "Move-in today",
  move_out: "Move-out today",
  planned_move_out: "Planned move-out",
};

/**
 * Standalone print HTML (same approach as the executive standup board print
 * document): self-contained styles so the one-pager prints identically
 * regardless of app shell CSS.
 */
export function buildMorningHuddlePrintHtml(
  data: MorningHuddleData,
  facilityName: string,
): string {
  const incidentRows = data.overnightIncidents
    .map(
      (i) => `<tr>
        <td>${escapeHtml(i.incidentNumber)}</td>
        <td>${escapeHtml(humanize(i.category))}</td>
        <td>${escapeHtml(humanize(i.severity))}${i.ahcaReportable ? ' <span class="tag risk">AHCA</span>' : ""}</td>
        <td>${escapeHtml(i.residentName ?? "—")}</td>
        <td>${escapeHtml(formatTime(i.occurredAt))}</td>
        <td>${escapeHtml(humanize(i.status))}</td>
      </tr>`,
    )
    .join("");

  const rosterByShift = new Map<string, typeof data.shiftRoster>();
  for (const row of data.shiftRoster) {
    const list = rosterByShift.get(row.shiftType) ?? [];
    list.push(row);
    rosterByShift.set(row.shiftType, list);
  }
  const rosterBlocks = [...rosterByShift.entries()]
    .map(
      ([shiftType, rows]) => `<div class="roster-block">
        <h4>${escapeHtml(humanize(shiftType))} shift (${rows.length})</h4>
        <ul>${rows
          .map(
            (r) =>
              `<li>${escapeHtml(r.staffName)}${
                r.status === "called_out" || r.status === "no_show"
                  ? ` <span class="tag risk">${escapeHtml(humanize(r.status))}</span>`
                  : ""
              }</li>`,
          )
          .join("")}</ul>
      </div>`,
    )
    .join("");

  const oceRows = data.openOceTasks
    .map(
      (t) => `<tr>
        <td>${escapeHtml(t.templateName)}${t.licenseThreatening ? ' <span class="tag risk">license</span>' : ""}</td>
        <td>${escapeHtml(humanize(t.templateCategory))}</td>
        <td>${escapeHtml(t.priority)}</td>
        <td>${escapeHtml(t.assignedShift ? humanize(t.assignedShift) : "—")}</td>
        <td>${escapeHtml(t.assignedShiftDate)}</td>
        <td>${escapeHtml(humanize(t.status))}</td>
      </tr>`,
    )
    .join("");

  const medRows = data.medFlags
    .map(
      (m) => `<tr>
        <td>${escapeHtml(m.residentName)}</td>
        <td>${escapeHtml(humanize(m.status))}</td>
        <td>${escapeHtml(formatTime(m.scheduledTime))}</td>
        <td>${escapeHtml(m.reason ?? "—")}</td>
      </tr>`,
    )
    .join("");

  const moveRows = data.residentMoves
    .map(
      (m) =>
        `<li>${escapeHtml(m.residentName)} — ${escapeHtml(MOVE_LABEL[m.kind] ?? humanize(m.kind))}</li>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Morning huddle — ${escapeHtml(facilityName)} — ${escapeHtml(data.dateIso)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #111827; margin: 24px; font-size: 12px; }
  header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #111827; padding-bottom: 8px; margin-bottom: 14px; }
  h1 { font-size: 18px; margin: 0; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; margin: 18px 0 6px; border-bottom: 1px solid #d1d5db; padding-bottom: 3px; }
  h4 { margin: 6px 0 2px; font-size: 12px; }
  .meta { color: #6b7280; font-size: 11px; }
  .kpis { display: flex; gap: 16px; margin: 10px 0; }
  .kpi { border: 1px solid #d1d5db; border-radius: 6px; padding: 8px 14px; }
  .kpi .num { font-size: 20px; font-weight: 700; }
  .kpi .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th, td { text-align: left; padding: 3px 6px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  th { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; }
  ul { margin: 2px 0 8px; padding-left: 18px; }
  .tag { display: inline-block; font-size: 9px; font-weight: 700; text-transform: uppercase; padding: 1px 5px; border-radius: 4px; border: 1px solid currentColor; }
  .tag.risk { color: #b91c1c; }
  .empty { color: #6b7280; font-style: italic; }
  .roster { display: flex; gap: 24px; flex-wrap: wrap; }
  footer { margin-top: 18px; padding-top: 6px; border-top: 1px solid #d1d5db; color: #6b7280; font-size: 10px; }
  @media print { body { margin: 10mm; } }
</style>
</head>
<body>
<header>
  <h1>Morning huddle — ${escapeHtml(facilityName)}</h1>
  <div class="meta">${escapeHtml(formatDateLabel(data.dateIso))} · generated ${escapeHtml(formatTime(data.generatedAt))} ET</div>
</header>

<div class="kpis">
  <div class="kpi"><div class="num">${data.census}</div><div class="lbl">Current census</div></div>
  <div class="kpi"><div class="num">${data.overnightIncidents.length}</div><div class="lbl">Incidents (24h)</div></div>
  <div class="kpi"><div class="num">${data.openOceTasks.length}</div><div class="lbl">Open ops tasks</div></div>
  <div class="kpi"><div class="num">${data.medFlags.length}</div><div class="lbl">Med flags (24h)</div></div>
  <div class="kpi"><div class="num">${data.overdueScheduledDoses}</div><div class="lbl">Overdue doses</div></div>
</div>

<h2>Overnight incidents (last 24 hours)</h2>
${
  incidentRows
    ? `<table><thead><tr><th>#</th><th>Category</th><th>Severity</th><th>Resident</th><th>Occurred</th><th>Status</th></tr></thead><tbody>${incidentRows}</tbody></table>`
    : '<p class="empty">No incidents recorded in the last 24 hours.</p>'
}

<h2>Census moves (${escapeHtml(data.dateIso)})</h2>
${moveRows ? `<ul>${moveRows}</ul>` : '<p class="empty">No move-ins or move-outs today.</p>'}

<h2>Today's shift roster</h2>
${rosterBlocks ? `<div class="roster">${rosterBlocks}</div>` : '<p class="empty">No shift assignments scheduled for today.</p>'}

<h2>Open operations tasks (due through today)</h2>
${
  oceRows
    ? `<table><thead><tr><th>Task</th><th>Category</th><th>Priority</th><th>Shift</th><th>Date</th><th>Status</th></tr></thead><tbody>${oceRows}</tbody></table>`
    : '<p class="empty">No open operations tasks.</p>'
}

<h2>Medication flags (last 24 hours)</h2>
${
  medRows
    ? `<table><thead><tr><th>Resident</th><th>Status</th><th>Scheduled</th><th>Reason</th></tr></thead><tbody>${medRows}</tbody></table>`
    : '<p class="empty">No refused, held, or unavailable doses in the last 24 hours.</p>'
}

<footer>
  Internal operations document — contains resident information; handle per facility privacy policy.
  Generated from Haven live data; times shown in America/New_York.
</footer>
</body>
</html>`;
}
