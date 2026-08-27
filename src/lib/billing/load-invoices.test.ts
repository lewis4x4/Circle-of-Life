import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  fetchInvoicesFromSupabase,
  INVOICE_HUB_LIMIT,
  mapDbInvoiceStatusToUi,
  mapDbPayerTypeToUi,
} from "./load-invoices";

type FakeQueryResult = {
  data: Array<{
    id: string;
    resident_id: string;
    facility_id: string;
    invoice_number: string;
    status: string;
    balance_due: number;
    total: number;
    invoice_date: string;
    due_date: string;
    updated_at: string;
    payer_type: string | null;
    deleted_at: string | null;
    residents: { first_name: string | null; last_name: string | null } | null;
  }> | null;
  error: { message: string } | null;
};

function makeSupabaseStub(result: FakeQueryResult, calls: Array<[string, string, unknown]>) {
  const query = {
    select() {
      return this;
    },
    is() {
      return this;
    },
    order() {
      return this;
    },
    limit() {
      return this;
    },
    eq(column: string, value: unknown) {
      calls.push(["eq", column, value]);
      return this;
    },
    then(resolve: (value: FakeQueryResult) => unknown) {
      return Promise.resolve(result).then(resolve);
    },
  };

  return {
    from() {
      return query;
    },
  };
}

describe("load-invoices", () => {
  it("maps invoice rows with resident ids and display fields", async () => {
    const calls: Array<[string, string, unknown]> = [];
    const supabase = makeSupabaseStub(
      {
        data: [
          {
            id: "inv-1",
            resident_id: "res-1",
            facility_id: "fac-1",
            invoice_number: "INV-1001",
            status: "partial",
            balance_due: 12500,
            total: 20000,
            invoice_date: "2026-05-01",
            due_date: "2026-05-15",
            updated_at: "2026-05-20T14:05:00Z",
            payer_type: "medicaid_oss",
            deleted_at: null,
            residents: { first_name: "Alex", last_name: "Morgan" },
          },
        ],
        error: null,
      },
      calls,
    );

    const rows = await fetchInvoicesFromSupabase(
      "123e4567-e89b-12d3-a456-426614174000",
      "123e4567-e89b-12d3-a456-426614174001",
      supabase as never,
    );

    expect(rows).toEqual([
      expect.objectContaining({
        id: "inv-1",
        residentId: "res-1",
        residentName: "Alex Morgan",
        facilityId: "fac-1",
        invoiceNumber: "INV-1001",
        payerType: "medicaid",
        status: "partial",
        amountDueCents: 12500,
        totalCents: 20000,
        dueDateIso: "2026-05-15",
        invoiceDateIso: "2026-05-01",
      }),
    ]);
    expect(calls).toEqual([
      ["eq", "facility_id", "123e4567-e89b-12d3-a456-426614174000"],
      ["eq", "resident_id", "123e4567-e89b-12d3-a456-426614174001"],
    ]);
  });

  it("formats internal persist keys for operator-facing invoice numbers", async () => {
    const supabase = makeSupabaseStub(
      {
        data: [
          {
            id: "b5000000-0000-0000-0000-0000000000a1",
            resident_id: "c0000000-0000-0000-0000-0000000000a1",
            facility_id: "00000000-0000-0000-0002-000000000001",
            invoice_number: "00000000-2026-08-c0000000-0000-0000-0000-0000000000a1",
            status: "sent",
            balance_due: 0,
            total: 0,
            adjustments: 0,
            invoice_date: "2026-08-01",
            due_date: "2026-08-15",
            updated_at: "2026-08-01T12:00:00Z",
            payer_type: "private_pay",
            deleted_at: null,
            residents: { first_name: "Alex", last_name: "Morgan" },
          },
        ],
        error: null,
      },
      [],
    );

    const rows = await fetchInvoicesFromSupabase(null, null, supabase as never);

    expect(rows[0]?.invoiceNumber).toBe("Invoice Aug 2026 · …00a1");
    expect(rows[0]?.invoiceNumber).not.toContain("00000000-2026-08");
    expect(rows[0]?.amountDueCents).toBe(0);
    expect(rows[0]?.totalCents).toBe(0);
  });

  it("skips invalid facility and resident filters", async () => {
    const calls: Array<[string, string, unknown]> = [];
    const supabase = makeSupabaseStub({ data: [], error: null }, calls);

    await fetchInvoicesFromSupabase("oakridge", "resident-1", supabase as never);

    expect(calls).toEqual([]);
  });

  it("caps the hub fetch with a named limit", () => {
    const source = readFileSync(path.resolve(import.meta.dirname, "./load-invoices.ts"), "utf8");
    expect(INVOICE_HUB_LIMIT).toBe(200);
    expect(source).toContain(".limit(INVOICE_HUB_LIMIT)");
    expect(source).not.toContain(".limit(200)");
  });

  it("normalizes payer and status values to UI-safe enums", () => {
    expect(mapDbPayerTypeToUi("va_aid_attendance")).toBe("ltc_insurance");
    expect(mapDbPayerTypeToUi("unexpected")).toBe("private_pay");
    expect(mapDbInvoiceStatusToUi("written_off")).toBe("written_off");
    expect(mapDbInvoiceStatusToUi("mystery_status")).toBe("draft");
  });
});
