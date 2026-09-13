import { describe, it, expect } from "vitest";
import { collectHistoryExport, historyExportCsv, type HistoryExportManifest, type HistoryExportRow } from "./history-export";
const rows = (count: number): HistoryExportRow[] => Array.from({ length: count }, (_, n) => ({ id: `row-${n}`, subject_id: null, authority_class: "facility", activity_name: n === 0 ? "  =SUM(1,2)" : "Check", status: "completed", created_at: "2026-09-12T12:00:00Z", receipts: [{ id: `receipt-${n}`, revision: "v1" }, { id: `corrected-${n}`, corrects_receipt_id: `receipt-${n}`, revision: "v2" }], evidence: [], source_events: [] }));
const manifest = (count: number): HistoryExportManifest => ({ schema_version: 1, generated_at: "2026-09-12T13:00:00Z", snapshot_id: "1:2:", filters: { facility_id: "site", activity_id: "activity" }, total: count, receipt_total: count * 2, evidence_total: 0, complete: true, source: "Haven", coverage: "Authorized history" });
const page = (all: HistoryExportRow[], offset: number, size = 73) => ({ export_id: "export", manifest: manifest(all.length), offset, rows: all.slice(offset, offset + size), next_offset: offset + size < all.length ? offset + size : null });
describe("durable history export assembly", () => {
  it("collects >1000 tied rows under smaller provider page caps with full correction chains", async () => {
    const all = rows(1201), offsets: number[] = [];
    const result = await collectHistoryExport(async offset => { offsets.push(offset); return page(all, offset); }, "export");
    expect(result.rows).toEqual(all); expect(offsets).toHaveLength(17);
    const csv = historyExportCsv(result.manifest, result.rows);
    expect(csv.split("\r\n")).toHaveLength(1204); expect(csv).toContain("corrected-1200");
    expect(csv).toContain('"\'  =SUM(1,2)"'); expect(csv).toContain('""complete"":true');
  });
  it("keeps empty success explicit", async () => {
    const result = await collectHistoryExport(async offset => page([], offset), "export");
    expect(historyExportCsv(result.manifest, result.rows)).toContain('""total"":0');
  });
  it("discards a later-page failure and can retry the same snapshot", async () => {
    const all = rows(1001);
    await expect(collectHistoryExport(async offset => { if (offset >= 146) throw new Error("connection interrupted"); return page(all, offset); }, "export")).rejects.toThrow("interrupted");
    expect((await collectHistoryExport(async offset => page(all, offset), "export")).rows).toHaveLength(1001);
  });
  it.each(["manifest", "duplicate", "short", "empty", "cursor", "receipts", "foreign"])("rejects %s corruption instead of producing partial success", async kind => {
    const all = rows(1001);
    await expect(collectHistoryExport(async offset => {
      const p = page(all, offset);
      if (offset) {
        if (kind === "manifest") p.manifest.snapshot_id = "different";
        if (kind === "duplicate") p.rows[0] = all[0];
        if (kind === "short") p.next_offset = null;
        if (kind === "empty") p.rows = [];
        if (kind === "cursor") p.next_offset = 0;
        if (kind === "receipts") p.rows[0] = { ...p.rows[0], receipts: [] };
        if (kind === "foreign") p.export_id = "foreign";
      }
      return p;
    }, "export")).rejects.toThrow();
  });
});
