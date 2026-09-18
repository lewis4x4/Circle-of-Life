import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CARE_EVENT_TILES } from "@/lib/care-events/tiles";
import { LEVEL_CASES } from "@/lib/care-events/taxonomy-packet";
import type { PrintFacility } from "@/lib/care-events/print-data";
import type { LevelEffectRow } from "@/lib/care-events/taxonomy-packet";

import { TaxonomyPacketSheet } from "./TaxonomyPacketSheet";

afterEach(cleanup);

const facility: PrintFacility = {
  id: "facility-1",
  name: "Test Lodge",
  addressLine1: "1 Test Way",
  city: "Testville",
  state: "FL",
  zip: "00000",
  phone: "555-0100",
  timeZone: "America/New_York",
};

const effects: LevelEffectRow[] = [
  { level: 1, word: "Note", steps: [], ackWithinMinutes: null, followups: [] },
  {
    level: 2,
    word: "Heads-up",
    steps: [{ step: 0, afterMinutes: 0, target: "Administrator or Assistant", channels: ["in_app", "push"] }],
    ackWithinMinutes: 30,
    followups: [{ taskType: "witness_statement", description: "Witness statement", dueOffsetMinutes: 480, kind: "any", requiresFlag: null }],
  },
  {
    level: 3,
    word: "Urgent",
    steps: [{ step: 2, afterMinutes: 10, target: "On-call secondary", channels: ["sms", "voice"] }],
    ackWithinMinutes: 10,
    followups: [],
  },
  {
    level: 4,
    word: "Emergency",
    steps: [{ step: 2, afterMinutes: 0, target: "Owner", channels: ["push", "sms", "voice"] }],
    ackWithinMinutes: 5,
    followups: [],
  },
];

describe("TaxonomyPacketSheet", () => {
  it("prints every tile and every level case", () => {
    render(<TaxonomyPacketSheet facility={facility} effects={effects} />);

    for (const tile of CARE_EVENT_TILES) {
      expect(screen.getByRole("heading", { name: tile.word, level: 2 })).toBeInTheDocument();
    }
    expect(screen.getByText(`${CARE_EVENT_TILES.length} tiles · ${LEVEL_CASES.length} level cases · review each tile, then sign the last page.`)).toBeInTheDocument();
  });

  it("names the paper artefact each tile replaces", () => {
    render(<TaxonomyPacketSheet facility={facility} effects={effects} />);
    expect(screen.getByText(/Elopement Incident Form/)).toBeInTheDocument();
    expect(screen.getByText(/Medication Incident Report/)).toBeInTheDocument();
    expect(screen.getByText(/Grievance Form and Grievance Reports Log/)).toBeInTheDocument();
  });

  it("shows what fires at each level from the configuration rows", () => {
    render(<TaxonomyPacketSheet facility={facility} effects={effects} />);
    expect(screen.getByRole("heading", { name: "What fires at each level" })).toBeInTheDocument();
    // Only a Note interrupts nobody; every other level names a target.
    expect(screen.getAllByText("Nobody is interrupted.")).toHaveLength(1);
    expect(screen.getByText("On-call secondary by text, voice call in 10 minutes")).toBeInTheDocument();
    expect(screen.getByText("Administrator or Assistant by in-app, push immediately")).toBeInTheDocument();
    expect(screen.getByText("Within 30 minutes")).toBeInTheDocument();
    expect(screen.getByText(/Witness statement in 8 hours/)).toBeInTheDocument();
  });

  it("ends on a sign-off page with a row for the taxonomy and a row for retirement", () => {
    render(<TaxonomyPacketSheet facility={facility} effects={effects} />);
    const signOff = screen.getByRole("heading", { name: "Sign off" }).parentElement!;

    expect(within(signOff).getByText("Taxonomy and owner decisions D1 to D7")).toBeInTheDocument();
    expect(within(signOff).getByText("Paper and fax retirement")).toBeInTheDocument();
    expect(within(signOff).getByText("Paper and fax retirement does not begin until the second row below is signed.")).toBeInTheDocument();

    // Name, signature and date are blank lines for a person to fill in.
    const headers = within(signOff).getAllByRole("columnheader").map((cell) => cell.textContent);
    expect(headers).toEqual(["What is being signed", "Name", "Signature", "Date"]);
  });

  it("names no person on the sheet", () => {
    const { container } = render(<TaxonomyPacketSheet facility={facility} effects={effects} />);
    const text = container.textContent ?? "";
    for (const name of ["Jessica", "Michelle", "Murphy", "Darren", "Milton", "Brian"]) {
      expect(text).not.toContain(name);
    }
  });

  it("says a taxonomy change goes back as an issue, not an ad hoc edit", () => {
    render(<TaxonomyPacketSheet facility={facility} effects={effects} />);
    expect(screen.getByText(/never an ad hoc edit to a running rule/)).toBeInTheDocument();
  });
});
