import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ObservationPlanEditor } from "./ObservationPlanEditor";

const mockReplace = vi.fn();
const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
}));

vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: () => ({
    selectedFacilityId: "facility-1",
    availableFacilities: [{ id: "facility-1", name: "Oakridge ALF" }],
  }),
}));

const residentsSelectMock = vi.fn();
const residentsEqMock = vi.fn().mockReturnThis();
const residentsIsMock = vi.fn().mockReturnThis();
const residentsOrderMock = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: residentsSelectMock,
    }),
  }),
}));

vi.mock("@/components/ui/date-time-picker", () => ({
  DateTimePicker: ({ id, value, onValueChange }: { id: string; value: string; onValueChange: (value: string) => void }) => (
    <input
      aria-label={id}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    />
  ),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  residentsSelectMock.mockImplementation(() => ({
    eq: residentsEqMock,
    is: residentsIsMock,
    order: residentsOrderMock,
  }));
  residentsOrderMock.mockResolvedValue({
    data: [
      {
        id: "resident-1",
        first_name: "Jane",
        last_name: "Doe",
        preferred_name: null,
        status: "active",
        bed_id: null,
        acuity_level: null,
        acuity_score: 3,
        beds: null,
      },
    ],
    error: null,
  });
});

const sourcePlanResponse = {
  plans: [
    {
      id: "plan-source",
      resident_id: "resident-1",
      status: "active",
      source_type: "manual",
      effective_from: "2026-05-10T12:00:00.000Z",
      effective_to: null,
      rationale: "This rationale is intentionally long enough for validation.",
      resident_observation_plan_rules: [
        {
          id: "rule-1",
          interval_type: "fixed_minutes",
          interval_minutes: 60,
          shift: null,
          daypart_start: "07:00",
          daypart_end: "19:00",
          days_of_week: [0, 1, 2, 3, 4, 5, 6],
          grace_minutes: 15,
          required_fields_schema: {},
          escalation_policy_key: null,
          active: true,
          sort_order: 0,
        },
      ],
    },
  ],
};

describe("ObservationPlanEditor duplicate and edit payload ids", () => {
  it("loads residents with explicit bed FK and shows calm empty census copy", async () => {
    residentsOrderMock.mockResolvedValueOnce({
      data: [],
      error: null,
    });

    render(<ObservationPlanEditor title="Create observation plan" />);

    expect(await screen.findByText("No active residents at this facility")).toBeTruthy();
    expect(screen.queryByText("Could not load observation plan form. Confirm facility scope and retry.")).toBeNull();
    expect(residentsSelectMock).toHaveBeenCalledWith(
      expect.stringContaining("beds!residents_bed_id_fkey"),
    );
    expect(screen.getByText(/No active residents at Oakridge ALF right now\./)).toBeTruthy();
  });

  it("prefills Jessica discovery cadence for new COL plans", async () => {
    render(<ObservationPlanEditor title="Create observation plan" />);

    expect(await screen.findByText(/Starting from COL Discovery Rounds — Day \+ Night/)).toBeTruthy();
    expect(screen.getByDisplayValue("06:00")).toBeTruthy();
    expect(screen.getByDisplayValue("05:30")).toBeTruthy();
    expect(screen.getAllByLabelText(/Drag Rule/)).toHaveLength(7);
  });

  it("strips ids in duplicate mode payload", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/rounding/plans?")) {
        return new Response(JSON.stringify(sourcePlanResponse), { status: 200 });
      }
      if (url === "/api/rounding/plans" && init?.method === "POST") {
        return new Response(JSON.stringify({ planId: "new-plan" }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ObservationPlanEditor duplicatePlanId="plan-source" title="Duplicate" />);

    const effectiveFrom = await screen.findByLabelText("effective-from");

    fireEvent.change(effectiveFrom, {
      target: { value: "2026-05-20T09:15" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/rounding/plans",
        expect.objectContaining({ method: "POST" }),
      );
    });

    const postCall = fetchMock.mock.calls.find(([url, init]) => String(url) === "/api/rounding/plans" && init?.method === "POST");
    expect(postCall).toBeTruthy();
    const payload = JSON.parse(String(postCall?.[1]?.body ?? "{}"));

    expect(payload.id).toBeUndefined();
    expect(payload.rules).toHaveLength(1);
    expect(Object.prototype.hasOwnProperty.call(payload.rules[0], "id")).toBe(false);
  });

  it("keeps parent and child ids in edit mode payload", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/rounding/plans?")) {
        return new Response(JSON.stringify(sourcePlanResponse), { status: 200 });
      }
      if (url === "/api/rounding/plans" && init?.method === "POST") {
        return new Response(JSON.stringify({ planId: "plan-source" }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ObservationPlanEditor planId="plan-source" title="Edit" />);

    await screen.findByLabelText("effective-from");

    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/rounding/plans",
        expect.objectContaining({ method: "POST" }),
      );
    });

    const postCall = fetchMock.mock.calls.find(([url, init]) => String(url) === "/api/rounding/plans" && init?.method === "POST");
    expect(postCall).toBeTruthy();
    const payload = JSON.parse(String(postCall?.[1]?.body ?? "{}"));

    expect(payload.id).toBe("plan-source");
    expect(payload.rules[0].id).toBe("rule-1");
  });
});
