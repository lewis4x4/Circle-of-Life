import { describe, expect, it } from "vitest";
import { buildPayrollPacketCsv, buildPayrollPacketHtml, buildPayrollPacketPdf } from "./documents";
import { payrollTotals } from "./compute";
import type { PacketRow, PayrollPacket } from "./types";

const row: PacketRow = { staffId: "staff", payrollId: "0001", name: "Test Employee", role: "resident_aide", payBasis: "hourly", department: "operations", regularMinutes: 2100, overtimeMinutes: 120, holidayMinutes: 60, personalMinutes: 0, trainingMinutes: 30, onCallCents: 2500, bonusCents: 5000, salaryCents: null, note: "Reviewed", reason: "Signed sheet", reviewed: true, workedMinutes: 2250, mealMinutes: 60, paidWorkMinutes: 2250, paidMinutes: 2310, issues: [], sourcePunchIds: ["p"], sourceCorrectionIds: [] };
function packet(rows: PacketRow[] = [row]): PayrollPacket {
  return { id: "packet-123", root_id: "packet-123", amends_packet_id: null, version: 1, revision: 1, organization_id: "org", facility_id: "facility", period_start: "2026-09-21", period_end: "2026-09-27", check_date: "2026-10-02", status: "draft", inputs: [], snapshot: { schemaVersion: 1, facilityId: "facility", facilityName: "Test facility", employerName: "Test employer", periodStart: "2026-09-21", periodEnd: "2026-09-27", checkDate: "2026-10-02", generatedAt: "2026-09-28T10:00:00Z", sourceRevision: "source-1", policy: { salaryTreatment: "hours" }, policyConfirmedAt: null, rows, totals: payrollTotals(rows), blockers: ["Confirm policy"], warnings: [] }, source_revision: "source-1", policy_revision: 1, created_at: "2026-09-28T10:00:00Z", created_by: "preparer", updated_at: "2026-09-28T10:00:00Z", approved_at: null, approved_by: null, approved_by_name: null, document_hash: null, reported_at: null, reported_by: null, report_method: null, report_reference: null, reconciled_at: null, reconciled_by: null, reconciliation_note: null, amendment_reason: null };
}

