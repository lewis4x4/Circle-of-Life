import { cleanup, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SurveyPackSheet } from "./SurveyPackSheet";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  kioskDetails: vi.fn(),
  from: vi.fn(),
  searchParams: new URLSearchParams("from=2026-01-01&to=2026-06-30&sections=register,census,visitors&holds=1"),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: mocks.rpc, from: mocks.from }),
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => mocks.searchParams }));

const REGISTER_ROW = {
  event_at: "2026-03-10T15:00:00Z",
  event_type: "admission",
  resident_id: "r1",
  resident_display_name: "Test Resident A",
  room_number: "101",
  bed_label: "A",
  room_as_of: "current",
  from_status: null,
  to_status: "active",
  admission_source: "Hospital referral",
  discharge_reason: null,
  discharge_destination: null,
  recorded_by: null,
  recorded_by_name: "Review clerk",
};

const CENSUS_ROW = {
  resident_id: "r1",
  resident_display_name: "Test Resident A",
  month: "2026-02-01",
  physical_presence_days: 20,
  billable_days: 28,
};

const VISITOR_ROW = {
  id: "v1",
  visitor_name: "Test Visitor One",
  visitor_phone: null,
  visitor_type: "surveyor_regulator",
  visiting_type: "facility",
  visiting_resident_id: null,
  visiting_resident_name: null,
  signed_in_at: "2026-06-10T18:00:00Z",
  signed_in_by_name: "Review clerk",
  signed_out_at: null,
  signed_out_by_name: null,
  sign_out_method: null,
  voided_at: null,
  void_reason: null,
  left_open: false,
};

function routeRpc(name: string) {
  if (name === "survey_print_pack_record") return { data: "audit-1", error: null };
  if (name === "admission_discharge_register") return { data: [REGISTER_ROW], error: null };
  if (name === "census_record_monthly") return { data: [CENSUS_ROW], error: null };
  if (name === "visitor_log") return { data: [VISITOR_ROW], error: null };
  return { data: null, error: null };
}

