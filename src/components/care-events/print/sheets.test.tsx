import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { INCIDENT_REPORTS_LOG_COLUMNS } from "@/lib/care-events/print";
import type { CareEventPrintPacket, IncidentReportsLogRow, PrintFacility } from "@/lib/care-events/print-data";
import type { WitnessTask } from "@/lib/care-events/witness";

import { IncidentFormSheet } from "./IncidentFormSheet";
import { IncidentReportsLogSheet } from "./IncidentReportsLogSheet";
import { PhysicianSheet } from "./PhysicianSheet";

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

function witness(overrides: Partial<WitnessTask> = {}): WitnessTask {
  return {
    id: "followup-1",
    incidentId: "incident-1",
    incidentNumber: "HOM-2026-0007",
    careEventId: "care-event-1",
    description: "Witness statement for HOM-2026-0007",
    dueAt: "2026-09-16T22:00:00Z",
    assignedTo: "user-2",
    assignedToName: "Probe Staff B",
    completedAt: "2026-09-16T23:04:00Z",
    completedBy: "user-2",
    choice: "saw_it",
    note: "She was reaching for the call light.",
    ...overrides,
  };
}

/** A synthetic Level 3 Fall with witnesses and attachments. */
function packet(overrides: Partial<CareEventPrintPacket> = {}): CareEventPrintPacket {
  return {
    card: {
      id: "care-event-1",
      status: "acknowledged",
      kind: "fall",
      tileWord: "Fall",
      level: 3,
      derivedLevel: 3,
      levelChangeReason: null,
      sentence: "Found on the floor in the resident room at 10:05 PM. Not witnessed. Hurt a little. Hit head. Not going out. First aid given.",
      note: "Complained of a sore hip.",
      occurredAt: "2026-09-16T22:05:00Z",
      createdAt: "2026-09-16T22:06:00Z",
      acknowledgedAt: "2026-09-16T22:09:00Z",
      acknowledgedByName: "Probe Administrator",
      closedAt: null,
      facilityId: "facility-1",
      organizationId: "org-1",
      timeZone: "America/New_York",
      resident: { id: "resident-1", name: "Probe, Resident", roomLabel: "114" },
      reporter: { id: "user-1", fullName: "Probe Staff A", firstName: "Probe", phone: null },
      incident: {
        id: "incident-1",
        incidentNumber: "HOM-2026-0007",
        status: "open",
        familyNotified: true,
        familyNotifiedAt: "2026-09-16T22:30:00Z",
        familyNotifiedMethod: "phone",
        physicianNotified: true,
        physicianNotifiedAt: "2026-09-16T22:35:00Z",
        physicianOrders: "Ice and observe.",
        injuryTreatment: "first_aid",
        ahcaReportable: false,
        resolutionNotes: null,
      },
      flags: {} as never,
      admin: {
        familyNotifiedAt: "2026-09-16T22:30:00Z",
        familyLater: false,
        physicianNotifiedAt: "2026-09-16T22:35:00Z",
        physicianLater: false,
        ems: "first_aid",
        correctiveActions: ["care_plan_review", "increased_checks"],
        correctiveOther: "Moved the call light within reach.",
        ahcaReportable: false,
        ahcaReason: null,
        dcfReportedAt: null,
        videoSecured: "na",
      },
      attachments: [],
      deliveries: [],
      gate: null,
    } as unknown as CareEventPrintPacket["card"],
    facility,
    resident: {
      id: "resident-1",
      firstName: "Resident",
      lastName: "Probe",
      dateOfBirth: "1944-07-28",
      roomLabel: "114",
      physicianName: "Dr Reyes",
      physicianPhone: "555-0111",
      physicianFax: "555-0112",
    },
    incidentExtras: {
      injuryOccurred: true,
      injuryDescription: "Bruise forming on the right hip",
      injurySeverity: "minor",
      injuryBodyLocation: "right_hip",
      locationDescription: "Resident room",
      contributingFactors: ["rushing", "improper_footwear"],
      physicianNotifiedAt: "2026-09-16T22:35:00Z",
      familyNotifiedAt: "2026-09-16T22:30:00Z",
      resolutionNotes: null,
    },
    witnesses: [witness(), witness({ id: "followup-2", assignedToName: "Probe Staff C", completedAt: null, choice: null, note: null })],
    attachments: [
      { id: "attachment-1", path: "org-1/facility-1/care-event-1/a.jpg", kind: "photo", description: null, takenAt: "2026-09-16T22:10:00Z", takenByName: "Probe Staff A" },
      { id: "attachment-2", path: "org-1/facility-1/care-event-1/b.pdf", kind: "physician_order", description: null, takenAt: "2026-09-16T23:40:00Z", takenByName: "Probe Administrator" },
    ],
    ...overrides,
  };
}

