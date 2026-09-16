import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { buildForm1823AlignmentRoster, type RosterForm } from "@/lib/care-plans/form-1823-alignment-roster";

import { Form1823AlignmentPageClient } from "./Form1823AlignmentPageClient";

const HOMEWOOD = "00000000-0000-0000-0002-000000000003";

vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: (selector: (state: { selectedFacilityId: string | null; availableFacilities: Array<{ id: string; name: string }> }) => unknown) =>
    selector({ selectedFacilityId: HOMEWOOD, availableFacilities: [{ id: HOMEWOOD, name: "Homewood Lodge, ALF" }] }),
}));

vi.mock("@/lib/care-plans/form-1823-alignment-roster", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/care-plans/form-1823-alignment-roster")>();
  return { ...original, fetchForm1823AlignmentRoster: vi.fn(async () => { throw new Error("not expected in this test"); }) };
});

function form(residentId: string, overrides: Partial<RosterForm> = {}): RosterForm {
  return {
    id: `form-${residentId}`,
    resident_id: residentId,
    exam_date: "2026-09-04",
    expiration_date: null,
    physician_name: null,
    examiner_title: null,
    allergies: null,
    prescribed_diet: null,
    medication_assistance: "self_administered",
    elopement_risk: false,
    adl_bathing: "assistance",
    adl_dressing: "independent",
    adl_eating: "independent",
    adl_transferring: "independent",
    adl_toileting: "independent",
    adl_grooming: "independent",
    adl_walking: "independent",
    condition_pressure_injury: false,
    physical_limitations: {},
    cognitive_behavioral_status: {},
    service_requirements: {},
    precautions: {},
    is_current: true,
    status: "received",
    ...overrides,
  };
}

const residents = [
  { id: "r-none", first_name: "Bobby", last_name: "Patton" },
  { id: "r-noplan", first_name: "Carol", last_name: "Dionne" },
  { id: "r-gap", first_name: "Cecil", last_name: "Oglesby" },
  { id: "r-ok", first_name: "Deborah", last_name: "Sturm" },
  { id: "r-old", first_name: "Charlie", last_name: "Hurley" },
];

function mixedRoster() {
  return buildForm1823AlignmentRoster({
    residents,
    forms: [form("r-noplan"), form("r-gap"), form("r-ok"), form("r-old", { exam_date: "2022-01-01" })],
    plans: [
      { id: "p-gap", resident_id: "r-gap", version: 1 },
      { id: "p-ok", resident_id: "r-ok", version: 2 },
      { id: "p-old", resident_id: "r-old", version: 1 },
    ],
    items: [
      { care_plan_id: "p-ok", category: "bathing", title: "Bathing", assistance_level: "limited_assist" },
      { care_plan_id: "p-old", category: "bathing", title: "Bathing", assistance_level: "limited_assist" },
    ],
    admissionCases: [{ id: "case-1", resident_id: "r-none", status: "move_in", created_at: "2026-09-01T00:00:00Z" }],
    today: "2026-09-15",
  });
}

function allMissingRoster() {
  return buildForm1823AlignmentRoster({ residents, forms: [], plans: [], items: [], today: "2026-09-15" });
}

function renderPage(roster = mixedRoster()) {
  return render(<Form1823AlignmentPageClient initialRoster={roster} initialError={null} initialFacilityId={HOMEWOOD} />);
}

function desktopRows() {
  const table = screen.getByRole("table");
  return within(table).getAllByRole("row").slice(1);
}

