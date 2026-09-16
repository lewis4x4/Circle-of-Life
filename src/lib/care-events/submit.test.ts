import { describe, expect, it } from "vitest";

import { initialReportState, reportReducer, type ReportState } from "./report-state";
import {
  buildSubmitPayload,
  describeSubmitFailure,
  isLikelyNetworkError,
  parseCareEventReceipt,
} from "./submit";

const RESIDENT = {
  id: "11111111-1111-4111-8111-111111111111",
  displayName: "Pat Brownell",
  firstName: "Pat",
  lastName: "Brownell",
  roomLabel: "Room 12",
};

function fallState(): ReportState {
  return [
    { type: "pick_resident", resident: RESIDENT } as const,
    { type: "pick_kind", kind: "fall" } as const,
    { type: "set_answer", key: "hurt", value: "a_little" } as const,
    { type: "set_answer", key: "head", value: "no" } as const,
    { type: "set_answer", key: "witnessed", value: "no" } as const,
    { type: "set_answer", key: "going_out", value: "no" } as const,
    { type: "set_location", code: "resident_room", label: "Resident Room" } as const,
    { type: "toggle_worried" } as const,
    { type: "toggle_earlier" } as const,
  ].reduce(reportReducer, initialReportState("22222222-2222-4222-8222-222222222222"));
}

describe("buildSubmitPayload", () => {
  it("builds the RPC payload with worried, location, offline flag, and an ISO occurred_at", () => {
    const now = new Date("2026-09-16T02:06:00.000Z");
    const payload = buildSubmitPayload(fallState(), { facilityId: "f-1", now, capturedOffline: true, note: "  " });
    expect(payload).toEqual({
      client_event_id: "22222222-2222-4222-8222-222222222222",
      facility_id: "f-1",
      resident_id: RESIDENT.id,
      kind: "fall",
      answers: { hurt: "a_little", head: "no", witnessed: "no", going_out: "no", worried: true },
      note: null,
      occurred_at: "2026-09-16T01:51:00.000Z",
      location_code: "resident_room",
      captured_offline: true,
    });
  });

  it("defaults captured_offline to false and resident_id to null for the building", () => {
    const state = [
      { type: "no_resident" } as const,
      { type: "pick_kind", kind: "environment" } as const,
      { type: "set_answer", key: "what", value: "power_out" } as const,
      { type: "set_answer", key: "danger", value: "no" } as const,
    ].reduce(reportReducer, initialReportState("22222222-2222-4222-8222-222222222222"));
    const payload = buildSubmitPayload(state, { facilityId: "f-1", note: "Lights out in the east hall" });
    expect(payload.resident_id).toBeNull();
    expect(payload.captured_offline).toBe(false);
    expect(payload.location_code).toBeNull();
    expect(payload.note).toBe("Lights out in the east hall");
    expect(payload.answers).toEqual({ what: "power_out", danger: "no", worried: false });
  });

  it("throws without a tile", () => {
    expect(() => buildSubmitPayload(initialReportState("x"), { facilityId: "f-1" })).toThrow();
  });
});

describe("isLikelyNetworkError", () => {
  it("classifies fetch failures as network errors", () => {
    expect(isLikelyNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isLikelyNetworkError(new TypeError("Load failed"))).toBe(true);
    expect(isLikelyNetworkError(new Error("NetworkError when attempting to fetch resource."))).toBe(true);
    expect(isLikelyNetworkError({ message: ["fetch", "failed"].join(" ") })).toBe(true);
  });

  it("never classifies a server rejection as a network error", () => {
    expect(isLikelyNetworkError({ message: "care_event: forbidden", code: "P0001" })).toBe(false);
    expect(isLikelyNetworkError({ message: "care_event: resident not at facility" })).toBe(false);
    expect(isLikelyNetworkError(new Error("permission denied for table care_events"))).toBe(false);
    expect(isLikelyNetworkError(null)).toBe(false);
    expect(isLikelyNetworkError("offline")).toBe(false);
  });
});

describe("parseCareEventReceipt", () => {
  it("accepts the RPC shape and drops malformed deliveries", () => {
    const receipt = parseCareEventReceipt({
      care_event_id: "33333333-3333-4333-8333-333333333333",
      level: "3",
      incident_number: "HOM-2026-0007",
      incident_id: "44444444-4444-4444-8444-444444444444",
      deliveries: [
        { target_name: "Kaye Sorensen", target_role: "Administrator or Assistant", channel: "push", status: "queued" },
        { channel: "fax", status: "queued" },
      ],
      next_check_at: null,
      replayed: true,
    });
    expect(receipt.level).toBe(3);
    expect(receipt.deliveries).toHaveLength(1);
    expect(receipt.replayed).toBe(true);
  });

  it("rejects a receipt without an id or level", () => {
    expect(() => parseCareEventReceipt(null)).toThrow();
    expect(() => parseCareEventReceipt({ care_event_id: "x" })).toThrow();
  });
});

describe("describeSubmitFailure", () => {
  it("maps server errors to operator copy without the raw message", () => {
    expect(describeSubmitFailure({ message: "care_event: forbidden" })).toMatch(/cannot send/);
    expect(describeSubmitFailure({ message: "care_event: resident required" })).toMatch(/Pick a resident/);
    expect(describeSubmitFailure({ message: "care_event: unknown kind" })).not.toMatch(/unknown kind/);
    expect(describeSubmitFailure(new Error("boom"))).toMatch(/not sent/);
  });
});
