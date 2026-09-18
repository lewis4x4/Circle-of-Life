import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { WatchlistFacilityTable } from "./WatchlistFacilityTable";
import type { WatchlistSignalRow } from "@/lib/rounding/watchlist-fetch";

function row(overrides: Partial<WatchlistSignalRow>): WatchlistSignalRow {
  return {
    organization_id: "org-1",
    facility_id: "facility-1",
    facility_name: "A Building",
    resident_id: "resident-1",
    resident_first_name: "First",
    resident_last_name: "Last",
    resident_preferred_name: null,
    room_number: "12B",
    signal_instance_id: "instance-1",
    signal_key: "repeat_fall",
    signal_label: "Two or more falls in a month",
    signal_description: "Two or more falls recorded in the lookback span.",
    severity_class: "critical",
    source_kind: "clinical",
    status: "new",
    first_detected_at: "2026-09-10T12:00:00.000Z",
    last_evaluated_at: "2026-09-17T12:00:00.000Z",
    observed_count: 2,
    evidence: {},
    days_open: 7,
    disposition_note: null,
    owner_user_id: null,
    owner_name: null,
    band_key: "acute",
    band_label: "Acute",
    band_rank: 3,
    open_signal_count: 2,
    ...overrides,
  };
}

afterEach(cleanup);

describe("the facility watchlist", () => {
  it("names the resident, the room, the signal, the band and the owner", () => {
    render(<WatchlistFacilityTable rows={[row({})]} />);

    expect(screen.getByRole("link", { name: "Last, First" })).toHaveAttribute(
      "href",
      "/admin/rounding/watchlist/resident-1",
    );
    expect(screen.getByText("12B")).toBeInTheDocument();
    expect(screen.getByText("Two or more falls in a month")).toBeInTheDocument();
    expect(screen.getByText("Acute")).toBeInTheDocument();
    expect(screen.getByText("Not looked at")).toBeInTheDocument();
    expect(screen.getByText("Nobody yet")).toBeInTheDocument();
  });

  it("renders a documentation signal in a class of its own", () => {
    render(
      <WatchlistFacilityTable
        rows={[
          row({}),
          row({
            signal_instance_id: "instance-2",
            signal_key: "observation_gap",
            signal_label: "Checks with nothing written down",
            severity_class: "informational",
            source_kind: "data_quality",
          }),
        ]}
      />,
    );

    const clinical = screen.getByText("Two or more falls in a month");
    const documentation = screen.getByText("Checks with nothing written down");
    expect(clinical.className).not.toEqual(documentation.className);
    expect(documentation.className).toContain("italic");
    expect(
      screen.getByText(/documentation signals: nobody wrote the check down/i),
    ).toBeInTheDocument();
  });

  it("puts no score, percentage or index on a resident row", () => {
    const { container } = render(<WatchlistFacilityTable rows={[row({})]} />);
    const body = container.textContent ?? "";
    expect(body).not.toMatch(/\bscore\b/i);
    expect(body).not.toMatch(/%/);
    expect(body).not.toMatch(/\brisk index\b/i);
    expect(body).not.toMatch(/\bcritical\b/i);
  });

  it("names a missing room rather than leaving the cell blank", () => {
    render(<WatchlistFacilityTable rows={[row({ room_number: null })]} />);
    expect(screen.getByText("No room recorded")).toBeInTheDocument();
  });

  it("uses a left aligned two line empty state that says what would fill it", () => {
    render(<WatchlistFacilityTable rows={[]} />);
    const empty = screen.getByRole("region", { name: "Facility watchlist" });
    expect(within(empty).getByText(/Nobody is on the Watchlist/)).toBeInTheDocument();
    expect(within(empty).getByText(/scheduled evaluation/)).toBeInTheDocument();
    expect(empty.className).not.toContain("text-center");
    expect(empty.className).not.toContain("border-dashed");
  });
});
