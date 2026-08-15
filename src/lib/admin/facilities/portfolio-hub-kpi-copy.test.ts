import { describe, expect, it } from "vitest";

import type { FacilityRow } from "@/types/facility";

import {
  buildPortfolioStripTotals,
  facilityLicensedBedsOnFile,
  facilityOccupancyLoaded,
  facilityPortfolioOccupancyPct,
  portfolioComparisonHelperLine,
  portfolioComparisonOccupancyEmptyCopy,
  portfolioFacilityCardFieldEmptyCopy,
  portfolioKpiStripHelperLine,
  portfolioStripKpiEmptyCopy,
  portfolioStripKpiIsLoaded,
  portfolioStripLicensedBedsEmptyCopy,
  portfolioStripOccupiedBedsEmptyCopy,
  portfolioStripPortfolioOccupancyEmptyCopy,
  type PortfolioComparisonEntry,
} from "./portfolio-hub-kpi-copy";

function facility(partial: Partial<FacilityRow> & Pick<FacilityRow, "id" | "name">): FacilityRow {
  return {
    id: partial.id,
    name: partial.name,
    organization_id: "org-1",
    phone: null,
    email: null,
    address_line_1: null,
    city: partial.city ?? null,
    state: partial.state ?? null,
    zip: null,
    county: partial.county ?? null,
    total_licensed_beds: partial.total_licensed_beds ?? null,
    status: partial.status ?? "active",
    created_at: "2026-01-01T00:00:00.000Z",
    facility_overrides: null,
    pharmacy_vendor: null,
    occupancy_pct: null,
    ahca_license_number: null,
    ahca_license_expiration: null,
    occupancy_count: partial.occupancy_count,
    total_beds: partial.total_beds,
    current_occupancy: partial.current_occupancy,
    licensed_beds: partial.licensed_beds,
    survey_readiness_pct: partial.survey_readiness_pct ?? null,
    labor_cost_mtd_pct: partial.labor_cost_mtd_pct ?? null,
    ...partial,
  } as FacilityRow;
}

describe("facilityLicensedBedsOnFile", () => {
  it("returns positive licensed totals only when on file", () => {
    expect(facilityLicensedBedsOnFile(facility({ id: "1", name: "Oakridge", total_licensed_beds: 52 }))).toBe(52);
    expect(facilityLicensedBedsOnFile(facility({ id: "1", name: "Oakridge", total_licensed_beds: 0 }))).toBeNull();
    expect(facilityLicensedBedsOnFile(facility({ id: "1", name: "Oakridge" }))).toBeNull();
  });
});

describe("facilityOccupancyLoaded", () => {
  it("detects census from bed grid or occupied count", () => {
    expect(
      facilityOccupancyLoaded(
        facility({ id: "1", name: "Oakridge", total_beds: 48, occupancy_count: 0 }),
      ),
    ).toBe(true);
    expect(
      facilityOccupancyLoaded(
        facility({ id: "1", name: "Oakridge", total_beds: 0, occupancy_count: 12 }),
      ),
    ).toBe(true);
    expect(
      facilityOccupancyLoaded(
        facility({ id: "1", name: "Oakridge", total_beds: 0, occupancy_count: 0 }),
      ),
    ).toBe(false);
  });
});

describe("facilityPortfolioOccupancyPct", () => {
  it("returns null when census is not loaded", () => {
    expect(
      facilityPortfolioOccupancyPct(
        facility({ id: "1", name: "Oakridge", total_licensed_beds: 52, total_beds: 0, occupancy_count: 0 }),
      ),
    ).toBeNull();
  });

  it("computes occupancy when census and licensed beds exist", () => {
    expect(
      facilityPortfolioOccupancyPct(
        facility({
          id: "1",
          name: "Oakridge",
          total_licensed_beds: 52,
          total_beds: 48,
          occupancy_count: 44,
        }),
      ),
    ).toBe(92);
  });
});

describe("buildPortfolioStripTotals", () => {
  it("sums only loaded licensed and occupied values", () => {
    const totals = buildPortfolioStripTotals([
      facility({
        id: "1",
        name: "Oakridge",
        total_licensed_beds: 52,
        total_beds: 48,
        occupancy_count: 44,
      }),
      facility({
        id: "2",
        name: "Homewood",
        total_licensed_beds: 0,
        total_beds: 0,
        occupancy_count: 0,
      }),
    ]);

    expect(totals.licensedSum).toBe(52);
    expect(totals.licensedLoaded).toBe(true);
    expect(totals.occupiedSum).toBe(44);
    expect(totals.occupiedLoaded).toBe(true);
    expect(totals.portfolioPctRounded).toBe(85);
    expect(totals.portfolioPctLoaded).toBe(true);
    expect(totals.comparison[0].occupancyLoaded).toBe(true);
    expect(totals.comparison[1].occupancyLoaded).toBe(false);
  });
});

describe("portfolioStripKpiEmptyCopy", () => {
  it("names each portfolio strip gap", () => {
    expect(portfolioStripKpiEmptyCopy("licensed_beds")).toBe("Licensed beds not on file");
    expect(portfolioStripKpiEmptyCopy("occupied_beds")).toBe("Census not loaded yet");
    expect(portfolioStripKpiEmptyCopy("portfolio_occupancy")).toBe("No occupancy loaded");
  });
});