describe("Form1823AlignmentPageClient", () => {
  it("summary counts agree with the rows when nothing is recorded", () => {
    renderPage(allMissingRoster());
    expect(screen.getByRole("button", { name: "Form 1823 not recorded: 5 of 5 residents" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No active care plan: 5 of 5 residents" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Alignment cannot be assessed: 5 of 5 residents" })).toBeInTheDocument();
    // Nothing was compared, so the gaps count says so instead of implying a clean review.
    expect(screen.getByRole("button", { name: "Needs the plan does not answer: 0 of 0 compared" })).toBeInTheDocument();
    const rows = desktopRows();
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(within(row).getByText("Not recorded in Haven")).toBeInTheDocument();
      expect(within(row).getByText("No active plan")).toBeInTheDocument();
      expect(within(row).getByText("Cannot assess")).toBeInTheDocument();
    }
    expect(screen.getByText("Showing 5 of 5 residents")).toBeInTheDocument();
  });

  it("summary counts agree with the rows across mixed states", () => {
    renderPage();
    expect(screen.getByRole("button", { name: "Form 1823 not recorded: 1 of 5 residents" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No active care plan: 2 of 5 residents" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Alignment cannot be assessed: 1 of 5 residents" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Needs the plan does not answer: 1 of 3 compared" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1823 expired or older than 3 years: 1 of 4 recorded" })).toBeInTheDocument();

    const rows = desktopRows();
    const noPlanRows = rows.filter((row) => within(row).queryByText("No active plan"));
    expect(noPlanRows).toHaveLength(2);
    const notRecordedRows = rows.filter((row) => within(row).queryByText("Not recorded in Haven"));
    expect(notRecordedRows).toHaveLength(1);
    expect(rows.filter((row) => within(row).queryByText("1 need unanswered"))).toHaveLength(1);
    expect(rows.filter((row) => within(row).queryByText("Answers the 1823"))).toHaveLength(2);
    expect(rows.filter((row) => within(row).queryByText("Older than 3 years"))).toHaveLength(1);
  });

  it("names each row action after its destination and keeps it visible", () => {
    renderPage();
    const table = screen.getByRole("table");
    expect(within(table).getByRole("link", { name: "Record Form 1823 for Bobby Patton" })).toHaveAttribute("href", "/admin/admissions/case-1");
    expect(within(table).getByRole("link", { name: "Open care plan for Carol Dionne" })).toHaveAttribute("href", "/admin/residents/r-noplan/care-plan");
    expect(within(table).getByRole("link", { name: "Review alignment for Cecil Oglesby" })).toHaveAttribute("href", "/admin/residents/r-gap/care-plan");
    for (const link of within(table).getAllByRole("link")) {
      expect(link.textContent?.trim().length).toBeGreaterThan(0);
    }
  });

  it("pressing a summary count filters the list to the rows it counted", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "No active care plan: 2 of 5 residents" }));
    expect(screen.getByText("Showing 2 of 5 residents")).toBeInTheDocument();
    const rows = desktopRows();
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(within(row).getByText("No active plan")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No active care plan: 2 of 5 residents" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "No active care plan: 2 of 5 residents" }));
    expect(screen.getByText("Showing 5 of 5 residents")).toBeInTheDocument();
  });

  it("searches residents by name and can clear back to the full list", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText("Search residents"), "sturm");
    expect(screen.getByText("Showing 1 of 5 residents")).toBeInTheDocument();
    expect(desktopRows()).toHaveLength(1);
    expect(within(desktopRows()[0]).getByText("Deborah Sturm")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Search residents"));
    await user.type(screen.getByLabelText("Search residents"), "nobody");
    expect(screen.getByText("No residents match these filters.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show all residents" }));
    expect(screen.getByText("Showing 5 of 5 residents")).toBeInTheDocument();
  });

  it("scopes the missing-document wording to Haven and drops the survey claim", () => {
    renderPage(allMissingRoster());
    expect(screen.queryByText(/on file/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/standard-ALF survey/i)).not.toBeInTheDocument();
    expect(screen.getByText("Homewood Lodge, ALF · 5 current residents")).toBeInTheDocument();
  });

  it("shows the error state with a retry instead of an empty list", async () => {
    render(<Form1823AlignmentPageClient initialRoster={null} initialError="Residents could not be read." initialFacilityId={HOMEWOOD} />);
    // A server-side failure triggers one client retry on mount; the mocked read fails too.
    expect(await screen.findByText("not expected in this test")).toBeInTheDocument();
    expect(screen.getByText("Form 1823 alignment unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
