import { describe, expect, it, vi } from "vitest";

import {
  buildMonthlyInvoicePreview,
  persistMonthlyInvoicesFromPreview,
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

  is() {
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

describe("buildMonthlyInvoicePreview", () => {
  it("prorates date-only admission dates without timezone day shifts", async () => {
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
      ["invoices", { data: [], error: null }],
    ]);

    const supabase = {
      from: vi.fn((table: string) => new PreviewQueryMock(queryResults.get(table) ?? { data: [], error: null })),
    } as never;

    const result = await buildMonthlyInvoicePreview(supabase, {
      facilityId: "facility-1",
      billingYear: 2026,
      billingMonth: 5,
    });

    expect(result.periodStart).toBe("2026-05-01");
    expect(result.periodEnd).toBe("2026-05-31");
    expect(result.dueDate).toBe("2026-05-15");
    expect(result.preview[0]).toEqual(
      expect.objectContaining({
        baseRate: 120000,
        total: 120000,
        prorated: true,
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
    dueDate: "2026-05-15",
    preview: [
      {
        residentId: "resident-1",
        residentName: "Doe, Jane",
        payerType: "private_pay",
        payerName: "Responsible party",
        baseRate: 100000,
        careSurcharge: 25000,
        total: 125000,
        acuity: "Level 2",
        prorated: false,
      } satisfies PreviewLine,
    ],
  };

  it("maps RPC success counts", async () => {
    const rpcMock = vi.fn().mockResolvedValue({
      data: [{ created_count: 3, skipped_duplicates: 1 }],
      error: null,
    });
    const fromMock = vi.fn();
    const supabase = { rpc: rpcMock, from: fromMock } as never;

    const result = await persistMonthlyInvoicesFromPreview(supabase, baseParams);

    expect(rpcMock).toHaveBeenCalledWith("persist_monthly_invoices_from_preview", {
      p_facility_id: baseParams.facilityId,
      p_billing_year: baseParams.billingYear,
      p_billing_month: baseParams.billingMonth,
      p_preview: baseParams.preview,
      p_period_start: baseParams.periodStart,
      p_period_end: baseParams.periodEnd,
      p_due_date: baseParams.dueDate,
    });
    expect(result).toEqual({ createdCount: 3, skippedDuplicates: 1 });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("maps duplicate-only counts", async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({
        data: [{ created_count: 0, skipped_duplicates: 2 }],
        error: null,
      }),
      from: vi.fn(),
    } as never;

    const result = await persistMonthlyInvoicesFromPreview(supabase, baseParams);

    expect(result).toEqual({ createdCount: 0, skippedDuplicates: 2 });
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

  it("does not directly insert invoices or line items", async () => {
    const fromMock = vi.fn();
    const supabase = {
      rpc: vi.fn().mockResolvedValue({
        data: [{ created_count: 1, skipped_duplicates: 0 }],
        error: null,
      }),
      from: fromMock,
    } as never;

    await persistMonthlyInvoicesFromPreview(supabase, baseParams);

    expect(fromMock).not.toHaveBeenCalledWith("invoices");
    expect(fromMock).not.toHaveBeenCalledWith("invoice_line_items");
    expect(fromMock).not.toHaveBeenCalled();
  });
});
