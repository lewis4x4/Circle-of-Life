import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BenefitsCaseWorkspace } from "./BenefitsCaseWorkspace";
import {
  benefitsCommandSchema,
  type BenefitsDetail,
} from "@/lib/benefits/contracts";
const resident = "11111111-1111-4111-8111-111111111111";
const facility = "22222222-2222-4222-8222-222222222222";
const caseId = "33333333-3333-4333-8333-333333333333";
vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: (
    selector: (state: { selectedFacilityId: string }) => unknown,
  ) => selector({ selectedFacilityId: "22222222-2222-4222-8222-222222222222" }),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
function detail(): BenefitsDetail {
  return {
    case: {
      id: caseId,
      organization_id: resident,
      resident_id: resident,
      facility_id: facility,
      admission_case_id: null,
      program: "smmc_ltc",
      status: "open",
      revision: 1,
      next_action: null,
      assigned_to: null,
      due_date: null,
      closure_reason: null,
      screening: {},
      funding: {},
      created_at: "2026-09-21T12:00:00Z",
      updated_at: "2026-09-21T12:00:00Z",
      created_by: resident,
      resident_name: "Test Resident",
      facility_name: "Test Facility",
      assignee_name: null,
    },
    permissions: {
      can_write: true,
      can_review: true,
      can_manage_access: false,
    },
    requirements: [],
    documents: [],
    submissions: [],
    receipts: [],
    events: [],
    history: [],
  };
}
function installFetch(snapshot = detail(), conflict = false) {
  const fetch = vi
    .fn()
    .mockImplementation((url: string) => {
      if (url.includes("/options"))
        return Promise.resolve(
          new Response(
            JSON.stringify({
              facilities: [],
              residents: [],
              assignees: [],
              can_manage_access: false,
            }),
          ),
        );
      if (url.endsWith("/commands"))
        return Promise.resolve(
          new Response(
            JSON.stringify(
              conflict
                ? { error: "Stale revision" }
                : { case_id: caseId, revision: 2 },
            ),
            { status: conflict ? 409 : 200 },
          ),
        );
      return Promise.resolve(new Response(JSON.stringify(snapshot)));
    });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
afterEach(() => vi.unstubAllGlobals());
describe("benefits case workspace", () => {
  it("saves partial screening with real zero separate from unknown and no eligibility transition", async () => {
    const fetch = installFetch();
    render(<BenefitsCaseWorkspace id={caseId} />);
    await screen.findByRole("heading", { name: "Financial screening" });
    fireEvent.change(screen.getByLabelText("Monthly income ($)"), {
      target: { value: "0" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save screening facts" }),
    );
    await waitFor(() =>
      expect(
        fetch.mock.calls.some(([url]) => String(url).endsWith("/commands")),
      ).toBe(true),
    );
    const call = fetch.mock.calls.find(([url]) =>
      String(url).endsWith("/commands"),
    );
    const body = JSON.parse(call![1].body);
    expect(benefitsCommandSchema.safeParse(body).success).toBe(true);
    expect(body.payload.screening.income_cents).toBe(0);
    expect(body.payload.screening.assets_cents).toBeNull();
    expect(body.payload.screening.married).toBe("unknown");
    expect(body.payload.status).toBeUndefined();
  });
  it("keeps a rejected case-update draft visible and tells staff to refresh", async () => {
    installFetch(detail(), true);
    render(<BenefitsCaseWorkspace id={caseId} />);
    await screen.findByRole("heading", { name: "Financial screening" });
    fireEvent.change(screen.getByLabelText("Screening notes and exceptions"), {
      target: { value: "Income evidence still pending" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save screening facts" }),
    );
    await screen.findByText(/This case changed while you were working/);
    expect(screen.getByLabelText("Screening notes and exceptions")).toHaveValue(
      "Income evidence still pending",
    );
    expect(screen.getByRole("button", { name: "Refresh case" })).toBeEnabled();
  });
  it("disables edits for read-only authority", async () => {
    const snapshot = detail();
    snapshot.permissions.can_write = false;
    installFetch(snapshot);
    render(<BenefitsCaseWorkspace id={caseId} />);
    await screen.findByRole("heading", { name: "Financial screening" });
    expect(
      screen.getByRole("button", { name: "Save screening facts" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Close case and retain history" }),
    ).toBeDisabled();
  });
});
