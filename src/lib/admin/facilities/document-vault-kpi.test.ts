import { describe, expect, it } from "vitest";

import { DOCUMENT_VAULT_REQUIRED_SLOTS } from "@/lib/admin/facilities/document-vault-taxonomy";

import {
  computeDocumentVaultKpi,
  daysUntilFacilityExpirationDate,
  getDocumentVaultKpiDateWindow,
  isDocumentRequirementSatisfied,
  type VaultDocSlice,
} from "./document-vault-kpi";

describe("document vault KPI date windows (America/New_York)", () => {
  /** 8:05 PM Eastern on 2026-08-20 (EDT, UTC−4) — after the UTC date rolls to tomorrow. */
  const eightOhFivePmEt = new Date("2026-08-20T20:05:00-04:00");

  it("anchors today and +60 on the Eastern calendar, not UTC ISO slice", () => {
    const { today, plus60 } = getDocumentVaultKpiDateWindow(eightOhFivePmEt);
    expect(today).toBe("2026-08-20");
    expect(plus60).toBe("2026-10-19");
    expect(today).not.toBe("2026-08-21");
    expect(eightOhFivePmEt.toISOString().slice(0, 10)).toBe("2026-08-21");
  });

  it("counts a document expiring today as expiring <60 after 8pm ET", () => {
    const rows: VaultDocSlice[] = [
      { document_category: "fire_inspections", expiration_date: "2026-08-20" },
    ];
    const kpi = computeDocumentVaultKpi(rows, eightOhFivePmEt);
    expect(kpi.expired).toBe(0);
    expect(kpi.expiringLt60).toBe(1);
  });

  it("counts a document that lapsed yesterday as expired after 8pm ET", () => {
    const rows: VaultDocSlice[] = [
      { document_category: "fire_inspections", expiration_date: "2026-08-19" },
    ];
    const kpi = computeDocumentVaultKpi(rows, eightOhFivePmEt);
    expect(kpi.expired).toBe(1);
    expect(kpi.expiringLt60).toBe(0);
  });

  it("treats tomorrow as expiring within the 60-day window after 8pm ET", () => {
    const rows: VaultDocSlice[] = [
      { document_category: "elevator_certificate", expiration_date: "2026-08-21" },
    ];
    const kpi = computeDocumentVaultKpi(rows, eightOhFivePmEt);
    expect(kpi.expired).toBe(0);
    expect(kpi.expiringLt60).toBe(1);
  });

  it("keeps missing required at real zero when all slots are covered", () => {
    const rows: VaultDocSlice[] = DOCUMENT_VAULT_REQUIRED_SLOTS.map((category) => ({
      document_category: category,
      expiration_date: "2027-01-01",
    }));
    const kpi = computeDocumentVaultKpi(rows, eightOhFivePmEt);
    expect(kpi.missingRequired).toBe(0);
    expect(kpi.total).toBe(DOCUMENT_VAULT_REQUIRED_SLOTS.length);
  });
});

describe("daysUntilFacilityExpirationDate", () => {
  const eightOhFivePmEt = new Date("2026-08-20T20:05:00-04:00");

  it("returns 0 for today at 8:05pm ET", () => {
    expect(daysUntilFacilityExpirationDate("2026-08-20", eightOhFivePmEt)).toBe(0);
  });

  it("returns negative days for expired dates after 8pm ET", () => {
    expect(daysUntilFacilityExpirationDate("2026-08-19", eightOhFivePmEt)).toBe(-1);
  });
});

describe("isDocumentRequirementSatisfied", () => {
  it("treats a document expiring today as satisfied", () => {
    expect(isDocumentRequirementSatisfied("2026-08-20", "2026-08-20")).toBe(true);
  });

  it("treats a document that lapsed yesterday as not satisfied", () => {
    expect(isDocumentRequirementSatisfied("2026-08-19", "2026-08-20")).toBe(false);
  });
});
