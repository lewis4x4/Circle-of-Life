import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  COL_DISCOVERY_FACILITY_NAMES,
  isLegacyMigration219HourlyWindow,
} from "@/lib/rounding/col-discovery-round-cadence";
import { validatePlanRule } from "@/lib/rounding/observation-plan-validation";

import { ObservationPlanEditor } from "./ObservationPlanEditor";

const mockReplace = vi.fn();
const mockPush = vi.fn();

const facilityStoreState = {
  selectedFacilityId: "facility-1",
  availableFacilities: [{ id: "facility-1", name: "Oakridge ALF" }],
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
}));

vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: () => facilityStoreState,
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
  facilityStoreState.selectedFacilityId = "facility-1";
  facilityStoreState.availableFacilities = [{ id: "facility-1", name: "Oakridge ALF" }];

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

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/rounding/plans/templates")) {
        return new Response(
          JSON.stringify({
            templates: [
              {
                id: "template-discovery",
                name: "COL Discovery Rounds — Day + Night",
                description: "Jessica cadence",
                cadenceProfile: "standard_day_night",
                rules: [
                  {
                    intervalType: "daypart",
                    intervalMinutes: null,
                    shift: "day",
                    daypartStart: "06:00",
                    daypartEnd: "06:05",
                    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
                    graceMinutes: 30,
                    requiredFieldsSchema: { scheduled_time: "06:00", shift: "day" },
                    escalationPolicyKey: "resident-assurance-standard",
                    sortOrder: 0,
                    active: true,
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    }),
  );
});

const sourcePlanResponse = {
  plans: [
    {
      id: "plan-source",
      resident_id: "resident-1",
      status: "active",
      source_type: "manual",
      effective_from: "2026-08-20T22:00:00.000Z",
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

    expect(await screen.findByText("Facility cadence template")).toBeTruthy();
    expect(screen.getByDisplayValue("06:00")).toBeTruthy();
    expect(screen.getByText("COL Discovery Rounds — Day + Night")).toBeTruthy();
    expect(
      screen.getByText(/Add rule copies the last check so you can change the time\. Haven will not invent a 7am–7pm hourly cadence\./),
    ).toBeTruthy();
  });

  it("Add rule on Jessica plans copies the last rule instead of inventing hourly 7am–7pm", async () => {
    render(<ObservationPlanEditor title="Create observation plan" />);

    await screen.findByDisplayValue("06:00");

    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));

    const daypartStarts = screen.getAllByLabelText(/Daypart start/i).map((input) => (input as HTMLInputElement).value);
    const daypartEnds = screen.getAllByLabelText(/Daypart end/i).map((input) => (input as HTMLInputElement).value);
    const intervalInputs = screen.getAllByLabelText(/Interval minutes/i).map((input) => (input as HTMLInputElement).value);

    expect(daypartStarts).not.toContain("07:00");
    expect(daypartEnds).not.toContain("19:00");
    expect(intervalInputs.filter((value) => value === "60")).toHaveLength(0);
    expect(daypartStarts.filter((value) => value === "06:00").length).toBeGreaterThanOrEqual(2);
  });

  it("starts Plantation plans with no rules and Add rule does not invent hourly 7am–7pm", async () => {
    facilityStoreState.selectedFacilityId = "facility-5";
    facilityStoreState.availableFacilities = [{ id: "facility-5", name: COL_DISCOVERY_FACILITY_NAMES.plantation }];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/rounding/plans/templates")) {
          return new Response(JSON.stringify({ templates: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
      }),
    );

    render(<ObservationPlanEditor title="Create observation plan" />);

    expect(await screen.findByText("No cadence rules yet")).toBeTruthy();
    expect(
      screen.getByText(/Haven will not invent a 7am–7pm hourly cadence or pre-fill times\. Add each check manually\./),
    ).toBeTruthy();
    expect(screen.queryByLabelText(/Daypart start/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));

    const daypartStart = screen.getByLabelText(/Daypart start/i) as HTMLInputElement;
    const daypartEnd = screen.getByLabelText(/Daypart end/i) as HTMLInputElement;
    const intervalMinutes = screen.getByLabelText(/Interval minutes/i) as HTMLInputElement;

    expect(daypartStart.value).toBe("");
    expect(daypartEnd.value).toBe("");
    expect(intervalMinutes.value).toBe("");
    expect(isLegacyMigration219HourlyWindow({
      intervalType: "daypart",
      intervalMinutes: intervalMinutes.value ? Number(intervalMinutes.value) : null,
      daypartStart: daypartStart.value || null,
      daypartEnd: daypartEnd.value || null,
      active: true,
      sortOrder: 0,
    })).toBe(false);
  });

  it("shows honest empty copy for unknown facilities without inventing defaults", async () => {
    facilityStoreState.selectedFacilityId = "facility-unknown";
    facilityStoreState.availableFacilities = [{ id: "facility-unknown", name: "Unknown Site" }];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/rounding/plans/templates")) {
          return new Response(JSON.stringify({ templates: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
      }),
    );

    render(<ObservationPlanEditor title="Create observation plan" />);

    expect(await screen.findByText("No cadence rules yet")).toBeTruthy();
    expect(
      screen.getByText(/not on the COL Jessica discovery-round schedule\. Add checks manually — Haven will not invent a 7am–7pm hourly window or pre-fill times\./),
    ).toBeTruthy();
    expect(
      screen.getByText(/Haven will not invent a 7am–7pm hourly cadence or pre-fill times\. Add each check manually\./),
    ).toBeTruthy();
  });

  it("still rejects legacy migration 219 12-hour interval defaults", () => {
    expect(
      validatePlanRule({
        intervalType: "fixed_minutes",
        intervalMinutes: 720,
        daypartStart: "07:00",
        daypartEnd: "19:00",
        graceMinutes: 15,
        active: true,
        sortOrder: 0,
      }).intervalMinutes,
    ).toBe("12-hour (720 minute) facility defaults are retired. Use Jessica discovery-round cadence instead.");
  });

  it("disables apply-discovery-default until a resident is selected", async () => {
    render(<ObservationPlanEditor title="Create observation plan" />);

    const applyButton = await screen.findByRole("button", { name: "Apply discovery default for resident" });
    expect(applyButton).toBeDisabled();
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

    const effectiveFrom = await screen.findByLabelText("effective-from");

    expect(effectiveFrom).toHaveValue("2026-08-20T18:00");
    expect(screen.getByText("Effective from, Eastern (ET)")).toBeTruthy();
    expect(screen.getByText("Effective to, Eastern (ET)")).toBeTruthy();

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
    expect(payload.effectiveFrom).toBe("2026-08-20T22:00:00.000Z");
    expect(payload.rules[0].id).toBe("rule-1");
  });
});
