import { Buffer } from "node:buffer";
import { payrollTotals } from "./compute";
import type { PacketRow, PacketTotals, PayrollPacket } from "./types";

const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const hours = (minutes: number | null) => minutes == null ? "Pending" : (minutes / 60).toFixed(2);
const money = (cents: number | null) => cents == null ? "Pending" : `$${(cents / 100).toFixed(2)}`;
const headings = ["Employee / Payroll ID", "Regular (h)", "Overtime (h)", "On call ($)", "Holiday (h)", "Personal (h)", "Bonus ($)", "Training (h)", "Total paid (h)", "Instructions"];
const groupName = (group: string) => group === "administration" ? "Administration" : "Operations — Medication / Resident assistance / Housekeeping / Dietary";

function instruction(packet: PayrollPacket, row: PacketRow, index: number): string {
  const salary = row.payBasis !== "salary" ? "Hourly" : packet.snapshot.policy?.salaryTreatment === "amount" ? `Salary ${money(row.salaryCents)}` : packet.snapshot.policy?.salaryTreatment === "unchanged" ? "Salary—unchanged" : "Salary hours";
  return `${salary}${row.note || row.reason || row.issues.length ? `; see employee note ${index + 1}` : ""}`;
}
function rowCells(packet: PayrollPacket, row: PacketRow, index: number): string[] {
  const noHours = row.payBasis === "salary" && ["amount", "unchanged"].includes(packet.snapshot.policy?.salaryTreatment ?? "");
  return [`${row.name}\n${row.payrollId || "ID pending"}`, noHours ? "N/A" : hours(row.regularMinutes), noHours ? "N/A" : hours(row.overtimeMinutes), money(row.onCallCents), hours(row.holidayMinutes), hours(row.personalMinutes), money(row.bonusCents), hours(row.trainingMinutes), noHours ? "N/A" : hours(row.paidMinutes), instruction(packet, row, index)];
}
function totalCells(label: string, totals: PacketTotals): string[] {
  return [label, hours(totals.regularMinutes), hours(totals.overtimeMinutes), money(totals.onCallCents), hours(totals.holidayMinutes), hours(totals.personalMinutes), money(totals.bonusCents), hours(totals.trainingMinutes), hours(totals.paidMinutes), `Salary dollars ${money(totals.salaryCents)}`];
}
function metadata(packet: PayrollPacket): string[] {
  const s = packet.snapshot;
  return [
    `Facility: ${s.facilityName} | Employer: ${s.employerName}`,
    `Pay period: ${s.periodStart} through ${s.periodEnd} | Check date: ${s.checkDate}`,
    `Packet: ${packet.id} | Version: ${packet.version} | Status: ${packet.status.toUpperCase()}`,
    `Prepared by: ${packet.created_by_name?.trim() || "Not recorded"} | Prepared: ${packet.created_at}`,
    `Approved by: ${packet.approved_by_name?.trim() || (packet.approved_at ? "Not recorded" : "Pending")} | Approved: ${packet.approved_at ?? "Pending"}`,
    ...(packet.amends_packet_id ? [`Amends: ${packet.amends_packet_id} | Reason: ${packet.amendment_reason ?? "Not recorded"}`] : []),
  ];
}
function handoff(packet: PayrollPacket): string[] {
  return [
    "ADP HANDOFF — Use this same packet for a phone call or RUN online entry.",
    `Reported/entered: ${packet.reported_at ?? "Not recorded"} | By: ${packet.reported_by_name?.trim() || "Not recorded"}`,
    `Method: ${packet.report_method === "run" ? "RUN online" : packet.report_method === "phone" ? "Phone" : "Not recorded"} | Confirmation/reference: ${packet.report_reference ?? "Not recorded"}`,
    `Reconciled: ${packet.reconciled_at ?? "Not recorded"} | By: ${packet.reconciled_by_name?.trim() || "Not recorded"}`,
    `Reconciliation: ${packet.reconciliation_note ?? "Compare ADP employee rows and category totals with this packet and record differences/resolution in Haven."}`,
    "Printing/downloading does not record payroll submission or ADP acceptance. Tax, deductions and final payroll processing remain in ADP.",
    "Retain this approved version. Later corrections require a linked amendment and renewed approval.",
  ];
}
function supporting(packet: PayrollPacket): string[] {
  const s = packet.snapshot;
  return [
    `Actual kiosk worked hours: ${hours(s.totals.workedMinutes)}. These exclude meals and paid leave. Manual hours without kiosk evidence remain unknown.`,
    "Staffing compliance is not assessed by this payroll packet. Paid hours do not establish eligible staffing hours.",
    ...s.warnings,
    `Policy confirmed: ${s.policyConfirmedAt ?? "Pending"} | Policy revision: ${packet.policy_revision}`,
    `Calculation: ${s.policy?.calculationMode ?? "Pending"} | Workweek day (0=Sunday): ${s.policy?.workweekDay ?? "Pending"} ${s.policy?.workweekTime ?? ""} ${s.policy?.timeZone ?? ""}`,
    `Meals: ${s.policy?.mealPolicy ?? "Pending"} | Rounding interval (minutes): ${s.policy?.roundingMinutes ?? "Pending"} | Overtime threshold (hours): ${s.policy?.overtimeThresholdMinutes == null ? "Pending" : hours(s.policy.overtimeThresholdMinutes)}`,
    `Confirmed earning rules: ${s.policy?.policyNote ?? "Pending"}`,
    `Source revision: ${s.sourceRevision}`,
  ];
}

