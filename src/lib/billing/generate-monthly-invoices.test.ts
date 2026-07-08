import { describe, expect, it, vi } from "vitest";

import {
  buildMonthlyInvoicePreview,
  persistMonthlyInvoicesFromPreview,
  prorationFactorForResident,
  type PreviewLine,
} from "./generate-monthly-invoices";

type MockQueryResult = { data: unknown; error: null };

class PreviewQueryMock {
  constructor(private readonly result: MockQueryResult) {}

  select() {
    return this;
  }

  eq() {
    return this;
  }

  in() {
    return this;
  }

  is() {
    return this;
  }

  lte() {
    return this;
  }

  or() {
    return this;
  }

  order() {
    return this;
  }

  limit() {
    return this;
  }

  then<TResult1 = MockQueryResult, TResult2 = never>(
    onfulfilled?: ((value: MockQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

describe("prorationFactorForResident", () => {
  it("prorates mid-month admission", () => {
    const result = prorationFactorForResident(
      { admission_date: "2026-05-20", discharge_date: null },
      2026,
      5,
      31,
    );
    expect(result.prorated).toBe(true);
    expect(result.factor).toBeCloseTo(12 / 31);
  });

  it("prorates mid-month discharge", () => {
    const result = prorationFactorForResident(
      { admission_date: "2026-01-01", discharge_date: "2026-05-10" },
      2026,
      5,
      31,
    );
    expect(result.prorated).toBe(true);
    expect(result.factor).toBeCloseTo(10 / 31);
  });

  it("returns zero when discharged before the billing month", () => {
    const result = prorationFactorForResident(
      { admission_date: "2025-01-01", discharge_date: "2026-04-30" },
      2026,
      5,
      31,
    );
    expect(result.factor).toBe(0);
  });
});

describe("buildMonthlyInvoicePreview", () => {
  it("prorates date-only admission dates and uses due date on the 5th", async () => {
    const queryResults = new Map<string, MockQueryResult>([
      [
        "residents",
        {
          data: [
            {
              id: "resident-1",
              first_name: "Jane",
              last_name: "Doe",
              acuity_level: "level_1",
              status: "active",
              admission_date: "2026-05-20",
              discharge_date: null,
              facility_id: "facility-1",
              organization_id: "org-1",
            },
          ],
          error: null,
        },
      ],
      [
        "rate_schedules",
        {
          data: [
            {
              id: "rate-1",
              base_rate_private: 310000,
              base_rate_semi_private: null,
              care_surcharge_level_1: 0,
              care_surcharge_level_2: 0,
              care_surcharge_level_3: 0,
            },
          ],
          error: null,
        },
      ],
      ["resident_payers", { data: [], error: null }],
      ["facility_medicaid_providers", { data: [], error: null }],
      ["resident_rate_agreements", { data: [], error: null }],
      ["invoices", { data: [], error: null }],
    ]);

    const supabase = {
      from: vi.fn(
        (table: string) =>
          new PreviewQueryMock(queryResults.get(table) ?? { data: [], error: null }),
      ),
    } as never;

    const result = await buildMonthlyInvoicePreview(supabase, {
      facilityId: "facility-1",
      billingYear: 2026,
      billingMonth: 5,
    });

    expect(result.periodStart).toBe("2026-05-01");
    expect(result.periodEnd).toBe("2026-05-31");
    expect(result.dueDate).toBe("2026-05-05");
    expect(result.preview[0]).toEqual(
      expect.objectContaining({
        baseRate: 120000,
        total: 120000,
        prorated: true,
        presenceStatus: "active",
      }),
    );
  });

  it("includes hospital_hold residents at full monthly private rate", async () => {
    const queryResults = new Map<string, MockQueryResult>([
      [
        "residents",
        {
          data: [
            {
              id: "resident-hold",
              first_name: "Pat",
              last_name: "Hold",
              acuity_level: "level_1",
              status: "hospital_hold",
              admission_date: "2025-01-01",
              discharge_date: null,
              facility_id: "facility-1",
              organization_id: "org-1",
            },
          ],
          error: null,
        },
      ],
      [
        "rate_schedules",
        {
          data: [
            {
              id: "rate-1",
              base_rate_private: 310000,
              base_rate_semi_private: null,
              care_surcharge_level_1: 0,
              care_surcharge_level_2: 0,
              care_surcharge_level_3: 0,
            },
          ],
          error: null,
        },
      ],
      ["resident_payers", { data: [], error: null }],
      ["facility_medicaid_providers", { data: [], error: null }],
      ["resident_rate_agreements", { data: [], error: null }],
      ["invoices", { data: [], error: null }],
    ]);

    const supabase = {
      from: vi.fn(
        (table: string) =>
          new PreviewQueryMock(queryResults.get(table) ?? { data: [], error: null }),
      ),
    } as never;

    const result = await buildMonthlyInvoicePreview(supabase, {
      facilityId: "facility-1",
      billingYear: 2026,
      billingMonth: 5,
    });

    expect(result.preview).toHaveLength(1);
    expect(result.preview[0]).toEqual(
      expect.objectContaining({
        total: 310000,
        prorated: false,
        presenceStatus: "hospital_hold",
      }),
    );
  });

  it("uses Medicaid catalog monthly rate for medicaid_oss payers", async () => {
    const queryResults = new Map<string, MockQueryResult>([
      [
        "residents",
        {
          data: [
            {
              id: "resident-m",
              first_name: "Max",
              last_name: "Aid",
              acuity_level: "level_1",
              status: "active",
              admission_date: "2025-01-01",
              discharge_date: null,
              facility_id: "facility-1",
              organization_id: "org-1",
            },
          ],
          error: null,
        },
      ],
      [
        "rate_schedules",
        {
          data: [
            {
              id: "rate-1",
              base_rate_private: 555000,
              base_rate_semi_private: null,
              care_surcharge_level_1: 0,
              care_surcharge_level_2: 0,
              care_surcharge_level_3: 0,
            },
          ],
          error: null,
        },
      ],
      [
        "resident_payers",
        {
          data: [
            {
              resident_id: "resident-m",
              payer_type: "medicaid_oss",
              payer_name: "Florida Community Care",
              medicaid_rate: null,
              facility_medicaid_provider_id: "prov-fcc",
            },
          ],
          error: null,
        },
      ],
      [
        "facility_medicaid_providers",
        {
          data: [
            {
              id: "prov-fcc",
              default_rate_cents: 165000,
              rate_unit: "monthly",
              provider_name: "Florida Community Care",
            },
          ],
          error: null,
        },
      ],
      ["resident_rate_agreements", { data: [], error: null }],
      ["invoices", { data: [], error: null }],
    ]);

    const supabase = {
      from: vi.fn(
        (table: string) =>
          new PreviewQueryMock(queryResults.get(table) ?? { data: [], error: null }),
      ),
    } as never;

    const result = await buildMonthlyInvoicePreview(supabase, {
      facilityId: "facility-1",
      billingYear: 2026,
      billingMonth: 5,
    });

    expect(result.preview[0]).toEqual(
      expect.objectContaining({
        total: 165000,
        billingSource: "medicaid_provider_rate",
        payerType: "medicaid_oss",
      }),
    );
  });
});

describe("persistMonthlyInvoicesFromPreview", () => {
  const baseParams = {
    facilityId: "facility-1",
    billingYear: 2026,
    billingMonth: 5,
    periodStart: "2026-05-01",
    periodEnd: "2026-05-31",
    dueDate: "2026-05-05",
    preview: [
      {
        residentId: "resident-1",
        residentName: "Doe, Jane",
        payerType: "private_pay",
        payerName: "Responsible party",
        standardBaseRate: 100000,
        standardCareSurcharge: 25000,
        standardTotal: 125000,
        negotiatedBaseRate: 100000,
        negotiatedCareSurcharge: 25000,
        concessionAmount: 0,
        baseRate: 100000,
        careSurcharge: 25000,
        total: 125000,
        acuity: "Level 2",
        roomClass: "private" as const,
        billingSource: "standard_rate_schedule" as const,
        concessionReason: null,
        agreementId: null,
        prorated: false,
        presenceStatus: "active",
      } satisfies PreviewLine,
    ],
  };

  it("calls haven_create_invoice_with_line_items and counts inserts", async () => {
    const rpcMock = vi.fn().mockResolvedValue({
      data: [{ invoice_id: "inv-1", inserted: true }],
      error: null,
    });
    const supabase = { rpc: rpcMock, from: vi.fn() } as never;

    const result = await persistMonthlyInvoicesFromPreview(supabase, baseParams);

    expect(rpcMock).toHaveBeenCalledWith(
      "haven_create_invoice_with_line_items",
      expect.objectContaining({
        p_facility_id: baseParams.facilityId,
        p_resident_id: "resident-1",
        p_due_date: "2026-05-05",
        p_total: 125000,
        p_balance_due: 125000,
      }),
    );
    expect(result).toEqual({ createdCount: 1, skippedDuplicates: 0 });
  });

  it("counts duplicate skips when inserted is false", async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({
        data: [{ invoice_id: "inv-1", inserted: false }],
        error: null,
      }),
      from: vi.fn(),
    } as never;

    const result = await persistMonthlyInvoicesFromPreview(supabase, baseParams);
    expect(result).toEqual({ createdCount: 0, skippedDuplicates: 1 });
  });

  it("propagates RPC errors", async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "rpc failed" },
      }),
      from: vi.fn(),
    } as never;

    await expect(persistMonthlyInvoicesFromPreview(supabase, baseParams)).rejects.toThrow(
      "rpc failed",
    );
  });
});
