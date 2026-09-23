import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { FacilityRow } from "@/types/facility";

import { FacilityCard } from "./FacilityCard";

function facility(partial: Partial<FacilityRow> & Pick<FacilityRow, "id" | "name">): FacilityRow {
  return {
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

describe("FacilityCard occupancy copy", () => {
  it("names an unloaded census gap when no bed grid is posted", () => {
    render(
      <FacilityCard
        facility={facility({
          id: "1",
          name: "Site Alpha",
          total_licensed_beds: 52,
          total_beds: 0,
          occupancy_count: 0,
        })}
      />,
    );

    expect(screen.getByText("Census not loaded yet")).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("names the census gap instead of 0% when the bed grid has nobody in it (COL-649)", () => {
    render(
      <FacilityCard
        facility={facility({
          id: "2",
          name: "Site Beta",
          total_licensed_beds: 52,
          total_beds: 48,
          occupancy_count: 0,
        })}
      />,
    );

    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    expect(screen.getByText("Census not loaded yet")).toBeInTheDocument();
  });
});
