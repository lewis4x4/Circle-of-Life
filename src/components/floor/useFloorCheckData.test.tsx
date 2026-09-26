import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearFloorCache } from "@/lib/floor/memory-cache";
import { emptyObservationVocabCatalog } from "@/lib/rounding/observation-chips";

const SAVED = { ...emptyObservationVocabCatalog(), location: [{ code: "own_room", label: "Own room" }] };
const mocks = vi.hoisted(() => ({ fetchFloorCheckVocab: vi.fn(), readFloorVocab: vi.fn(), saveFloorVocab: vi.fn() }));
const TASK = { id: "task-1", due_at: "2026-09-25T20:00:00Z", derived_status: "upcoming", residents: { id: "r1", first_name: "Mary", last_name: "Brown" } };
vi.mock("@/lib/floor/floor-data", () => ({
  fetchFloorTasks: async () => [TASK],
  fetchFloorCensus: async () => [{ id: "r1", room: "8" }],
  fetchFloorCheckVocab: mocks.fetchFloorCheckVocab,
}));
vi.mock("@/lib/floor/vocab-store", () => ({ readFloorVocab: mocks.readFloorVocab, saveFloorVocab: mocks.saveFloorVocab }));
const supabase = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { gender: null } }) }) }) }) };
vi.mock("./FloorContext", () => ({ useFloorSession: () => ({ supabase, facility: { facilityId: "f1" } }) }));

import { useFloorCheckData } from "./useFloorCheckData";

beforeEach(() => {
  clearFloorCache();
  Object.values(mocks).forEach((fn) => fn.mockReset());
});

describe("useFloorCheckData check choices", () => {
  it("charts the first check after an unlock offline with the choices saved on the tablet", async () => {
    mocks.fetchFloorCheckVocab.mockRejectedValue(new TypeError("Failed to fetch"));
    mocks.readFloorVocab.mockResolvedValue(SAVED);
    const { result } = renderHook(() => useFloorCheckData("task-1"));
    await waitFor(() => expect(result.current.state.status).toBe("success"));
    const data = result.current.state.status === "success" ? result.current.state.data : null;
    expect(data?.vocabFailed).toBe(false);
    expect(data?.vocab.location).toEqual(SAVED.location);
    expect(mocks.readFloorVocab).toHaveBeenCalledWith("f1");
  });

  it("saves the choices it reads online for the next unlock", async () => {
    mocks.fetchFloorCheckVocab.mockResolvedValue(SAVED);
    const { result } = renderHook(() => useFloorCheckData("task-1"));
    await waitFor(() => expect(result.current.state.status).toBe("success"));
    expect(mocks.saveFloorVocab).toHaveBeenCalledWith("f1", SAVED);
  });

  it("still says the choices could not load when nothing is saved either", async () => {
    mocks.fetchFloorCheckVocab.mockRejectedValue(new TypeError("Failed to fetch"));
    mocks.readFloorVocab.mockResolvedValue(null);
    const { result } = renderHook(() => useFloorCheckData("task-1"));
    await waitFor(() => expect(result.current.state.status).toBe("success"));
    expect(result.current.state.status === "success" ? result.current.state.data?.vocabFailed : null).toBe(true);
  });
});
