import { describe, expect, it } from "vitest";
import { buildDsoForecast } from "./forecast";

describe("HFA-014 HFA-016 resident funds remain separate from receivables", () => {
  it("does not offset open AR with trust money", () => {
    const result = buildDsoForecast({
      facilities: [{ id: "facility-a", name: "Synthetic facility", entity_id: "entity-a" }],
      openInvoices: [{ id: "invoice-a", facility_id: "facility-a", resident_id: "resident-a", invoice_date: "2026-09-01", due_date: "2026-09-15", total: 100000, balance_due: 100000, status: "sent" }],
      billedInvoices90d: [], payments90d: [],
      trustEntries: [{ resident_id: "resident-a", facility_id: "facility-a", entry_date: "2026-09-01", balance_after_cents: 75000 }],
    });
    expect(result.summary.openArCents).toBe(100000);
    expect(result.summary.netExposureCents).toBe(100000);
  });
});
