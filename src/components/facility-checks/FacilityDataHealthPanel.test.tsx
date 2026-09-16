import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FacilityDataHealthPanel } from "./FacilityDataHealthPanel";
import type { FacilityDataHealth } from "@/lib/facility-checks/data-health";

function health(overrides: Partial<FacilityDataHealth> = {}): FacilityDataHealth {
  return {
    beds_occupied_with_no_resident: 0,
    residents_holding_no_bed: 0,
    beds_with_two_residents: 0,
    roster_census: 25,
    stand_up_census: 34,
    stand_up_week_start: "2026-09-07",
    staff_inactive_can_still_sign_in: 0,
    active_profiles_with_no_grant: 0,
    duplicate_identity_candidates: 0,
    last_board_check_closed_at: null,
    last_staff_check_closed_at: null,
    ...overrides,
  };
}

describe("data health panel", () => {
  it("shows every count with a link to the list behind it", () => {
    render(
      <FacilityDataHealthPanel
        health={health({
          beds_occupied_with_no_resident: 8,
          residents_holding_no_bed: 2,
          beds_with_two_residents: 1,
          staff_inactive_can_still_sign_in: 3,
          active_profiles_with_no_grant: 4,
          duplicate_identity_candidates: 5,
        })}
      />,
    );
    expect(screen.getByTestId("data-health-beds_occupied_with_no_resident").textContent).toBe("8");
    expect(screen.getByTestId("data-health-residents_holding_no_bed").textContent).toBe("2");
    expect(screen.getByTestId("data-health-beds_with_two_residents").textContent).toBe("1");
    expect(screen.getByTestId("data-health-staff_inactive_can_still_sign_in").textContent).toBe("3");
    expect(screen.getByTestId("data-health-active_profiles_with_no_grant").textContent).toBe("4");
    expect(screen.getByTestId("data-health-duplicate_identity_candidates").textContent).toBe("5");
    expect(
      screen.getByRole("link", { name: "Offboarded staff who can still sign in" }).getAttribute("href"),
    ).toBe("/admin/staff/staff-check");
  });

  // COL-438. Two of the identity counts are organization-wide on a panel that
  // is rendered per facility and gated on a per-facility grant, so a change
  // made only at facility B moved facility A's numbers. They stay org-wide --
  // an account with no grant belongs to no facility -- but they no longer sit
  // under a heading that claims they are about this building.
  it("separates the counts that span every facility from the ones about this one", () => {
    render(
      <FacilityDataHealthPanel
        health={health({ beds_with_two_residents: 1, duplicate_identity_candidates: 5 })}
      />,
    );

    const facilityGroup = screen.getByTestId("data-health-group-facility");
    const allGroup = screen.getByTestId("data-health-group-all_facilities");

    expect(facilityGroup.textContent).toMatch(/This facility/);
    expect(allGroup.textContent).toMatch(/All facilities/);

    // A per-building count is in the facility group and nowhere else.
    expect(facilityGroup.querySelector('[data-testid="data-health-beds_with_two_residents"]')).toBeTruthy();
    expect(allGroup.querySelector('[data-testid="data-health-beds_with_two_residents"]')).toBeNull();

    // Both org-wide counts sit under the wider heading.
    expect(allGroup.querySelector('[data-testid="data-health-duplicate_identity_candidates"]')).toBeTruthy();
    expect(allGroup.querySelector('[data-testid="data-health-active_profiles_with_no_grant"]')).toBeTruthy();
    expect(facilityGroup.querySelector('[data-testid="data-health-duplicate_identity_candidates"]')).toBeNull();
  });

  it("warns in the wider group that another building can move these numbers", () => {
    render(<FacilityDataHealthPanel health={health()} />);
    const allGroup = screen.getByTestId("data-health-group-all_facilities");
    expect(allGroup.textContent).toMatch(/every facility/i);
    expect(allGroup.textContent).toMatch(/another building/i);
  });

  it("never calls the wider scope the organization, because a Facility is one building", () => {
    render(<FacilityDataHealthPanel health={health()} />);
    expect(screen.getByTestId("data-health-group-all_facilities").textContent).not.toMatch(/^Organization/);
    expect(screen.queryByRole("heading", { name: /^Organization$/ })).toBeNull();
  });

  it("puts the two census numbers side by side with no colour on either", () => {
    const { container } = render(<FacilityDataHealthPanel health={health()} />);
    const line = screen.getByTestId("data-health-census");
    expect(line.textContent).toBe("Roster 25 · Stand Up Sep 7: 34");
    // No value-derived colour: the comparison must not assert which is wrong.
    expect(line.className).not.toMatch(/destructive|success|warning|text-red|text-green|text-amber/);
    expect(container.querySelector('[data-testid="data-health-census"] [class*="destructive"]')).toBeNull();
  });

  it("says Never when a facility has not closed a check", () => {
    render(<FacilityDataHealthPanel health={health()} />);
    expect(screen.getByTestId("data-health-last-board-check").textContent).toBe("Never");
    expect(screen.getByTestId("data-health-last-staff-check").textContent).toBe("Never");
  });

  it("shows the closed dates once checks exist", () => {
    render(
      <FacilityDataHealthPanel
        health={health({
          last_board_check_closed_at: "2026-09-16T19:42:00Z",
          last_staff_check_closed_at: "2026-09-16T20:10:00Z",
        })}
      />,
    );
    expect(screen.getByTestId("data-health-last-board-check").textContent).not.toBe("Never");
    expect(screen.getByTestId("data-health-last-staff-check").textContent).not.toBe("Never");
  });

  it("says so in operator words when the counts are unavailable", () => {
    render(<FacilityDataHealthPanel health={null} error="unavailable" />);
    expect(screen.getByText(/not available right now/)).toBeTruthy();
    // The raw failure never reaches the screen.
    expect(screen.queryByText(/unavailable/)).toBeNull();
  });

  // COL-442. Before migration 409 the database answered an ungranted caller
  // with a row of zeros, so this state rendered as a clean facility. It now
  // refuses, and the panel has to say which of the two happened -- without ever
  // implying the facility's data is fine.
  it("distinguishes no access from a transient failure, and claims nothing about the data", () => {
    render(<FacilityDataHealthPanel health={null} error="forbidden" />);
    const said = screen.getByTestId("data-health-unavailable").textContent ?? "";
    expect(said).toMatch(/do not have access to this facility/);
    expect(said).toMatch(/not a statement that its data is clean/);
    expect(said).not.toMatch(/try again/i);
    // No count is rendered, so nothing can read as an all-clear.
    expect(screen.queryByTestId("data-health-duplicate_identity_candidates")).toBeNull();
    expect(screen.queryByTestId("data-health-census")).toBeNull();
  });
});
