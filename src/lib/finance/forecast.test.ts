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

describe("COL-650 forecast reports no data as no data", () => {
  const facilities = [{ id: "facility-a", name: "Synthetic facility", entity_id: "entity-a" }];
  const overdueMay = {
    id: "invoice-a",
    facility_id: "facility-a",
    resident_id: "resident-a",
    invoice_date: "2026-05-01",
    due_date: "2026-05-15",
    total: 282_608,
    balance_due: 169_680,
    status: "overdue" as const,
  };

  it("leaves DSO and efficiency undefined when nothing was sent in the window", () => {
    const result = buildDsoForecast({
      facilities,
      openInvoices: [overdueMay],
      billedInvoices90d: [],
      payments90d: [],
      trustEntries: [],
    });
    expect(result.summary.openArCents).toBe(169_680);
    expect(result.summary.trailing90BilledCount).toBe(0);
    expect(result.summary.trailing90PaymentCount).toBe(0);
    expect(result.summary.currentDsoDays).toBeNull();
    expect(result.summary.projected30DayDsoDays).toBeNull();
    expect(result.summary.collectionEfficiencyPct).toBeNull();
    expect(result.rows[0]?.currentDsoDays).toBeNull();
  });

  it("never counts a draft as open AR or as billed", () => {
    const draft = { ...overdueMay, id: "invoice-d", invoice_date: "2026-09-01", status: "draft" as const };
    const result = buildDsoForecast({
      facilities,
      openInvoices: [draft],
      billedInvoices90d: [draft],
      payments90d: [],
      trustEntries: [],
    });
    expect(result.summary.openArCents).toBe(0);
    expect(result.summary.trailing90BilledCents).toBe(0);
    expect(result.summary.trailing90BilledCount).toBe(0);
  });

  it("computes DSO once something was sent", () => {
    const sent = { ...overdueMay, id: "invoice-s", invoice_date: "2026-09-01", status: "sent" as const, total: 90_000, balance_due: 90_000 };
    const result = buildDsoForecast({
      facilities,
      openInvoices: [sent],
      billedInvoices90d: [sent],
      payments90d: [],
      trustEntries: [],
    });
    expect(result.summary.currentDsoDays).toBe(90);
    expect(result.summary.collectionEfficiencyPct).toBe(0);
  });
});
