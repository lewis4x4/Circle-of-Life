import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const FACILITY = "00000000-0000-0000-0002-000000000003";
const auth = vi.hoisted(() => ({ appRole: "owner", organizationId: "org-1", user: { id: "user-1" } }));
const store = vi.hoisted(() => ({
  selectedFacilityId: "00000000-0000-0000-0002-000000000003" as string | null,
  availableFacilities: [{ id: "00000000-0000-0000-0002-000000000003", name: "Homewood Lodge" }],
}));
const db = vi.hoisted(() => ({
  rules: [] as Record<string, unknown>[],
  docs: [] as Record<string, unknown>[],
  overview: [] as Record<string, unknown>[],
  inserted: [] as unknown[],
}));

vi.mock("@/contexts/haven-auth-context", () => ({ useHavenAuth: () => auth }));
vi.mock("@/hooks/useFacilityStore", () => ({ useFacilityStore: () => store }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    rpc: async () => ({ data: db.overview, error: null }),
    from: (table: string) => {
      const data = table === "onboarding_manual_requirements" ? db.rules : db.docs;
      const q = {
        select: () => q,
        order: () => q,
        range: () => q,
        eq: () => q,
        is: () => q,
        limit: () => q,
        then: (resolve: (v: { data: unknown[]; error: null }) => unknown) => Promise.resolve({ data, error: null }).then(resolve),
        insert: async (rows: unknown) => {
          db.inserted.push(rows);
          return { error: null };
        },
      };
      return q;
    },
  }),
}));

import { OnboardingManualsSettings } from "./OnboardingManualsSettings";

const NOW = new Date("2026-09-24T18:00:00Z");
const MANUAL = { id: "doc-1", title: "Resident Rights P&P", doc_type: null, status: "published", word_count: 900 };

describe("OnboardingManualsSettings (COL-740)", () => {
  beforeEach(() => {
    auth.appRole = "owner";
    store.selectedFacilityId = FACILITY;
    db.rules = [];
    db.docs = [MANUAL, { id: "g", title: "Grace pack", doc_type: "grace_pack", status: "published", word_count: 10 }];
    db.overview = [];
    db.inserted = [];
  });

  it("says it is not set up and asks nobody to sign until a rule exists", async () => {
    render(<OnboardingManualsSettings now={() => NOW} />);
    expect(await screen.findByTestId("onboarding-manuals-current")).toHaveTextContent("Not set up");
    expect(screen.getByText(/No one here owes a manual sign-off/)).toBeTruthy();
  });

  it("offers only knowledge-base policy manuals and records one row per chosen job role", async () => {
    render(<OnboardingManualsSettings now={() => NOW} />);
    await screen.findByTestId("onboarding-manuals-current");
    expect(screen.queryByRole("option", { name: "Grace pack" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Applies to"), { target: { value: "organization" } });
    fireEvent.change(screen.getByLabelText("Manual"), { target: { value: "doc-1" } });
    fireEvent.change(screen.getByLabelText("Sign at onboarding"), { target: { value: "yes" } });
    fireEvent.change(screen.getByLabelText("Takes effect"), { target: { value: "2026-09-25T09:00" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Brian's COL-740 ruling" } });
    fireEvent.click(screen.getByLabelText("Medication Tech"));
    fireEvent.click(screen.getByLabelText("Housekeeping"));
    fireEvent.click(screen.getByRole("button", { name: "Record change" }));
    await waitFor(() => expect(db.inserted).toHaveLength(1));
    const rows = db.inserted[0] as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.staff_role).sort()).toEqual(["housekeeping", "medication_tech"]);
    expect(rows[0]).toMatchObject({ organization_id: "org-1", facility_id: null, document_id: "doc-1", required: true, created_by: "user-1" });
  });

  it("refuses a backdated change", async () => {
    render(<OnboardingManualsSettings now={() => NOW} />);
    await screen.findByTestId("onboarding-manuals-current");
    fireEvent.change(screen.getByLabelText("Applies to"), { target: { value: "organization" } });
    fireEvent.change(screen.getByLabelText("Manual"), { target: { value: "doc-1" } });
    fireEvent.change(screen.getByLabelText("Sign at onboarding"), { target: { value: "yes" } });
    fireEvent.change(screen.getByLabelText("Takes effect"), { target: { value: "2026-09-01T09:00" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "x" } });
    fireEvent.click(screen.getByLabelText("Medication Tech"));
    fireEvent.click(screen.getByRole("button", { name: "Record change" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("cannot be backdated");
    expect(db.inserted).toHaveLength(0);
  });

  it("lists new hires who still owe a manual", async () => {
    db.overview = [{ staff_id: "s1", first_name: "New", last_name: "Hire", staff_role: "medication_tech", hire_date: "2026-09-25", required_count: 2, signed_count: 1 }];
    render(<OnboardingManualsSettings now={() => NOW} />);
    expect(await screen.findByText("1 of 2 — onboarding not complete")).toBeTruthy();
  });
});
