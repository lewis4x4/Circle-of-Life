import { cleanup, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RegisterClient } from "./RegisterClient";
import { SurveyPackChooser } from "./SurveyPackChooser";
import { VisitorLogClient } from "./VisitorLogClient";
import type { RegisterRow } from "@/lib/registers/register";

/**
 * Accessibility of the markup these surfaces produce.
 *
 * This is axe-core against the rendered DOM, which catches the rules that live
 * in the markup: labelled controls, table headers, roles, aria wiring, heading
 * order. It is not the same as `npm run a11y:routes`, which drives a real
 * browser and can also judge colour contrast and focus appearance. Those need
 * migration 412 applied to a live project, which this branch has not done.
 */
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("from=2026-01-01&to=2026-06-30&sections=register"),
  useRouter: () => ({ push: vi.fn() }),
}));

const REGISTER_ROWS: RegisterRow[] = [
  {
    eventAt: "2026-03-10T15:00:00Z",
    eventType: "admission",
    residentId: "r1",
    residentDisplayName: "Test Resident A",
    roomNumber: "101",
    bedLabel: "A",
    roomAsOf: "current",
    fromStatus: null,
    toStatus: "active",
    admissionSource: "Hospital referral",
    dischargeReason: null,
    dischargeDestination: null,
    recordedByName: "Review clerk",
  },
  {
    eventAt: "2026-03-12T15:00:00Z",
    eventType: "hospital_out",
    residentId: "r2",
    residentDisplayName: "Test Resident B",
    roomNumber: "102",
    bedLabel: "B",
    roomAsOf: "current",
    fromStatus: "active",
    toStatus: "hospital_hold",
    admissionSource: null,
    dischargeReason: null,
    dischargeDestination: null,
    recordedByName: "Review clerk",
  },
];

const VISITOR_DB_ROW = {
  id: "v1",
  visitor_name: "Test Visitor One",
  visitor_phone: null,
  visitor_type: "family_friend",
  visiting_type: "resident",
  visiting_resident_id: "r1",
  visiting_resident_name: "Test Resident A",
  signed_in_at: "2026-06-10T18:00:00Z",
  signed_in_by_name: "Review clerk",
  signed_out_at: null,
  signed_out_by_name: null,
  sign_out_method: null,
  voided_at: null,
  void_reason: null,
  left_open: false,
};

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: [VISITOR_DB_ROW], error: null });
});
afterEach(() => cleanup());

async function violations(container: HTMLElement) {
  const results = await axe.run(container, {
    // Contrast needs real layout and computed colour, which this DOM does not
    // have. `npm run a11y:routes` is where contrast gets judged.
    rules: { "color-contrast": { enabled: false } },
  });
  return results.violations.map((v) => `${v.id}: ${v.nodes.length} node(s)`);
}

describe("the register screen", () => {
  it("has no axe violations with rows on screen", async () => {
    const { container } = render(
      <RegisterClient
        organizationId="org-1"
        facilityId="fac-1"
        initialRows={REGISTER_ROWS}
        initialFrom="2026-02-10"
        initialTo="2026-03-12"
        loadError={null}
      />,
    );
    await screen.findByText(/Admissions 1/);
    expect(await violations(container)).toEqual([]);
  });

  it("has no axe violations when the range is empty", async () => {
    const { container } = render(
      <RegisterClient
        organizationId="org-1"
        facilityId="fac-1"
        initialRows={[]}
        initialFrom="2026-02-10"
        initialTo="2026-03-12"
        loadError={null}
      />,
    );
    expect(await violations(container)).toEqual([]);
  });
});

describe("the visitor log", () => {
  it("has no axe violations with the sign in form and an open visitor", async () => {
    const { container } = render(
      <VisitorLogClient
        organizationId="org-1"
        facilityId="fac-1"
        residents={[{ id: "r1", firstName: "Test", lastName: "ResidentA" }]}
        onSignIn={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    await screen.findByText("In the building now (1)");
    expect(await violations(container)).toEqual([]);
  });
});

describe("the survey pack chooser", () => {
  it("has no axe violations", async () => {
    const { container } = render(<SurveyPackChooser facilityName="Homewood Lodge" />);
    await screen.findByText("Sections");
    expect(await violations(container)).toEqual([]);
  });
});

describe("errors are announced, not just coloured", () => {
  it("wires aria-invalid and aria-describedby on the visitor sign in form", async () => {
    const { container } = render(
      <VisitorLogClient
        organizationId="org-1"
        facilityId="fac-1"
        residents={[{ id: "r1", firstName: "Test", lastName: "ResidentA" }]}
        onSignIn={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    await screen.findByText("In the building now (1)");
    screen.getByRole("button", { name: "Sign in" }).click();
    await waitFor(() => {
      const name = screen.getByLabelText("Visitor name");
      expect(name.getAttribute("aria-invalid")).toBe("true");
      expect(name.getAttribute("aria-describedby")).toBe("visitor-problems");
    });
    expect(await violations(container)).toEqual([]);
  });
});

describe("the survey pack chooser names its building (COL-651)", () => {
  it("says which facility will print before anything prints", async () => {
    render(<SurveyPackChooser facilityName="Homewood Lodge" />);
    expect(await screen.findByRole("button", { name: "Print for Homewood Lodge" })).toBeInTheDocument();
  });
});
