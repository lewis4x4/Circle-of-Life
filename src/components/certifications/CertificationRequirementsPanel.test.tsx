import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const FACILITY = "00000000-0000-0000-0002-000000000003";
const auth = vi.hoisted(() => ({ appRole: "facility_admin", organizationId: "org-1", user: { id: "user-1" } }));
const store = vi.hoisted(() => ({
  selectedFacilityId: "00000000-0000-0000-0002-000000000003" as string | null,
  availableFacilities: [{ id: "00000000-0000-0000-0002-000000000003", name: "Homewood Lodge" }],
}));
const db = vi.hoisted(() => ({
  requirements: [] as Record<string, unknown>[],
  settings: [] as Record<string, unknown>[],
  inserted: [] as { table: string; row: Record<string, unknown> }[],
}));

vi.mock("@/contexts/haven-auth-context", () => ({ useHavenAuth: () => auth }));
vi.mock("@/hooks/useFacilityStore", () => ({ useFacilityStore: () => store }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => {
      const data = table === "staff_certification_requirements" ? db.requirements : db.settings;
      const q = {
        select: () => q,
        order: () => q,
        range: () => q,
        then: (resolve: (v: { data: unknown[]; error: null }) => unknown) => Promise.resolve({ data, error: null }).then(resolve),
        insert: async (row: Record<string, unknown>) => {
          db.inserted.push({ table, row });
          return { error: null };
        },
      };
      return q;
    },
  }),
}));

import { CertificationRequirementsPanel } from "./CertificationRequirementsPanel";

const NOW = new Date("2026-09-23T18:00:00Z");
const WINDOW_60 = {
  id: "s1", organization_id: "org-1", facility_id: null, expiring_soon_days: 60,
  effective_from: "2026-09-23T13:00:00Z", change_reason: "Carried over", created_at: "2026-09-23T13:00:00Z",
};

describe("CertificationRequirementsPanel (COL-709, COL-710)", () => {
  beforeEach(() => {
    auth.appRole = "facility_admin";
    store.selectedFacilityId = FACILITY;
    db.requirements = [];
    db.settings = [WINDOW_60];
    db.inserted = [];
  });

  it("says requirements are not set up when none is recorded, and shows the window in force", async () => {
    render(<CertificationRequirementsPanel now={() => NOW} />);
    expect(await screen.findByTestId("cert-requirements-current")).toHaveTextContent("not set up");
    expect(screen.getByTestId("cert-window-current")).toHaveTextContent("60 days");
  });

  it("lists the roles that need certifications", async () => {
    db.requirements = [
      {
        id: "r1", organization_id: "org-1", facility_id: null, staff_role: "medication_tech", certification_type: "bls_cpr",
        required: true, effective_from: "2026-09-23T13:00:00Z", change_reason: "test", created_at: "2026-09-23T13:00:00Z",
      },
    ];
    render(<CertificationRequirementsPanel now={() => NOW} />);
    expect(await screen.findByTestId("cert-requirements-current")).toHaveTextContent("Medication Tech: BLS / CPR");
  });

  it("lets a facility admin add a requirement for their building only, nothing pre-selected", async () => {
    render(<CertificationRequirementsPanel now={() => NOW} />);
    await screen.findByTestId("cert-requirements-current");
    const scopes = screen.getAllByLabelText("Applies to");
    expect(screen.queryAllByRole("option", { name: "Organization default" })).toHaveLength(0);
    expect((screen.getByLabelText("Job role") as HTMLSelectElement).value).toBe("");

    fireEvent.change(scopes[0]!, { target: { value: "facility" } });
    fireEvent.change(screen.getByLabelText("Job role"), { target: { value: "medication_tech" } });
    fireEvent.change(screen.getByLabelText("Certification"), { target: { value: "medication_administration" } });
    fireEvent.change(screen.getByLabelText("Requirement"), { target: { value: "yes" } });
    fireEvent.change(screen.getAllByLabelText("Takes effect")[0]!, { target: { value: "2026-09-25T07:00" } });
    fireEvent.change(screen.getAllByLabelText("Reason")[0]!, { target: { value: "State rule for med-techs" } });
    fireEvent.click(screen.getByRole("button", { name: "Save requirement" }));

    await waitFor(() => expect(db.inserted).toHaveLength(1));
    expect(db.inserted[0]).toMatchObject({
      table: "staff_certification_requirements",
      row: {
        organization_id: "org-1",
        facility_id: FACILITY,
        staff_role: "medication_tech",
        certification_type: "medication_administration",
        required: true,
        change_reason: "State rule for med-techs",
        created_by: "user-1",
      },
    });
  });

  it("refuses a window outside 7-365 days before it reaches the database", async () => {
    auth.appRole = "owner";
    render(<CertificationRequirementsPanel now={() => NOW} />);
    await screen.findByTestId("cert-window-current");
    fireEvent.change(screen.getAllByLabelText("Applies to")[1]!, { target: { value: "organization" } });
    fireEvent.change(screen.getByLabelText(/Days before expiry/), { target: { value: "400" } });
    fireEvent.change(screen.getAllByLabelText("Takes effect")[1]!, { target: { value: "2026-09-25T07:00" } });
    fireEvent.change(screen.getAllByLabelText("Reason")[1]!, { target: { value: "test" } });
    // The input's min/max stop the browser submitting; the handler guards anything that gets past it.
    fireEvent.submit(screen.getByRole("form", { name: "Change the expiring-soon window" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("7 to 365");
    expect(db.inserted).toHaveLength(0);
  });

  it("offers no form to a role that cannot set requirements", async () => {
    auth.appRole = "manager";
    render(<CertificationRequirementsPanel now={() => NOW} />);
    await screen.findByTestId("cert-requirements-current");
    expect(screen.queryByRole("button", { name: "Save requirement" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save window" })).toBeNull();
  });
});
