import { describe, expect, it } from "vitest";

import {
  buildRentRoll,
  compareRoomLabels,
  parseRentRollPeriod,
  rentRollPeriodBounds,
  rentRollToCsv,
  residentOnRentRoll,
  shiftRentRollPeriod,
  type RentRollInvoiceInput,
  type RentRollPayerInput,
  type RentRollPaymentInput,
  type RentRollResidentInput,
} from "./rent-roll-model";

const SEPT = { year: 2026, month: 9 };

function resident(overrides: Partial<RentRollResidentInput> & { id: string }): RentRollResidentInput {
  return {
    firstName: "Jimmie",
    lastName: "Baker",
    status: "active",
    admissionDate: "2021-06-23",
    dischargeDate: null,
    admissionSource: null,
    monthlyTotalRateCents: null,
    roomLabel: "7B",
    bedLabel: null,
    ...overrides,
  };
}

function payer(overrides: Partial<RentRollPayerInput> & { residentId: string }): RentRollPayerInput {
  return {
    payerType: "medicaid_oss",
    payerName: "UHC",
    providerName: null,
    payerShareType: "fixed_amount",
    payerFixedAmountCents: 300900,
    medicaidRateCents: 160000,
    medicaidRateUnit: "monthly",
    medicaidPatientResponsibilityCents: 140900,
    effectiveDate: "2026-05-01",
    endDate: null,
    ...overrides,
  };
}

function payment(overrides: Partial<RentRollPaymentInput> & { residentId: string }): RentRollPaymentInput {
  return {
    amountCents: 140900,
    paymentDate: "2026-09-03",
    paymentMethod: "check",
    payerType: "private_pay",
    refunded: false,
    refundAmountCents: null,
    ...overrides,
  };
}

function invoice(overrides: Partial<RentRollInvoiceInput> & { residentId: string }): RentRollInvoiceInput {
  return {
    status: "draft",
    totalCents: 300900,
    balanceDueCents: 300900,
    invoiceDate: "2026-09-01",
    periodStart: "2026-09-01",
    ...overrides,
  };
}

