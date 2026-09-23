import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PresenceTiles } from "./PresenceTiles";

const empty = { inHouse: 0, hospital: 0, onLeave: 0, onHold: 0, total: 0 };

describe("PresenceTiles empty roster and census disagreement (COL-670)", () => {
  it("says the roster is empty and links to the roster and to admissions", () => {
    render(<PresenceTiles presence={empty} available licensedBeds={52} standUpCensus={null} facilityName="Oakridge ALF" />);
    const note = screen.getByTestId("presence-note");
    expect(note).toHaveTextContent("No residents are on the roster for Oakridge ALF yet.");
    expect(within(note).getByRole("link", { name: "Open the roster" })).toHaveAttribute("href", "/admin/residents");
    expect(within(note).getByRole("link", { name: "Start an admission" })).toHaveAttribute("href", "/pipeline/admissions/new");
  });

  it("gives Stand Up 47 vs roster 0 one message and a next step, not two unrelated numbers", () => {
    render(
      <PresenceTiles
        presence={empty}
        available
        licensedBeds={52}
        standUpCensus={{ value: 47, weekStart: "2026-09-21" }}
        facilityName="Oakridge ALF"
      />,
    );
    const notes = screen.getAllByRole("note");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toHaveTextContent(
      "No residents are on the roster for Oakridge ALF yet. Weekly Stand Up reported 47 for the week of 2026-09-21, so those residents are not in Haven yet",
    );
    expect(within(notes[0]).getByRole("link", { name: "Start an admission" })).toBeInTheDocument();
    expect(within(notes[0]).getByRole("link", { name: "Open Stand Up" })).toHaveAttribute("href", "/admin/stand-up");
    expect(screen.queryByText(/being reconciled/)).toBeNull();
  });

  it("says nothing extra when the roster has residents and matches Stand Up", () => {
    render(
      <PresenceTiles
        presence={{ inHouse: 30, hospital: 2, onLeave: 1, onHold: 3, total: 33 }}
        available
        licensedBeds={36}
        standUpCensus={{ value: 33, weekStart: "2026-09-21" }}
        facilityName="Homewood Lodge"
      />,
    );
    expect(screen.queryByTestId("presence-note")).toBeNull();
  });

  it("does not claim an empty roster when the counts are unavailable", () => {
    render(<PresenceTiles presence={empty} available={false} licensedBeds={52} standUpCensus={null} facilityName="Oakridge ALF" />);
    expect(screen.queryByTestId("presence-note")).toBeNull();
  });
});
