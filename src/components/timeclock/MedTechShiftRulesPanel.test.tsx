import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const FACILITY = "00000000-0000-0000-0002-000000000003";
const auth = vi.hoisted(() => ({ appRole: "facility_admin", organizationId: "org-1", user: { id: "user-1" } }));
const db = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], inserted: [] as Record<string, unknown>[] }));

vi.mock("@/contexts/haven-auth-context", () => ({ useHavenAuth: () => auth }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ or: () => ({ order: async () => ({ data: db.rows, error: null }) }) }) }),
      insert: async (row: Record<string, unknown>) => {
        db.inserted.push(row);
        return { error: null };
      },
    }),
  }),
}));

import { MedTechShiftRulesPanel } from "./MedTechShiftRulesPanel";

const NOW = new Date("2026-09-23T18:00:00Z");

describe("MedTechShiftRulesPanel (COL-681)", () => {
  beforeEach(() => {
    auth.appRole = "facility_admin";
    db.inserted = [];
    db.rows = [
      {
        id: "r1", organization_id: "org-1", facility_id: null, open_trigger: "clock_in", close_trigger: "clock_out",
        effective_from: "2026-09-23T13:00:00Z", change_reason: "Brian Lewis ruling 2026-09-23 (COL-668)", created_at: "2026-09-23T13:00:00Z",
      },
    ];
  });

  it("shows the organization default in force and lets a facility admin add only a facility override", async () => {
    render(<MedTechShiftRulesPanel facilityId={FACILITY} facilityName="Homewood Lodge" now={() => NOW} />);
    expect(await screen.findByTestId("med-tech-shift-rule-current")).toHaveTextContent("Opens when the med-tech clocks in");
    expect(screen.getByTestId("med-tech-shift-rule-current")).toHaveTextContent("Organization default");
    expect(screen.queryByRole("option", { name: "Organization default" })).toBeNull();
    // Nothing is pre-selected.
    expect((screen.getByLabelText("Opens") as HTMLSelectElement).value).toBe("");

    fireEvent.change(screen.getByLabelText("Applies to"), { target: { value: "facility" } });
    fireEvent.change(screen.getByLabelText("Opens"), { target: { value: "none" } });
    fireEvent.change(screen.getByLabelText("Closes"), { target: { value: "clock_out" } });
    fireEvent.change(screen.getByLabelText("Takes effect"), { target: { value: "2026-09-25T07:00" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Homewood runs med pass from paper this week" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rule" }));

    await waitFor(() => expect(db.inserted).toHaveLength(1));
    expect(db.inserted[0]).toMatchObject({
      organization_id: "org-1",
      facility_id: FACILITY,
      open_trigger: "none",
      close_trigger: "clock_out",
      change_reason: "Homewood runs med pass from paper this week",
      created_by: "user-1",
    });
  });

  it("refuses a backdated rule before it reaches the database", async () => {
    auth.appRole = "owner";
    render(<MedTechShiftRulesPanel facilityId={FACILITY} facilityName="Homewood Lodge" now={() => NOW} />);
    await screen.findByTestId("med-tech-shift-rule-current");
    fireEvent.change(screen.getByLabelText("Applies to"), { target: { value: "organization" } });
    fireEvent.change(screen.getByLabelText("Opens"), { target: { value: "clock_in" } });
    fireEvent.change(screen.getByLabelText("Closes"), { target: { value: "none" } });
    fireEvent.change(screen.getByLabelText("Takes effect"), { target: { value: "2026-01-01T07:00" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "test" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rule" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("cannot be backdated");
    expect(db.inserted).toHaveLength(0);
  });

  it("offers no form to a role that cannot set the rule", async () => {
    auth.appRole = "manager";
    render(<MedTechShiftRulesPanel facilityId={FACILITY} facilityName="Homewood Lodge" now={() => NOW} />);
    await screen.findByTestId("med-tech-shift-rule-current");
    expect(screen.queryByRole("button", { name: "Save rule" })).toBeNull();
  });
});