describe("IncidentFormSheet", () => {
  it("renders Sections 1 to 4 for a Level 3 Fall with witnesses and attachments", () => {
    render(<IncidentFormSheet packet={packet()} />);

    expect(screen.getByRole("heading", { name: "Incident Report" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Section 1. What happened" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Section 2. Notifications" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Section 3. Witnesses" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Section 4. Corrective action" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Attachments" })).toBeInTheDocument();
  });

  it("carries the identifying block the binder expects", () => {
    render(<IncidentFormSheet packet={packet()} />);
    expect(screen.getByText("HOM-2026-0007")).toBeInTheDocument();
    expect(screen.getByText("Probe, Resident")).toBeInTheDocument();
    expect(screen.getByText("114")).toBeInTheDocument();
    // The level is a word, never a raw enum.
    expect(screen.getByText("Urgent")).toBeInTheDocument();
    expect(screen.queryByText(/level_3/)).not.toBeInTheDocument();
  });

  it("puts each witness's answer in Section 3, answered or not", () => {
    render(<IncidentFormSheet packet={packet()} />);
    const section = screen.getByRole("heading", { name: "Section 3. Witnesses" }).parentElement!;
    expect(within(section).getByText("Probe Staff B")).toBeInTheDocument();
    expect(within(section).getByText("Saw it")).toBeInTheDocument();
    expect(within(section).getByText("She was reaching for the call light.")).toBeInTheDocument();
    expect(within(section).getByText("Probe Staff C")).toBeInTheDocument();
    expect(within(section).getByText("Not answered")).toBeInTheDocument();
  });

  it("lists the attachments by kind without reproducing them", () => {
    render(<IncidentFormSheet packet={packet()} />);
    expect(screen.getByText(/Photo · added by Probe Staff A/)).toBeInTheDocument();
    expect(screen.getByText(/Physician order · added by Probe Administrator/)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("leaves a blank line where the paper form left a blank", () => {
    const withoutAdmin = packet();
    render(<IncidentFormSheet packet={{ ...withoutAdmin, incidentExtras: null }} />);
    expect(screen.getAllByText("________________________").length).toBeGreaterThan(0);
  });
});

describe("PhysicianSheet", () => {
  it("prints the physician's fax number when Haven holds one", () => {
    render(<PhysicianSheet packet={packet()} />);
    expect(screen.getByRole("heading", { name: "Physician Notification" })).toBeInTheDocument();
    expect(screen.getByText("Dr Reyes")).toBeInTheDocument();
    expect(screen.getByText("555-0112")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Physician orders or signature" })).toBeInTheDocument();
  });

  it("prints a blank line rather than guessing when there is no fax number", () => {
    const noFax = packet();
    render(
      <PhysicianSheet
        packet={{ ...noFax, resident: { ...noFax.resident!, physicianFax: null, physicianName: null } }}
      />,
    );
    // Both the physician name and the fax line fall back to a blank.
    expect(screen.getAllByText("________________________").length).toBeGreaterThanOrEqual(2);
  });

  it("carries the facility letterhead and a callback number", () => {
    render(<PhysicianSheet packet={packet()} />);
    expect(screen.getAllByText("Test Lodge").length).toBeGreaterThan(0);
    expect(screen.getByText("1 Test Way, Testville, FL, 00000")).toBeInTheDocument();
    expect(screen.getAllByText("555-0100").length).toBeGreaterThan(0);
  });
});

describe("IncidentReportsLogSheet", () => {
  function logRow(overrides: Partial<IncidentReportsLogRow> = {}): IncidentReportsLogRow {
    return {
      incidentId: "incident-1",
      logDate: "2026-09-16",
      room: "114",
      resident: "Probe, Resident",
      fall: true,
      bruise: true,
      scrapesOrBurn: false,
      cutLacerationPuncture: false,
      nonApparent: false,
      other: false,
      contributingFactors: "rushing; improper_footwear",
      shift: "evening",
      ...overrides,
    };
  }

  it("prints the columns in the paper log's order", () => {
    render(<IncidentReportsLogSheet facility={facility} rows={[logRow()]} from="2026-09-01" to="2026-09-30" />);
    const headers = screen.getAllByRole("columnheader").map((cell) => cell.textContent);
    expect(headers).toEqual(INCIDENT_REPORTS_LOG_COLUMNS.map((column) => column.label));
  });

  it("ticks with an X and leaves the rest of the cells empty", () => {
    render(<IncidentReportsLogSheet facility={facility} rows={[logRow()]} from="2026-09-01" to="2026-09-30" />);
    const cells = screen.getAllByRole("cell").map((cell) => cell.textContent);
    // Date, room, resident, fall X, bruise X, then four empty tick cells.
    expect(cells).toEqual(["Sep 16, 2026", "114", "Probe, Resident", "X", "X", "", "", "", "", "rushing; improper_footwear", "Evening"]);
  });

  it("dates a row on the day the log says, not the day before", () => {
    render(<IncidentReportsLogSheet facility={facility} rows={[logRow({ logDate: "2026-01-01" })]} from="2026-01-01" to="2026-01-31" />);
    expect(screen.getAllByText("Jan 1, 2026").length).toBeGreaterThan(0);
  });

  it("says the range and the count, and says so plainly when the month was quiet", () => {
    render(<IncidentReportsLogSheet facility={facility} rows={[]} from="2026-09-01" to="2026-09-30" />);
    expect(screen.getByText(/Sep 1, 2026 to Sep 30, 2026 · 0 entries/)).toBeInTheDocument();
    expect(screen.getByText("No incidents were recorded in this range.")).toBeInTheDocument();
  });

  it("counts one entry in the singular", () => {
    render(<IncidentReportsLogSheet facility={facility} rows={[logRow()]} from="2026-09-01" to="2026-09-30" />);
    expect(screen.getByText(/· 1 entry$/)).toBeInTheDocument();
  });
});
