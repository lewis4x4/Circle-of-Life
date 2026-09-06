import { describe, expect, it, vi } from "vitest";
import { appendShiftNote, recordVitals, parseVitalMeasurements } from "./clinical-writes";

describe("caregiver clinical writes", () => {
  it("omits untouched values instead of clearing prior observations", () => {
    expect(parseVitalMeasurements({ temperature: "", blood_pressure_systolic: "", blood_pressure_diastolic: "", pulse: "75" })).toEqual({ pulse: 75 });
  });
  it("rejects malformed and empty measurements", () => {
    expect(() => parseVitalMeasurements({ pulse: "75x" })).toThrow();
    expect(() => parseVitalMeasurements({ pulse: "" })).toThrow();
    expect(() => parseVitalMeasurements({ pulse: "75.3" })).toThrow();
  });
  it("uses a single atomic note operation and surfaces write errors", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "log-id", error: null });
    await expect(appendShiftNote({ rpc } as never, "resident-id", "Note A")).resolves.toBe("log-id");
    expect(rpc).toHaveBeenCalledWith("append_caregiver_shift_note", { p_resident_id: "resident-id", p_note: "Note A" });
    rpc.mockResolvedValue({ data: null, error: new Error("not saved") });
    await expect(appendShiftNote({ rpc } as never, "resident-id", "Note B")).rejects.toThrow("not saved");
  });
  it("retains the observation timestamp at the persistence boundary", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "log-id", error: null });
    await recordVitals({ rpc } as never, "resident-id", { pulse: 75 }, "2026-09-06T14:00:00Z");
    expect(rpc).toHaveBeenCalledWith("record_caregiver_vitals", { p_resident_id: "resident-id", p_measurements: { pulse: 75 }, p_observed_at: "2026-09-06T14:00:00Z" });
  });
});
