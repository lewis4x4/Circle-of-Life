import { describe, expect, it, vi } from "vitest";

import {
  buildMonthlyInvoicePreview,
  persistMonthlyInvoicesFromPreview,
  medicaidResidentShareInvoiced,
  prorationFactorForResident,
  type PreviewLine,
} from "./generate-monthly-invoices";

type MockQueryResult = { data: unknown; error: null; count?: number | null };

class PreviewQueryMock {
  constructor(private readonly result: MockQueryResult) {}

  select(_columns?: string, options?: { count?: string }) {
    if (options?.count === "exact" && Array.isArray(this.result.data)) {
      this.result.count = this.result.data.length;
    }
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

  it("keeps prorated line items summing exactly to the subtotal (half-cent boundary)", async () => {
    // April 2026: admitted on the 16th → factor 15/30 = 0.5.
    // 333333 * 0.5 and 55555 * 0.5 both land on .5 — independently rounding the
    // total used to drift one cent from the line-item sum and trip the RPC guard.
    const queryResults = new Map<string, MockQueryResult>([
      [
        "residents",
        {
          data: [
            {
              id: "resident-r",
              first_name: "Rae",
              last_name: "Round",
              acuity_level: "level_1",
              status: "active",
              admission_date: "2026-04-16",
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
              base_rate_private: 333333,
              base_rate_semi_private: null,
              care_surcharge_level_1: 55555,
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
      billingMonth: 4,
    });

    const line = result.preview[0];
    expect(line.standardBaseRate + line.standardCareSurcharge).toBe(line.standardTotal);
    expect(line.standardTotal).toBe(166667 + 27778);
  });

  it("skips Medicaid residents with no usable rate instead of billing private", async () => {
    const queryResults = new Map<string, MockQueryResult>([
      [
        "residents",
        {
          data: [
            {
              id: "resident-nolink",
              first_name: "Nia",
              last_name: "Unlinked",
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
              id: "payer-resident-nolink",
              effective_date: "2020-01-01",
              end_date: null,
              resident_id: "resident-nolink",
              payer_type: "medicaid_oss",
              payer_name: "Medicaid",
              medicaid_rate: null,
              facility_medicaid_provider_id: null,
            },
          ],
          error: null,
        },
      ],
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

    expect(result.preview).toHaveLength(0);
    expect(result.error).toContain("Skipped the Medicaid invoice for 1 Medicaid resident");
    expect(result.error).toContain("Unlinked, Nia");
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
              id: "payer-resident-m",
              effective_date: "2020-01-01",
              end_date: null,
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

  it("reports RPC uncertainty without exposing provider error text", async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "rpc failed" },
      }),
      from: vi.fn(),
    } as never;

    await expect(persistMonthlyInvoicesFromPreview(supabase, baseParams)).rejects.toThrow(
      "The latest invoice outcome is unknown",
    );
  });
});

describe("Medicaid resident share invoice (COL-678)", () => {
  // Homewood: terms $2,437.00 = Medicaid $1,600.00 + resident share $837.00.
  const org = "org-1";
  const rules = [
    { organization_id: org, facility_id: null, effective_from: "2026-01-01", created_at: "2026-09-23T00:00:00Z", medicaid_resident_share_invoice: false },
    { organization_id: org, facility_id: null, effective_from: "2026-10-01", created_at: "2026-09-23T00:00:01Z", medicaid_resident_share_invoice: true },
  ];
  const resident = (id: string, last: string) => ({
    id, first_name: "Test", last_name: last, acuity_level: "level_1", status: "active",
    admission_date: "2025-01-01", discharge_date: null, facility_id: "facility-1", organization_id: org,
    monthly_base_rate: null, monthly_care_surcharge: null, monthly_total_rate: 243700, rate_effective_date: null,
  });
  const payer = (residentId: string, rate: number | null, share: number | null) => ({
    id: `payer-${residentId}`, effective_date: "2020-01-01", end_date: null, resident_id: residentId,
    payer_type: "medicaid_oss", payer_name: "UHC", medicaid_rate: rate, medicaid_patient_responsibility: share,
    facility_medicaid_provider_id: null,
  });

  function client(invoices: { resident_id: string; payer_type: string | null }[] = [], ruleRows = rules) {
    const queryResults = new Map<string, MockQueryResult>([
      ["residents", { data: [resident("r-split", "Split"), resident("r-noRate", "NoRate")], error: null }],
      ["rate_schedules", { data: [{ id: "rate-1", base_rate_private: 555000, base_rate_semi_private: 440000, care_surcharge_level_1: 0, care_surcharge_level_2: 0, care_surcharge_level_3: 0 }], error: null }],
      ["resident_payers", { data: [payer("r-split", 160000, 83700), payer("r-noRate", null, 251000)], error: null }],
      ["facility_medicaid_providers", { data: [], error: null }],
      ["resident_rate_agreements", { data: [], error: null }],
      ["invoices", { data: invoices, error: null }],
      ["billing_rate_rules", { data: ruleRows, error: null }],
    ]);
    return { from: vi.fn((table: string) => new PreviewQueryMock(queryResults.get(table) ?? { data: [], error: null })) } as never;
  }

  it("resolves the rule by the period it bills: off for September, on from October", () => {
    expect(medicaidResidentShareInvoiced(rules, "facility-1", "2026-09-01")).toBe(false);
    expect(medicaidResidentShareInvoiced(rules, "facility-1", "2026-10-01")).toBe(true);
    expect(medicaidResidentShareInvoiced([], "facility-1", "2026-10-01")).toBe(false);
    expect(
      medicaidResidentShareInvoiced(
        [...rules, { facility_id: "facility-1", effective_from: "2026-10-01", created_at: "2026-09-24T00:00:00Z", medicaid_resident_share_invoice: false }],
        "facility-1",
        "2026-10-01",
      ),
    ).toBe(false);
  });

  it("drafts the Medicaid invoice and a separate resident-share invoice for October", async () => {
    const result = await buildMonthlyInvoicePreview(client(), { facilityId: "facility-1", billingYear: 2026, billingMonth: 10 });
    const lines = result.preview.map((line) => [line.residentId, line.invoiceShare, line.payerType, line.total]);
    expect(lines).toEqual([
      ["r-split", "primary", "medicaid_oss", 160000],
      ["r-split", "resident_share", "private_pay", 83700],
      // No Medicaid rate: the Medicaid half is skipped with a warning, the share is still billed.
      ["r-noRate", "resident_share", "private_pay", 251000],
    ]);
    expect(result.error).toContain("Skipped the Medicaid invoice for 1 Medicaid resident");
    expect(result.error).toContain("Their own share is still invoiced");
  });

  it("does not back-fill: September keeps the Medicaid-only invoice", async () => {
    const result = await buildMonthlyInvoicePreview(client(), { facilityId: "facility-1", billingYear: 2026, billingMonth: 9 });
    expect(result.preview.map((line) => [line.residentId, line.invoiceShare])).toEqual([["r-split", "primary"]]);
  });

  it("adds only the missing invoice when one already exists for the period", async () => {
    const primaryOnly = await buildMonthlyInvoicePreview(client([{ resident_id: "r-split", payer_type: "medicaid_oss" }]), {
      facilityId: "facility-1", billingYear: 2026, billingMonth: 10,
    });
    expect(primaryOnly.preview.filter((line) => line.residentId === "r-split").map((line) => line.invoiceShare)).toEqual(["resident_share"]);
    const both = await buildMonthlyInvoicePreview(
      client([{ resident_id: "r-split", payer_type: "medicaid_oss" }, { resident_id: "r-split", payer_type: "private_pay" }]),
      { facilityId: "facility-1", billingYear: 2026, billingMonth: 10 },
    );
    expect(both.preview.filter((line) => line.residentId === "r-split")).toEqual([]);
  });

  it("persists the share under its own invoice number, billed to the resident", async () => {
    const result = await buildMonthlyInvoicePreview(client(), { facilityId: "facility-1", billingYear: 2026, billingMonth: 10 });
    const rpc = vi.fn().mockResolvedValue({ data: [{ invoice_id: "inv", inserted: true }], error: null });
    await persistMonthlyInvoicesFromPreview({ rpc, from: vi.fn() } as never, {
      facilityId: "facility-1", billingYear: 2026, billingMonth: 10, preview: result.preview,
      periodStart: result.periodStart, periodEnd: result.periodEnd, dueDate: result.dueDate,
    });
    const calls = rpc.mock.calls.map(([, params]) => params as Record<string, unknown>);
    expect(calls.map((params) => [params.p_invoice_number, params.p_payer_type, params.p_total])).toEqual([
      ["FACILITY-2026-10-r-split", "medicaid_oss", 160000],
      ["FACILITY-2026-10-r-split-RS", "private_pay", 83700],
      ["FACILITY-2026-10-r-noRate-RS", "private_pay", 251000],
    ]);
    const share = calls[1].p_line_items as { description: string }[];
    expect(share[0].description).toBe("Resident share of Medicaid room and board");
  });
});