describe("period helpers", () => {
  it("parses YYYY-MM and falls back to the current month", () => {
    expect(parseRentRollPeriod("2026-09")).toEqual(SEPT);
    expect(parseRentRollPeriod("2026-13", new Date("2026-09-22T12:00:00Z"))).toEqual(SEPT);
    expect(parseRentRollPeriod(null, new Date("2026-09-22T12:00:00Z"))).toEqual(SEPT);
    expect(parseRentRollPeriod("garbage", new Date("2026-09-22T12:00:00Z"))).toEqual(SEPT);
  });

  it("names the month and the prior month Medicaid is billed for", () => {
    const bounds = rentRollPeriodBounds(SEPT);
    expect(bounds).toMatchObject({
      key: "2026-09",
      label: "September 2026",
      priorMonthLabel: "August 2026",
      startIso: "2026-09-01",
      endIso: "2026-09-30",
      endExclusiveIso: "2026-10-01",
    });
    expect(rentRollPeriodBounds({ year: 2026, month: 1 }).priorMonthLabel).toBe("December 2025");
  });

  it("shifts across year boundaries", () => {
    expect(shiftRentRollPeriod({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftRentRollPeriod({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
  });
});

describe("room ordering", () => {
  it("sorts rooms the way the building reads them", () => {
    const labels = ["18A", "2", "7B", "1", "10A", "7A", null, "1-A"];
    const sorted = [...labels].sort(compareRoomLabels);
    expect(sorted).toEqual(["1", "1-A", "2", "7A", "7B", "10A", "18A", null]);
  });
});

describe("who is on the month's sheet", () => {
  const bounds = rentRollPeriodBounds(SEPT);

  it("keeps residents in the building, on hospital hold or on leave", () => {
    expect(residentOnRentRoll(resident({ id: "a" }), bounds)).toBe(true);
    expect(residentOnRentRoll(resident({ id: "b", status: "hospital_hold" }), bounds)).toBe(true);
    expect(residentOnRentRoll(resident({ id: "c", status: "loa" }), bounds)).toBe(true);
  });

  it("leaves off inquiries, pending admissions and future move-ins", () => {
    expect(residentOnRentRoll(resident({ id: "a", status: "inquiry" }), bounds)).toBe(false);
    expect(residentOnRentRoll(resident({ id: "b", status: "pending_admission" }), bounds)).toBe(false);
    expect(residentOnRentRoll(resident({ id: "c", admissionDate: "2026-10-01" }), bounds)).toBe(false);
  });

  it("keeps a resident who left during the month and drops one who left before it", () => {
    expect(residentOnRentRoll(resident({ id: "a", status: "discharged", dischargeDate: "2026-09-11" }), bounds)).toBe(true);
    expect(residentOnRentRoll(resident({ id: "b", status: "deceased", dischargeDate: "2026-09-10" }), bounds)).toBe(true);
    expect(residentOnRentRoll(resident({ id: "c", status: "discharged", dischargeDate: "2026-08-31" }), bounds)).toBe(false);
    expect(residentOnRentRoll(resident({ id: "d", status: "discharged", dischargeDate: null }), bounds)).toBe(false);
  });
});

describe("buildRentRoll", () => {
  it("splits a Medicaid resident the way the sheet does and nets payments by source", () => {
    const roll = buildRentRoll({
      period: SEPT,
      residents: [resident({ id: "baker" })],
      payers: [payer({ residentId: "baker" })],
      payments: [
        payment({ residentId: "baker" }),
        payment({ residentId: "baker", amountCents: 160000, paymentMethod: "medicaid_payment", payerType: "medicaid_oss", paymentDate: "2026-09-15" }),
        // outside the month: ignored
        payment({ residentId: "baker", amountCents: 999, paymentDate: "2026-10-01" }),
      ],
      invoices: [invoice({ residentId: "baker" })],
    });
    expect(roll.rows).toHaveLength(1);
    const row = roll.rows[0];
    expect(row).toMatchObject({
      residentName: "Jimmie Baker",
      residentSheetName: "Baker, Jimmie",
      roomLabel: "7B",
      contractedCents: 300900,
      privateShareCents: 140900,
      medicaidBilledCents: 160000,
      paidPrivatelyCents: 140900,
      medicaidPaidCents: 160000,
      outstandingCents: 0,
      medicaidPlan: "UHC",
      medicaidPending: false,
      invoice: { status: "draft", totalCents: 300900, balanceDueCents: 300900 },
      flags: [],
    });
    expect(roll.totals).toMatchObject({
      residentCount: 1,
      contractedCents: 300900,
      collectedCents: 300900,
      outstandingCents: 0,
      collectionRate: 1,
    });
  });

  it("prefers the catalogued plan name over the free-text payer name", () => {
    const roll = buildRentRoll({
      period: SEPT,
      residents: [resident({ id: "r" })],
      payers: [payer({ residentId: "r", payerName: "FCC", providerName: "Florida Community Care" })],
      payments: [],
      invoices: [],
    });
    expect(roll.rows[0].medicaidPlan).toBe("Florida Community Care");
  });

  it("marks Medicaid pending and leaves the Medicaid billed column empty", () => {
    const roll = buildRentRoll({
      period: SEPT,
      residents: [resident({ id: "r" })],
      payers: [
        payer({
          residentId: "r",
          payerName: "Medicaid Pending",
          medicaidRateCents: null,
          medicaidPatientResponsibilityCents: 250000,
          payerFixedAmountCents: 250000,
        }),
      ],
      payments: [],
      invoices: [],
    });
    expect(roll.rows[0]).toMatchObject({
      medicaidPending: true,
      medicaidPlan: "MCD Pending",
      contractedCents: 250000,
      privateShareCents: 250000,
      medicaidBilledCents: null,
      outstandingCents: 250000,
      flags: [],
    });
  });

  it("says so when a resident has no rate on file instead of showing zero", () => {
    const roll = buildRentRoll({
      period: SEPT,
      residents: [resident({ id: "r", lastName: "Budd", firstName: "Sharon" })],
      payers: [
        payer({
          residentId: "r",
          payerType: "other",
          payerName: null,
          payerShareType: "full",
          payerFixedAmountCents: null,
          medicaidRateCents: null,
          medicaidPatientResponsibilityCents: null,
        }),
      ],
      payments: [payment({ residentId: "r", amountCents: 350000 })],
      invoices: [],
    });
    expect(roll.rows[0]).toMatchObject({
      contractedCents: null,
      outstandingCents: null,
      paidPrivatelyCents: 350000,
      flags: ["No rate on file"],
    });
    expect(roll.totals.rowsWithoutRate).toBe(1);
    expect(roll.totals.contractedCents).toBe(0);
    expect(roll.totals.collectionRate).toBeNull();
  });

  it("falls back to the resident's rate on file when payers carry no amounts, and says so", () => {
    const roll = buildRentRoll({
      period: SEPT,
      residents: [resident({ id: "r", monthlyTotalRateCents: 400000 })],
      payers: [payer({ residentId: "r", payerType: "private_pay", payerShareType: "full", payerFixedAmountCents: null, medicaidRateCents: null, medicaidPatientResponsibilityCents: null, payerName: null })],
      payments: [],
      invoices: [],
    });
    expect(roll.rows[0]).toMatchObject({
      contractedCents: 400000,
      privateShareCents: null,
      outstandingCents: 400000,
    });
    expect(roll.rows[0].flags[0]).toMatch(/rate on file; no payer split/);
  });

  it("flags a split that does not total the contracted amount", () => {
    const roll = buildRentRoll({
      period: SEPT,
      residents: [resident({ id: "r" })],
      payers: [payer({ residentId: "r", payerFixedAmountCents: 300000, medicaidRateCents: 160000, medicaidPatientResponsibilityCents: 100000 })],
      payments: [],
      invoices: [],
    });
    expect(roll.rows[0].flags).toContain("Private + Medicaid split does not total the contracted amount");
  });

  it("does not multiply a daily Medicaid rate into a month", () => {
    const roll = buildRentRoll({
      period: SEPT,
      residents: [resident({ id: "r" })],
      payers: [payer({ residentId: "r", medicaidRateUnit: "per_billable_day", medicaidRateCents: 5500, payerFixedAmountCents: null, payerShareType: "full", medicaidPatientResponsibilityCents: null })],
      payments: [],
      invoices: [],
    });
    expect(roll.rows[0].medicaidBilledCents).toBeNull();
    expect(roll.rows[0].flags.join(" ")).toMatch(/per billable day, not monthly/);
  });

  it("ignores payer rows that were not in force during the month", () => {
    const roll = buildRentRoll({
      period: SEPT,
      residents: [resident({ id: "r" })],
      payers: [
        payer({ residentId: "r", endDate: "2026-08-31", payerFixedAmountCents: 100000, medicaidRateCents: null, medicaidPatientResponsibilityCents: 100000 }),
        payer({ residentId: "r", effectiveDate: "2026-10-01", payerFixedAmountCents: 500000, medicaidRateCents: null, medicaidPatientResponsibilityCents: 500000 }),
        payer({ residentId: "r", effectiveDate: "2026-09-15" }),
      ],
      payments: [],
      invoices: [],
    });
    expect(roll.rows[0].contractedCents).toBe(300900);
  });

  it("nets refunds and treats a Medicaid-typed payment as Medicaid even when the method is a check", () => {
    const roll = buildRentRoll({
      period: SEPT,
      residents: [resident({ id: "r" })],
      payers: [payer({ residentId: "r" })],
      payments: [
        payment({ residentId: "r", amountCents: 140900, refunded: true, refundAmountCents: 40900 }),
        payment({ residentId: "r", amountCents: 160000, paymentMethod: "check", payerType: "medicaid_oss" }),
      ],
      invoices: [],
    });
    expect(roll.rows[0]).toMatchObject({ paidPrivatelyCents: 100000, medicaidPaidCents: 160000, outstandingCents: 40900 });
  });

  it("notes move-ins, move-outs, hospital holds and leave on the row", () => {
    const roll = buildRentRoll({
      period: SEPT,
      residents: [
        resident({ id: "in", lastName: "Byrd", roomLabel: "11", admissionDate: "2026-09-14" }),
        resident({ id: "out", lastName: "Shepherd", roomLabel: "108A", status: "discharged", dischargeDate: "2026-09-11" }),
        resident({ id: "dead", lastName: "Safford", roomLabel: "14A", status: "deceased", dischargeDate: "2026-09-10" }),
        resident({ id: "hosp", lastName: "Britch", roomLabel: "12B", status: "hospital_hold" }),
        resident({ id: "gone", lastName: "Old", roomLabel: "1", status: "discharged", dischargeDate: "2026-07-01" }),
      ],
      payers: [],
      payments: [],
      invoices: [],
    });
    const byName = Object.fromEntries(roll.rows.map((r) => [r.residentName, r.flags]));
    expect(byName["Jimmie Byrd"]).toContain("Moved in Sep 14");
    expect(byName["Jimmie Shepherd"]).toContain("Moved out Sep 11");
    expect(byName["Jimmie Safford"]).toContain("Deceased Sep 10");
    expect(byName["Jimmie Britch"]).toContain("At hospital");
    expect(byName["Jimmie Old"]).toBeUndefined();
    expect(roll.rows.map((r) => r.roomLabel)).toEqual(["11", "12B", "14A", "108A"]);
  });

  it("picks the month's invoice by period start, falling back to invoice date", () => {
    const roll = buildRentRoll({
      period: SEPT,
      residents: [resident({ id: "r" })],
      payers: [],
      payments: [],
      invoices: [
        invoice({ residentId: "r", periodStart: "2026-08-01", invoiceDate: "2026-08-01", status: "paid" }),
        invoice({ residentId: "r", periodStart: null, invoiceDate: "2026-09-03", status: "sent", totalCents: 1 }),
        invoice({ residentId: "r", periodStart: "2026-09-01", invoiceDate: "2026-09-05", status: "draft", totalCents: 2 }),
      ],
    });
    expect(roll.rows[0].invoice).toMatchObject({ status: "draft", totalCents: 2 });
  });
});

describe("rentRollToCsv", () => {
  it("writes the sheet's column order with a totals line", () => {
    const roll = buildRentRoll({
      period: SEPT,
      residents: [resident({ id: "baker", admissionSource: 'Bedrock "Live Oak"' })],
      payers: [payer({ residentId: "baker" })],
      payments: [payment({ residentId: "baker" })],
      invoices: [],
    });
    const csv = rentRollToCsv(roll);
    const lines = csv.split("\n");
    expect(lines[0]).toBe(
      "Room #,Admit Date,Resident,Total PVT & MCD,PVT,Amount Paid Privately,Medicaid Billed - DOS August 2026,Medicaid Amount PD for August 2026,Outstanding Amount,Medicaid Plan,Notes,Admitted From",
    );
    expect(lines[1]).toBe('"7B",2021-06-23,"Baker, Jimmie",3009.00,1409.00,1409.00,1600.00,0.00,1600.00,"UHC","","Bedrock ""Live Oak"""');
    expect(lines[2]).toBe(',,"Totals",3009.00,1409.00,1409.00,1600.00,0.00,1600.00,,,');
  });
});

describe("rent roll counts both invoices of a Medicaid month (COL-678)", () => {
  it("adds the Medicaid invoice and the resident share, and leaves voided invoices out", () => {
    const roll = buildRentRoll({
      period: { year: 2026, month: 10 },
      residents: [resident({ id: "r" })],
      payers: [],
      payments: [],
      invoices: [
        invoice({ residentId: "r", periodStart: "2026-10-01", invoiceDate: "2026-10-01", payerType: "medicaid_oss", totalCents: 160000, balanceDueCents: 160000 }),
        invoice({ residentId: "r", periodStart: "2026-10-01", invoiceDate: "2026-10-01", payerType: "private_pay", totalCents: 83700, balanceDueCents: 83700 }),
        invoice({ residentId: "r", periodStart: "2026-10-01", invoiceDate: "2026-09-30", payerType: "private_pay", status: "void", totalCents: 999, balanceDueCents: 999 }),
      ],
    } as never);
    expect(roll.rows[0].invoice).toEqual({ status: "draft", totalCents: 243700, balanceDueCents: 243700 });
  });
});