describe("portfolio strip empty-copy guards", () => {
  const emptyTotals = buildPortfolioStripTotals([
    facility({ id: "1", name: "Oakridge", total_beds: 0, occupancy_count: 0 }),
  ]);

  it("returns null when licensed beds are loaded", () => {
    const loaded = buildPortfolioStripTotals([
      facility({ id: "1", name: "Oakridge", total_licensed_beds: 52 }),
    ]);
    expect(portfolioStripLicensedBedsEmptyCopy(loaded)).toBeNull();
    expect(portfolioStripLicensedBedsEmptyCopy(emptyTotals)).toBe("Licensed beds not on file");
  });

  it("returns null when occupied census is loaded", () => {
    const loaded = buildPortfolioStripTotals([
      facility({ id: "1", name: "Oakridge", total_beds: 10, occupancy_count: 0 }),
    ]);
    expect(portfolioStripOccupiedBedsEmptyCopy(loaded)).toBeNull();
    expect(portfolioStripOccupiedBedsEmptyCopy(emptyTotals)).toBe("Census not loaded yet");
  });

  it("returns null when portfolio occupancy can be computed", () => {
    const loaded = buildPortfolioStripTotals([
      facility({
        id: "1",
        name: "Oakridge",
        total_licensed_beds: 52,
        total_beds: 48,
        occupancy_count: 44,
      }),
    ]);
    expect(portfolioStripPortfolioOccupancyEmptyCopy(loaded)).toBeNull();
    expect(portfolioStripPortfolioOccupancyEmptyCopy(emptyTotals)).toBe("No occupancy loaded");
  });
});

describe("portfolioFacilityCardFieldEmptyCopy", () => {
  it("names survey, payroll, location, and census gaps on cards", () => {
    const row = facility({ id: "1", name: "Oakridge" });
    expect(portfolioFacilityCardFieldEmptyCopy("survey_readiness", row)).toBe("No survey on file");
    expect(portfolioFacilityCardFieldEmptyCopy("labor_mtd", row)).toBe("No payroll loaded this period");
    expect(portfolioFacilityCardFieldEmptyCopy("location", row)).toBe("Location not on file");
    expect(portfolioFacilityCardFieldEmptyCopy("occupancy", row)).toBe("Census not loaded yet");
  });

  it("returns null when real values are present", () => {
    const row = facility({
      id: "1",
      name: "Oakridge",
      city: "Mayo",
      county: "Lafayette",
      total_beds: 48,
      occupancy_count: 44,
      survey_readiness_pct: 72,
      labor_cost_mtd_pct: 31.5,
    });
    expect(portfolioFacilityCardFieldEmptyCopy("survey_readiness", row)).toBeNull();
    expect(portfolioFacilityCardFieldEmptyCopy("labor_mtd", row)).toBeNull();
    expect(portfolioFacilityCardFieldEmptyCopy("location", row)).toBeNull();
    expect(portfolioFacilityCardFieldEmptyCopy("occupancy", row)).toBeNull();
  });
});

describe("portfolioComparisonOccupancyEmptyCopy", () => {
  it("matches card census gap copy", () => {
    expect(portfolioComparisonOccupancyEmptyCopy()).toBe("Census not loaded yet");
  });
});

describe("portfolioKpiStripHelperLine", () => {
  it("reassures when every portfolio tile is empty", () => {
    const totals = buildPortfolioStripTotals([]);
    expect(portfolioKpiStripHelperLine(totals)).toBe(
      "Empty tiles name what is still missing — nothing is broken.",
    );
  });

  it("celebrates a fully loaded portfolio strip", () => {
    const totals = buildPortfolioStripTotals([
      facility({
        id: "1",
        name: "Oakridge",
        total_licensed_beds: 52,
        total_beds: 48,
        occupancy_count: 44,
      }),
    ]);
    expect(portfolioKpiStripHelperLine(totals)).toBe(
      "Portfolio snapshot loaded — open a facility card for licensing, census, and survey context without opening a resident record.",
    );
  });

  it("counts partial portfolio loads", () => {
    const totals = buildPortfolioStripTotals([
      facility({
        id: "1",
        name: "Oakridge",
        total_licensed_beds: 52,
        total_beds: 0,
        occupancy_count: 0,
      }),
    ]);
    expect(portfolioKpiStripHelperLine(totals)).toBe(
      "2 of 4 portfolio tiles loaded — empty tiles name what is still missing.",
    );
  });
});

describe("portfolioStripKpiIsLoaded", () => {
  it("tracks loaded portfolio strip tiles", () => {
    const totals = buildPortfolioStripTotals([
      facility({
        id: "1",
        name: "Oakridge",
        total_licensed_beds: 52,
        total_beds: 48,
        occupancy_count: 44,
      }),
    ]);
    expect(portfolioStripKpiIsLoaded("facility_count", totals)).toBe(true);
    expect(portfolioStripKpiIsLoaded("licensed_beds", totals)).toBe(true);
    expect(portfolioStripKpiIsLoaded("occupied_beds", totals)).toBe(true);
    expect(portfolioStripKpiIsLoaded("portfolio_occupancy", totals)).toBe(true);
  });
});

describe("portfolioComparisonHelperLine", () => {
  it("explains when no comparison bars have census", () => {
    const entries: PortfolioComparisonEntry[] = [
      { id: "1", name: "Oakridge", occupancyPct: 0, occupancyLoaded: false },
      { id: "2", name: "Homewood", occupancyPct: 0, occupancyLoaded: false },
    ];
    expect(portfolioComparisonHelperLine(entries)).toBe(
      "Occupancy bars appear when bed census is loaded per site.",
    );
  });

  it("returns null when every facility has census loaded", () => {
    const entries: PortfolioComparisonEntry[] = [
      { id: "1", name: "Oakridge", occupancyPct: 85, occupancyLoaded: true },
    ];
    expect(portfolioComparisonHelperLine(entries)).toBeNull();
  });
});
