import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BenefitsQueue } from "./BenefitsQueue";
const mocks = vi.hoisted(() => ({
  facilityId: "11111111-1111-4111-8111-111111111111",
  push: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: (
    selector: (state: {
      selectedFacilityId: string;
      availableFacilities: Array<{ id: string; name: string }>;
    }) => unknown,
  ) =>
    selector({
      selectedFacilityId: mocks.facilityId,
      availableFacilities: [{ id: mocks.facilityId, name: "Anon Facility A" }],
    }),
}));
afterEach(() => vi.unstubAllGlobals());
describe("BenefitsQueue", () => {
  it("scopes the queue and resident selection to the selected facility and states verified empty", async () => {
    const fetch = vi
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              url.includes("/options")
                ? {
                    facilities: [],
                    residents: [],
                    assignees: [],
                    can_manage_access: false,
                  }
                : { cases: [], next_cursor: null },
            ),
            { status: 200 },
          ),
        ),
      );
    vi.stubGlobal("fetch", fetch);
    render(<BenefitsQueue />);
    expect(
      screen.getByText(/Showing Anon Facility A\./),
    ).toBeInTheDocument();
    expect(screen.queryByText(/selected facility/i)).not.toBeInTheDocument();
    await screen.findByText(
      "No benefits cases match this view. Start a case below for an authorized resident.",
    );
    await screen.findByRole("heading", { name: "Start a benefits case" });
    for (const call of fetch.mock.calls)
      if (!String(call[0]).includes("/rules"))
        expect(String(call[0])).toContain(`facility_id=${mocks.facilityId}`);
  });
  it("does not represent permission failure as no cases", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
        ),
    );
    render(<BenefitsQueue />);
    await waitFor(() =>
      expect(screen.getAllByRole("alert").length).toBeGreaterThan(0),
    );
    expect(
      screen.queryByText(/No benefits cases match/),
    ).not.toBeInTheDocument();
  });
});