/** Printable UTF-8 document; notes flow independently of table rows to avoid clipped long cells. */
export function buildPayrollPacketHtml(packet: PayrollPacket): string {
  const s = packet.snapshot;
  const cell = (value: string) => `<td>${escapeHtml(value).replaceAll("\n", "<br>")}</td>`;
  const groups = ["administration", "operations"].map((group) => {
    const rows = s.rows.filter((r) => r.department === group);
    if (!rows.length) return "";
    return `<tbody><tr class="group"><th colspan="10">${escapeHtml(groupName(group))}</th></tr>${rows.map((row) => `<tr>${rowCells(packet, row, s.rows.indexOf(row)).map(cell).join("")}</tr>`).join("")}<tr class="total">${totalCells(`${groupName(group).split(" —")[0]} total`, payrollTotals(rows, s.policy?.salaryTreatment)).map(cell).join("")}</tr></tbody>`;
  }).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payroll packet ${escapeHtml(packet.id)} · v${packet.version}</title><style>
@page{size:letter landscape;margin:.4in}*{box-sizing:border-box}body{font:11px/1.45 Arial,sans-serif;color:#182322;margin:24px auto;max-width:1100px}h1{font-size:25px;margin:8px 0}h2{font-size:16px;margin-top:24px}.status{font-weight:bold;border:2px solid #526d68;padding:10px;font-size:15px}.draft{border-color:#9a4d24;background:#fff5e9}p{margin:5px 0;overflow-wrap:anywhere;white-space:pre-wrap}.meta{margin:12px 0}table{width:100%;border-collapse:collapse;table-layout:fixed;margin:15px 0}th,td{padding:7px 5px;border:1px solid #b9c3c0;text-align:right;vertical-align:top;overflow-wrap:anywhere}th:first-child,td:first-child,th:last-child,td:last-child{text-align:left}th:first-child{width:17%}th:last-child{width:19%}thead{display:table-header-group}thead th{background:#eef2f0}.group th{text-align:left;background:#edf2f0}.total{font-weight:bold;background:#f4f6f5}tr{break-inside:avoid}.note{margin:12px 0}.note h3{font-size:12px;break-after:avoid;margin:3px 0}.support{break-before:page}.muted{color:#48534f}ul{padding-left:20px}li{overflow-wrap:anywhere}@media print{body{max-width:none;margin:0;font-size:9px}a{color:inherit;text-decoration:none}.note,p,li{break-inside:auto}th,td{padding:5px 3px}}
</style></head><body><header><div>HAVEN · CIRCLE OF LIFE</div><h1>Payroll handoff packet</h1><div class="status ${packet.status === "draft" ? "draft" : ""}">${packet.status === "draft" ? "DRAFT — NOT APPROVED FOR PAYROLL" : escapeHtml(packet.status.toUpperCase())} · Version ${packet.version}</div><div class="meta">${metadata(packet).map((line) => `<p>${escapeHtml(line)}</p>`).join("")}</div></header>
${s.blockers.length ? `<section><h2>Approval blockers</h2><ul>${s.blockers.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul></section>` : ""}
<table aria-label="Payroll hours and dollar additions"><thead><tr>${headings.map((heading) => `<th scope="col">${escapeHtml(heading)}</th>`).join("")}</tr></thead>${groups}<tbody><tr class="total">${totalCells("Facility total", s.totals).map(cell).join("")}</tr></tbody></table><p class="muted">Hours and dollars are separate. N/A means salary is reported as an amount or unchanged; Pending means unverified. Decimal hours use two display places; exact whole minutes remain in Haven and the CSV.</p>
<section><h2>Handoff and reconciliation</h2>${handoff(packet).map((line) => `<p>${escapeHtml(line)}</p>`).join("")}</section>
<section class="support"><h2>Supporting review</h2>${supporting(packet).map((line) => `<p>${escapeHtml(line)}</p>`).join("")}<h2>Employee notes and actual kiosk hours</h2>${s.rows.map((row, index) => `<article class="note"><h3>${index + 1}. ${escapeHtml(row.name)} · ${escapeHtml(row.payrollId || "ID pending")} · ${escapeHtml(row.role)}</h3><p>Actual worked: ${hours(row.workedMinutes)} h | Meals: ${hours(row.mealMinutes)} h | ${escapeHtml(instruction(packet, row, index))}</p>${[row.note, row.reason ? `Reviewed-hours reason: ${row.reason}` : "", ...row.issues].filter(Boolean).map((line) => `<p>${escapeHtml(line)}</p>`).join("")}</article>`).join("")}</section></body></html>`;
}

/** Spreadsheet-safe cells; exact Unicode text and integer minutes are preserved. */
export function buildPayrollPacketCsv(packet: PayrollPacket): string {
  const safe = (value: unknown) => {
    let text = String(value ?? "");
    if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const header = ["Packet ID", "Version", "Status", "Facility", "Employer", "Period start", "Period end", "Check date", "Department", "Employee", "Payroll ID", "Pay basis", "Salary treatment", "Regular minutes", "Overtime minutes", "On call cents", "Holiday minutes", "Personal minutes", "Bonus cents", "Training minutes", "Total paid minutes", "Salary cents", "Actual worked minutes", "Notes", "Reviewed-hours reason", "Approved by", "Approved at", "Report method", "Report reference", "Reported at", "Reconciled at", "Prepared by", "Reported by", "Reconciled by"];
  const s = packet.snapshot;
  return "\ufeff" + [header, ...s.rows.map((r) => [packet.id, packet.version, packet.status, s.facilityName, s.employerName, s.periodStart, s.periodEnd, s.checkDate, r.department, r.name, r.payrollId, r.payBasis, r.payBasis === "salary" ? s.policy?.salaryTreatment : "", r.regularMinutes, r.overtimeMinutes, r.onCallCents, r.holidayMinutes, r.personalMinutes, r.bonusCents, r.trainingMinutes, r.paidMinutes, r.salaryCents, r.workedMinutes, r.note, r.reason, packet.approved_by_name?.trim() || "Not recorded", packet.approved_at, packet.report_method, packet.report_reference, packet.reported_at, packet.reconciled_at, packet.created_by_name?.trim() || "Not recorded", packet.reported_by_name?.trim() || "Not recorded", packet.reconciled_by_name?.trim() || "Not recorded"])].map((row) => row.map(safe).join(",")).join("\r\n") + "\r\n";
}

function pdfText(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[\u2010-\u2015]/g, "-").replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[^\x20-\x7e\n]/g, "?");
}
function wrap(value: string, count: number): string[] {
  return pdfText(value).split("\n").flatMap((line) => {
    const result: string[] = [];
    while (line.length > count) {
      const space = line.lastIndexOf(" ", count), cut = space > 0 ? space : count;
      result.push(line.slice(0, cut)); line = line.slice(cut).trimStart();
    }
    return [...result, line];
  });
}

/** Letter-landscape PDF with base Courier, explicit Unicode fallback, and repeated headers. */
export function buildPayrollPacketPdf(packet: PayrollPacket): Buffer {
  const pages: string[][] = [[]];
  let y = 562;
  const pdfEscape = (text: string) => pdfText(text).replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  const draw = (text: string, x: number, at: number, size = 8) => pages[pages.length - 1].push(`BT /F1 ${size} Tf ${x} ${at} Td (${pdfEscape(text)}) Tj ET`);
  const newPage = () => { pages.push([]); y = 562; };
  const ensure = (height: number) => { if (y - height < 42) newPage(); };
  const line = (text: string, size = 9) => {
    for (const part of wrap(text, Math.floor(728 / (size * .6)))) { ensure(13); draw(part, 32, y, size); y -= 13; }
  };
  for (const text of metadata(packet)) line(text);
  y -= 6;
  line("Hours and dollars are separate. Pending = unverified; N/A = salary amount/unchanged.");
  const widths = [112, 48, 48, 54, 48, 48, 54, 48, 54, 164];
  const tableRow = (cells: string[], isHeading = false) => {
    const wrapped = cells.map((text, i) => wrap(text, Math.floor((widths[i] - 8) / 4.5)));
    const rowHeight = Math.max(...wrapped.map((lines) => lines.length)) * 10 + 8;
    if (y - rowHeight < 42) { newPage(); if (!isHeading) tableRow(headings, true); }
    const count = Math.max(...wrapped.map((lines) => lines.length));
    for (let j = 0; j < count; j++) {
      if (y - 14 < 42) { newPage(); if (!isHeading) tableRow(headings, true); }
      let x = 32;
      for (let i = 0; i < wrapped.length; i++) { if (wrapped[i][j]) draw(wrapped[i][j], x + 3, y - 10, 7.5); x += widths[i]; }
      y -= 10;
    }
    y -= 8;
    pages[pages.length - 1].push(`0.75 G 32 ${y + 2} m 760 ${y + 2} l S 0 G`);
  };
  tableRow(headings, true);
  for (const group of ["administration", "operations"]) {
    const rows = packet.snapshot.rows.filter((row) => row.department === group);
    if (!rows.length) continue;
    ensure(54); y -= 12; line(groupName(group), 9);
    for (const row of rows) tableRow(rowCells(packet, row, packet.snapshot.rows.indexOf(row)));
    tableRow(totalCells(`${group === "administration" ? "Administration" : "Operations"} total`, payrollTotals(rows, packet.snapshot.policy?.salaryTreatment)));
  }
  tableRow(totalCells("Facility total", packet.snapshot.totals));
  y -= 10;
  for (const text of handoff(packet)) line(text);
  newPage(); line("SUPPORTING REVIEW", 11);
  line("PDF uses ASCII approximations for names/text. Exact Unicode names are retained in the HTML and UTF-8 CSV.");
  for (const text of supporting(packet)) line(text);
  if (packet.snapshot.blockers.length) { y -= 10; line("APPROVAL BLOCKERS", 11); for (const issue of packet.snapshot.blockers) line(issue); }
  for (const [index, row] of packet.snapshot.rows.entries()) {
    y -= 10; ensure(42);
    line(`${index + 1}. ${row.name} | ${row.payrollId || "ID pending"} | ${row.role}`, 10);
    line(`Actual worked: ${hours(row.workedMinutes)} h | Meals: ${hours(row.mealMinutes)} h | ${instruction(packet, row, index)}`);
    for (const text of [row.note, row.reason ? `Reviewed-hours reason: ${row.reason}` : "", ...row.issues].filter(Boolean)) line(text);
  }
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>"];
  const pageIds: number[] = [];
  pages.forEach((page, index) => {
    const pageId = objects.length + 1; pageIds.push(pageId);
    const banner = packet.status === "draft" ? "DRAFT - NOT APPROVED FOR PAYROLL" : packet.status.toUpperCase();
    const stream = [`BT /F1 10 Tf 32 586 Td (HAVEN | PAYROLL PACKET | ${banner} | v${packet.version}) Tj ET`, ...page, `BT /F1 7 Tf 32 23 Td (${pdfEscape(packet.snapshot.facilityName)} | ${pdfEscape(packet.id)} | Page ${index + 1} of ${pages.length}) Tj ET`].join("\n");
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  });
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