beforeEach(() => {
  mocks.from.mockReset();
  mocks.from.mockImplementation(() => ({ select: () => ({ in: mocks.kioskDetails }) }));
  mocks.kioskDetails.mockReset();
  mocks.kioskDetails.mockResolvedValue({ data: [], error: null });
  mocks.rpc.mockReset();
  mocks.rpc.mockImplementation((name: string) => Promise.resolve(routeRpc(name)));
  vi.stubGlobal("print", vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderSheet() {
  render(
    <SurveyPackSheet
      organizationId="org-1"
      facilityId="fac-1"
      facilityName="Homewood Lodge"
      printedByName="Review clerk"
    />,
  );
}

describe("the print is recorded", () => {
  it("writes exactly one audit event per print, with sections and a range and no names", async () => {
    renderSheet();
    await waitFor(() => {
      expect(mocks.rpc).toHaveBeenCalledWith("survey_print_pack_record", {
        p_facility_id: "fac-1",
        p_sections: ["register", "census", "visitors"],
        p_from: "2026-01-01",
        p_to: "2026-06-30",
      });
    });
    const calls = mocks.rpc.mock.calls.filter(([name]) => name === "survey_print_pack_record");
    expect(calls).toHaveLength(1);
    const payload = JSON.stringify(calls[0][1]);
    expect(payload).not.toContain("Test Resident");
    expect(payload).not.toContain("Test Visitor");
    expect(payload).not.toContain("Review clerk");
  });

  it("records the print before it asks for a single row of content", async () => {
    renderSheet();
    await waitFor(() => expect(mocks.rpc.mock.calls.length).toBeGreaterThan(1));
    expect(mocks.rpc.mock.calls[0][0]).toBe("survey_print_pack_record");
  });

  it("shows nothing but the failure when the audit write fails", async () => {
    mocks.rpc.mockImplementation((name: string) =>
      name === "survey_print_pack_record"
        ? Promise.resolve({ data: null, error: { message: "audit_log unreachable" } })
        : Promise.resolve(routeRpc(name)),
    );
    renderSheet();
    expect(await screen.findByText("Print could not be recorded. Try again.")).toBeTruthy();
    expect(screen.queryByText("Test Resident A")).toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalledWith("admission_discharge_register", expect.anything());
  });
});

describe("the sheet", () => {
  it("renders every requested section from the fixture", async () => {
    renderSheet();
    expect(await screen.findByText("Admission and discharge register")).toBeTruthy();
    expect(screen.getByText("Census record")).toBeTruthy();
    expect(screen.getByText("Visitor log")).toBeTruthy();
    expect(screen.getAllByText("Test Resident A").length).toBeGreaterThan(0);
    expect(screen.getByText("Test Visitor One")).toBeTruthy();
  });

  it("prints a kiosk sign-in with the company, the typed resident and the kiosk as signer (COL-692)", async () => {
    mocks.rpc.mockImplementation((name: string) =>
      Promise.resolve(
        name === "visitor_log"
          ? { data: [{ ...VISITOR_ROW, id: "k1", visitor_name: "Dana Reyes", visitor_type: "healthcare_provider", visiting_type: null, signed_in_by_name: null }], error: null }
          : routeRpc(name),
      ),
    );
    mocks.kioskDetails.mockResolvedValue({
      data: [{ id: "k1", kiosk_device_id: "dev-1", visitor_company: "Sunshine Hospice", visiting_name_text: "Mrs Carter" }],
      error: null,
    });
    renderSheet();
    expect(await screen.findByText("Dana Reyes · Sunshine Hospice")).toBeTruthy();
    expect(screen.getByText("Mrs Carter (typed at the kiosk)")).toBeTruthy();
    expect(screen.getByText("Front-door kiosk")).toBeTruthy();
  });

  it("keeps physical presence and billable days in separate columns", async () => {
    renderSheet();
    expect(await screen.findByText("Days physically present")).toBeTruthy();
    expect(screen.getByText("Billable days")).toBeTruthy();
    expect(screen.getByText("20")).toBeTruthy();
    expect(screen.getByText("28")).toBeTruthy();
  });

  it("stamps every page with who printed it, when, and which building", async () => {
    renderSheet();
    const stamps = await screen.findAllByText(/Printed from Haven by Review clerk on .* Eastern · Homewood Lodge/);
    expect(stamps.length).toBeGreaterThan(0);
  });

  it("names a held bed as a bed hold, never as a level of care", async () => {
    renderSheet();
    await screen.findByText("Admission and discharge register");
    expect(document.body.textContent?.toLowerCase()).not.toContain("memory care");
  });

  it("hides the on-screen controls from the paper", async () => {
    renderSheet();
    const button = await screen.findByRole("button", { name: "Print" });
    const controls = button.closest("div");
    expect(controls?.className).toMatch(/controls/);
  });
});

describe("the development double render", () => {
  it("still renders the pack, and still records the print exactly once", async () => {
    // React mounts, unmounts and remounts every effect in development. A
    // "have I started" boolean would skip the second run after the first run's
    // cleanup had already disowned its results, and the sheet would sit on its
    // spinner forever with a surveyor waiting at the desk.
    render(
      <StrictMode>
        <SurveyPackSheet
          organizationId="org-1"
          facilityId="fac-1"
          facilityName="Homewood Lodge"
          printedByName="Review clerk"
        />
      </StrictMode>,
    );
    expect(await screen.findByText("Admission and discharge register")).toBeTruthy();
    const recorded = mocks.rpc.mock.calls.filter(([name]) => name === "survey_print_pack_record");
    expect(recorded).toHaveLength(1);
  });
});

describe("accessibility of the sheet", () => {
  it("has no axe violations: the tables a surveyor reads have real headers", async () => {
    const { container } = render(
      <SurveyPackSheet
        organizationId="org-1"
        facilityId="fac-1"
        facilityName="Homewood Lodge"
        printedByName="Review clerk"
      />,
    );
    await screen.findByText("Admission and discharge register");
    const results = await axe.run(container, {
      // Contrast needs real layout; a11y:routes judges that in a browser.
      rules: { "color-contrast": { enabled: false } },
    });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});

describe("only the chosen sections", () => {
  it("does not fetch or print a section that was not ticked", async () => {
    mocks.searchParams = new URLSearchParams("from=2026-01-01&to=2026-06-30&sections=register&holds=0");
    renderSheet();
    await screen.findByText("Admission and discharge register");
    expect(screen.queryByText("Visitor log")).toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalledWith("visitor_log", expect.anything());
    expect(mocks.rpc).toHaveBeenCalledWith(
      "admission_discharge_register",
      expect.objectContaining({ p_include_holds: false }),
    );
    mocks.searchParams = new URLSearchParams(
      "from=2026-01-01&to=2026-06-30&sections=register,census,visitors&holds=1",
    );
  });
});

describe("current census by room (DEC-2026-09-22-10)", () => {
  it("prints everyone holding a bed in room order, who is in the building, and records the section", async () => {
    const tables: Record<string, unknown[]> = {
      residents: [
        { id: "r1", first_name: "Resident A", last_name: "Test", status: "active", bed_id: "b12b" },
        { id: "r2", first_name: "Resident B", last_name: "Test", status: "hospital_hold", bed_id: "b2" },
      ],
      beds: [{ id: "b12b", bed_label: "B", room_id: "room12" }, { id: "b2", bed_label: "A", room_id: "room2" }],
      rooms: [{ id: "room12", room_number: "12" }, { id: "room2", room_number: "2" }],
    };
    mocks.from.mockImplementation((table: string) => {
      const chain = { select: () => chain, eq: () => chain, is: () => chain, in: () => chain, limit: () => Promise.resolve({ data: tables[table] ?? [], error: null }) };
      return chain;
    });
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    mocks.searchParams = new URLSearchParams("from=2026-01-01&to=2026-06-30&sections=room_census&holds=1");
    render(<SurveyPackSheet organizationId="org" facilityId="fac" facilityName="Homewood Lodge" printedByName="Review clerk" />);
    expect(await screen.findByRole("heading", { name: "Current census by room" })).toBeInTheDocument();
    const cells = screen.getAllByRole("row").slice(1, 3).map((row) => row.textContent);
    expect(cells).toEqual(["2AResident B TestHospital or rehab", "12BResident A TestIn building"]);
    expect(screen.getByText(/1 in the building · 1 away \(hospital, rehab or leave\), bed held\./)).toBeInTheDocument();
    expect(mocks.rpc).toHaveBeenCalledWith("survey_print_pack_record", expect.objectContaining({ p_sections: ["room_census"] }));
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain("Resident A");
  });
});
