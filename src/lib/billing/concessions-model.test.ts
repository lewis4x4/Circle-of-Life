import { describe, expect, it } from "vitest";

import {
  buildConcessionRows,
  concessionsResidentCountLabel,
  summarizeConcessions,
  type ConcessionPayerInput,
  type ConcessionResidentInput,
} from "./concessions-model";

// Homewood's May 2026 card, in force on 2026-09-23 (COL-666).
const schedule = { basePrivateCents: 555_000, baseSemiPrivateCents: 440_000, careLevel1Cents: 0, careLevel2Cents: 0, careLevel3Cents: 0 };

const privatePay = (cents: number): ConcessionPayerInput => ({
  payerType: "private_pay",
  payerName: null,
  payerShareType: "fixed_amount",
  payerFixedAmountCents: cents,
  medicaidRateCents: null,
  medicaidPatientResponsibilityCents: null,
});

const medicaid = (terms: number, rate: number, share: number): ConcessionPayerInput => ({
  payerType: "medicaid_oss",
  payerName: "UHC",
  payerShareType: "fixed_amount",
  payerFixedAmountCents: terms,
  medicaidRateCents: rate,
  medicaidPatientResponsibilityCents: share,
});

const resident = (patch: Partial<ConcessionResidentInput> & { id: string }): ConcessionResidentInput => ({
  name: patch.id,
  acuityLevel: null,
  monthlyTotalRateCents: null,
  rateEffectiveDate: null,
  bedRoomType: "semi_private",
  payers: [],
  ...patch,
});

describe("concession register (COL-666 ruling 4c)", () => {
  const residents = [
    // Medicaid $1,600 + resident $837 = $2,437 terms: a split, never a concession.
    resident({ id: "split", monthlyTotalRateCents: 243_700, payers: [medicaid(243_700, 160_000, 83_700)] }),
    // Private pay in a companion room at $3,183 vs the $4,400 companion rate.
    resident({ id: "companion", monthlyTotalRateCents: 318_300, payers: [privatePay(318_300)] }),
    // Private pay in a private room at $5,550: no concession.
    resident({ id: "private", monthlyTotalRateCents: 555_000, bedRoomType: "private", payers: [privatePay(555_000)] }),
    // No bed on file: not compared, instead of being measured against the private rate.
    resident({ id: "nobed", monthlyTotalRateCents: 250_000, bedRoomType: null, payers: [privatePay(250_000)] }),
    // No rate on file: not on the register.
    resident({ id: "norate", payers: [privatePay(0)] }),
  ];

  it("measures a private-pay resident against the posted rate for their room", () => {
    const rows = buildConcessionRows({ residents, agreementsByResident: new Map(), schedule, payerSplitIsConcession: false });
    const byId = Object.fromEntries(rows.map((row) => [row.residentId, row]));
    expect(byId.companion).toMatchObject({ kind: "concession", roomClass: "companion", roomClassFrom: "bed", postedCents: 440_000, concessionCents: 121_700 });
    expect(byId.private).toMatchObject({ kind: "concession", postedCents: 555_000, concessionCents: 0 });
    expect(byId.nobed).toMatchObject({ kind: "concession", roomClass: null, postedCents: null, concessionCents: null });
    expect(byId.norate).toBeUndefined();
  });

  it("lists a Medicaid + private split as a split with each payer's share", () => {
    const rows = buildConcessionRows({ residents, agreementsByResident: new Map(), schedule, payerSplitIsConcession: false });
    const split = rows.find((row) => row.residentId === "split")!;
    expect(split).toMatchObject({ kind: "payer_split", postedCents: null, concessionCents: null, agreedCents: 243_700 });
    expect(split.splits).toEqual([
      { label: "Medicaid (UHC)", cents: 160_000 },
      { label: "Resident share", cents: 83_700 },
    ]);
    const totals = summarizeConcessions(rows);
    expect(totals).toMatchObject({
      concessionResidents: 2,
      postedCents: 995_000,
      agreedCents: 873_300,
      concessionsCents: 121_700,
      payerSplitResidents: 1,
      payerSplitTermsCents: 243_700,
      notComparedResidents: 1,
    });
  });

  it("follows the runtime rule when payer splits are set to count as concessions", () => {
    const rows = buildConcessionRows({ residents, agreementsByResident: new Map(), schedule, payerSplitIsConcession: true });
    expect(rows.find((row) => row.residentId === "split")).toMatchObject({ kind: "concession", postedCents: 440_000, concessionCents: 196_300 });
  });

  it("prefers the agreement's room over the bed", () => {
    const rows = buildConcessionRows({
      residents: [resident({ id: "a", monthlyTotalRateCents: 500_000, bedRoomType: "semi_private", payers: [privatePay(500_000)] })],
      agreementsByResident: new Map([
        ["a", { roomClass: "private", effectiveDate: "2026-05-01", negotiatedMonthlyTotalCents: 500_000, standardMonthlyTotalAtSigningCents: 555_000, concessionReason: "move_in_special", concessionExpiresOn: null }],
      ]),
      schedule,
      payerSplitIsConcession: false,
    });
    expect(rows[0]).toMatchObject({ source: "agreement", roomClass: "private", roomClassFrom: "agreement", concessionCents: 55_000, reason: "move_in_special" });
  });

  it("says what the resident count counts", () => {
    expect(concessionsResidentCountLabel(24)).toBe("24 residents active today with a monthly rate on file");
  });
});
