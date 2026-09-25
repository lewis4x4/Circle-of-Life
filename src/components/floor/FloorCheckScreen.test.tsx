import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { emptyObservationVocabCatalog, type ObservationVocabCatalog } from "@/lib/rounding/observation-chips";
import type { CompletionPayload } from "@/lib/rounding/types";

import type { FloorCheckData } from "./useFloorCheckData";

const OWNER = { userId: "user-1", sessionId: "session-1", organizationId: "org-1", facilityId: "facility-1" };

const mocks = vi.hoisted(() => ({
  data: null as unknown as FloorCheckData,
  save: vi.fn(),
  back: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ back: mocks.back, push: vi.fn() }) }));
vi.mock("./useFloorCheckData", () => ({
  useFloorCheckData: () => ({ state: { status: "success", data: mocks.data, refreshing: false }, reload: vi.fn() }),
}));
vi.mock("./FloorContext", () => ({
  useFloorSession: () => ({
    profile: { unlockId: "unlock-1", displayName: "Synthetic Aide" },
    facility: { organizationId: "org-1", facilityId: "facility-1" },
    timeZone: "America/New_York",
  }),
}));
vi.mock("@/lib/floor/retry-owner", () => ({ resolveFloorRetryOwner: () => Promise.resolve(OWNER) }));
vi.mock("@/lib/floor/check-submit", () => ({
  FloorOperatorError: class extends Error {},
  claimFloorCheck: vi.fn(),
  currentRetryOwner: vi.fn(),
  saveFloorCheck: mocks.save,
}));

import { FloorCheckScreen } from "./FloorCheckScreen";

const VOCAB: ObservationVocabCatalog = {
  ...emptyObservationVocabCatalog(),
  location: [{ code: "dining_room", label: "Dining Room" }, { code: "resident_room", label: "Resident Room" }],
  state: [{ code: "eating_meal", label: "Eating Meal/Snack" }, { code: "sleeping", label: "Sleeping" }],
  meal_intake: [{ code: "ate_well", label: "Ate well" }, { code: "ate_some", label: "Ate some" }],
  mood_state: [{ code: "pleasant", label: "Pleasant" }],
  med_response: [{ code: "took_meds", label: "Took meds" }],
};

function checkData(overrides: Partial<FloorCheckData> = {}): FloorCheckData {
  return {
    task: { id: "task-1", due_at: new Date(Date.now() + 30 * 60_000).toISOString(), derived_status: "upcoming" },
    residentId: "resident-1",
    residentName: "Synthetic Resident",
    room: "101",
    gender: null,
    vocab: VOCAB,
    roomKnown: true,
    vocabFailed: false,
    ...overrides,
  };
}

const press = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

describe("FloorCheckScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.data = checkData();
    mocks.save.mockResolvedValue({ status: "saved" });
  });

  it("asks where, what they are doing and for meals, mood and medications from the vocabulary", () => {
    render(<FloorCheckScreen taskId="task-1" />);
    expect(screen.getByRole("group", { name: /Where are they\?/ })).toBeTruthy();
    expect(screen.getByRole("group", { name: /What are they doing\?/ })).toBeTruthy();
    for (const heading of ["Meals", "Mood", "Medications"]) expect(screen.getByRole("group", { name: new RegExp(heading) })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Eating Meal/Snack" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Took meds" })).toBeTruthy();
    // Every existing field stays.
    expect(screen.getByRole("group", { name: /Did you help with/ })).toBeTruthy();
    expect(screen.getByRole("group", { name: /Anything wrong\?/ })).toBeTruthy();
    expect(screen.getByLabelText(/Why late\?/)).toBeTruthy();
  });

  it("will not save without a meal, mood or medication pick, and says so", async () => {
    render(<FloorCheckScreen taskId="task-1" />);
    press("Awake");
    press("Dining Room");
    press("Eating Meal/Snack");
    press("Save check");
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Pick at least one for meals, mood or medications."));
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("saves the chips, location and state with the flat answers", async () => {
    render(<FloorCheckScreen taskId="task-1" />);
    press("Awake");
    press("Dining Room");
    press("Eating Meal/Snack");
    press("Pleasant");
    press("Ate some");
    press("Offered fluids");
    press("Pain");
    press("Save check");
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    const input = mocks.save.mock.calls[0][0] as { taskId: string; draft: CompletionPayload; owner: typeof OWNER };
    expect(input.taskId).toBe("task-1");
    expect(input.owner).toEqual(OWNER);
    expect(input.draft).toMatchObject({
      captureSurface: "floor",
      quickStatus: "awake",
      residentLocation: "dining_room",
      residentState: "eating_meal",
      chipSelections: { meal_intake: ["ate_some"], mood_state: ["pleasant"] },
      hydrationOffered: true,
      painConcern: true,
    });
  });

  it("says the choices could not load rather than that none are set up", () => {
    mocks.data = checkData({ vocab: emptyObservationVocabCatalog(), vocabFailed: true });
    render(<FloorCheckScreen taskId="task-1" />);
    expect(screen.getByText("The places could not load.")).toBeTruthy();
    expect(screen.queryByText(/set up for this building/)).toBeNull();
  });
});