describe("payroll packet documents", () => {
  it("HTML follows outline units, department totals, metadata and human handoff state", () => {
    const html = buildPayrollPacketHtml(packet());
    for (const text of ["DRAFT — NOT APPROVED FOR PAYROLL", "Regular (h)", "On call ($)", "$25.00", "$50.00", "38.50", "Operations total", "Facility total", "Test employer", "2026-10-02", "Actual worked: 37.50 h", "RUN online entry", "Not recorded", "Staffing compliance is not assessed"]) expect(html).toContain(text);
    expect(html).toContain("@page{size:letter landscape"); expect(html).toContain("table-header-group");
  });
  it("escapes every dynamic HTML surface and keeps long notes outside table cells", () => {
    const p = packet([{ ...row, name: '<img src=x onerror="alert(1)">', payrollId: "<script>x</script>", note: "<script>alert(1)</script>" + "x".repeat(12000) }]);
    p.snapshot.facilityName = "<svg onload=alert(1)>"; p.report_reference = '<a href="evil">';
    const html = buildPayrollPacketHtml(p);
    expect(html).not.toContain("<script>"); expect(html).not.toContain("<svg "); expect(html).not.toContain("<img ");
    expect(html).toContain("&lt;script&gt;"); expect(html).toContain("x".repeat(12000));
    expect(html.slice(html.indexOf("<table"), html.indexOf("</table>"))).not.toContain("x".repeat(12000));
  });
  it("CSV preserves exact Unicode names, whole-minute/cents units and neutralizes formulas", () => {
    const p = packet([{ ...row, name: "Zoë 李", payrollId: "=HYPERLINK(\"bad\")", note: " \t+SUM(1,2)\nnext line", reason: "@evil" }]);
    p.report_reference = "-1+2";
    const csv = buildPayrollPacketCsv(p);
    expect(csv).toContain("Zoë 李"); expect(csv).toContain('"Regular minutes"'); expect(csv).toContain('"2100"'); expect(csv).toContain('"2500"');
    expect(csv).toContain("'=HYPERLINK"); expect(csv).toContain("' \t+SUM"); expect(csv).toContain("'@evil"); expect(csv).toContain("'-1+2");
  });
  it("PDF has valid byte offsets, landscape pages, totals and escaped strings", () => {
    const bytes = buildPayrollPacketPdf(packet([{ ...row, name: "Test (Employee) \\ A" }]));
    const pdf = bytes.toString();
    expect(pdf).toMatch(/^%PDF-1.4/); expect(pdf).toContain("/MediaBox [0 0 792 612]"); expect(pdf).toContain("DRAFT - NOT APPROVED FOR PAYROLL");
    expect(pdf).toContain("Test \\(Employee\\)"); expect(pdf).toContain("$25.00"); expect(pdf).toContain("38.50"); expect(pdf).toContain("Facility total");
    const start = Number(pdf.match(/startxref\n(\d+)/)![1]); expect(bytes.subarray(start, start + 4).toString()).toBe("xref");
    const offsets = pdf.slice(start).split("\n").slice(3).filter((line) => /^\d{10} 00000 n/.test(line));
    offsets.forEach((line, index) => expect(bytes.subarray(Number(line.slice(0, 10))).toString().startsWith(`${index + 1} 0 obj\n`)).toBe(true));
    for (const match of pdf.matchAll(/\/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)) expect(Buffer.byteLength(match[2])).toBe(Number(match[1]));
  });
  it("paginates a large roster and long notes without losing the last row/note", () => {
    const p = packet(Array.from({ length: 90 }, (_, i) => ({ ...row, staffId: `staff-${i}`, name: `Employee ${i + 1}`, note: i === 89 ? `${"longnote ".repeat(2000)}FINAL-NOTE-MARKER` : "" })));
    const pdf = buildPayrollPacketPdf(p).toString();
    expect(Number(pdf.match(/\/Count (\d+)/)![1])).toBeGreaterThan(8);
    expect(pdf).toContain("Employee 90"); expect(pdf).toContain("FINAL-NOTE-MARKER"); expect(pdf.match(/Regular/g)!.length).toBeGreaterThan(2);
    const textPositions = [...pdf.matchAll(/Tf \d+(?:\.\d+)? (\d+(?:\.\d+)?) Td/g)].map((m) => Number(m[1]));
    expect(Math.min(...textPositions)).toBeGreaterThanOrEqual(23); expect(Math.max(...textPositions)).toBeLessThanOrEqual(586);
  });
  it("clearly discloses PDF Unicode fallback; HTML/CSV retain exact names", () => {
    const p = packet([{ ...row, name: "Zoë 李" }]);
    expect(buildPayrollPacketPdf(p).toString()).toContain("Zoe ?");
    expect(buildPayrollPacketPdf(p).toString()).toContain("ASCII approximations");
    expect(buildPayrollPacketHtml(p)).toContain("Zoë 李"); expect(buildPayrollPacketCsv(p)).toContain("Zoë 李");
  });
  it("renders captured human names rather than actor UUIDs, with honest missing-name fallbacks", () => {
    const p = packet();
    p.created_by = "00000000-0000-0000-0000-000000000001";
    p.reported_by = "00000000-0000-0000-0000-000000000002";
    p.reconciled_by = "00000000-0000-0000-0000-000000000003";
    p.created_by_name = "Prepare Person"; p.reported_by_name = "Report Person"; p.reconciled_by_name = "Reconcile Person";
    for (const document of [buildPayrollPacketHtml(p), buildPayrollPacketPdf(p).toString(), buildPayrollPacketCsv(p)]) {
      for (const name of ["Prepare Person", "Report Person", "Reconcile Person"]) expect(document).toContain(name);
      for (const id of [p.created_by, p.reported_by, p.reconciled_by]) expect(document).not.toContain(id);
      expect(document).toContain(p.id);
    }
    p.created_by_name = null; p.reported_by_name = undefined; p.reconciled_by_name = " ";
    const html = buildPayrollPacketHtml(p);
    expect(html).toContain("Prepared by: Not recorded"); expect(html).toContain("By: Not recorded");
    for (const id of [p.created_by, p.reported_by, p.reconciled_by]) expect(html).not.toContain(id);
  });
  it("approved salary packet keeps salary dollars separate and records approver/report metadata", () => {
    const p = packet([{ ...row, payBasis: "salary", salaryCents: 225000, regularMinutes: null, overtimeMinutes: null, paidMinutes: null }]);
    p.status = "approved"; p.approved_by_name = "Approver"; p.approved_at = "2026-09-28T12:00:00Z"; p.snapshot.policy = { salaryTreatment: "amount" }; p.snapshot.blockers = []; p.snapshot.totals = payrollTotals(p.snapshot.rows, "amount");
    const html = buildPayrollPacketHtml(p); expect(html).toContain("Salary $2250.00"); expect(html).toContain("N/A"); expect(html).toContain("Approved by: Approver"); expect(html).not.toContain("DRAFT — NOT APPROVED");
  });
});
