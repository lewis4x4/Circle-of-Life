import { describe, expect, it } from "vitest";

import {
  EXECUTIVE_REPORTING_SOURCE_READINESS,
  REPORTING_SOURCE_READINESS,
  REVENUE_SOURCE_READINESS,
} from "./reporting-source-readiness";

describe("reporting source readiness copy", () => {
  it("makes revenue dependency explicit", () => {
    expect(REVENUE_SOURCE_READINESS.description).toMatch(/payments/i);
    expect(REVENUE_SOURCE_READINESS.description).toMatch(/QuickBooks/i);
    expect(REVENUE_SOURCE_READINESS.actions.map((action) => action.href)).toContain(
      "/admin/billing/payments/new",
    );
  });

  it("marks reporting hub as catalog-ready but data-dependent", () => {
    expect(REPORTING_SOURCE_READINESS.description).toMatch(/Templates, packs, and schedules/i);
    expect(REPORTING_SOURCE_READINESS.description).toMatch(/No QuickBooks sync/i);
    expect(REPORTING_SOURCE_READINESS.actions).toHaveLength(3);
  });

  it("keeps executive exports tied to Haven source tables", () => {
    expect(EXECUTIVE_REPORTING_SOURCE_READINESS.description).toMatch(/current Haven source tables only/i);
    expect(EXECUTIVE_REPORTING_SOURCE_READINESS.actions.map((action) => action.href)).toContain(
      "/admin/reports",
    );
  });
});
