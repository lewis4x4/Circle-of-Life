import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/admin/api-auth", () => ({
  requireAdminApiActor: async () => ({
    actor: {
      id: "actor",
      organization_id: "org",
      admin: {
        from: () => {
          const query = {
            select: () => query,
            eq: () => query,
            is: () => query,
            maybeSingle: async () => ({ data: { facility_id: "facility", organization_id: "org" }, error: null }),
          };
          return query;
        },
        rpc: state.rpc,
      },
    },
  }),
  actorCanAccessFacility: async () => true,
}));
const logError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/observability/logger", () => ({ logError }));

import { POST } from "./route";

const trustedArrivalErrors = [
  "A cancelled or closed admission cannot confirm arrival",
  "Choose an actual arrival date, not a future date",
  "Complete financial, physician-order, bed and rate readiness first",
  "Current Form 1823 and verified evidence are required",
  "Complete resident date of birth and gender before confirming arrival",
  "The selected bed is reserved for another admission",
  "The selected bed is occupied by another resident",
  "The bed is unavailable for arrival",
  "An administrator must approve the current readiness before arrival",
  "You no longer have access to confirm this arrival",
  "The arrival time must fall on the arrival date",
];

describe("admission arrival error boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("logs but does not return unexpected RPC details", async () => {
    const sentinel = "relation public.beds violates constraint beds_one_resident_private";
    state.rpc.mockResolvedValue({ data: null, error: { message: sentinel } });

    const response = await POST(
      new Request("https://local.test/arrival", { method: "POST", body: JSON.stringify({ arrival_date: "2026-09-06" }) }) as never,
      { params: Promise.resolve({ id: "admission" }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload).toEqual({ error: "Arrival could not be confirmed. Review the admission and retry." });
    expect(JSON.stringify(payload)).not.toContain(sentinel);
    expect(logError).toHaveBeenCalledWith(
      "admin.workflows.admission.confirm-arrival",
      expect.objectContaining({ message: sentinel }),
      { action: "rpc", admissionCaseId: "admission", facilityId: "facility" },
    );
  });

  it.each(trustedArrivalErrors)("preserves the trusted arrival error: %s", async (errorMessage) => {
    state.rpc.mockResolvedValue({ data: null, error: { message: errorMessage } });

    const response = await POST(
      new Request("https://local.test/arrival", { method: "POST", body: JSON.stringify({ arrival_date: "2026-09-06" }) }) as never,
      { params: Promise.resolve({ id: "admission" }) },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: errorMessage });
  });

  it("dates the arrival with the Eastern time given and passes the late-entry reason (COL-750)", async () => {
    state.rpc.mockResolvedValue({ data: "resident", error: null });
    const response = await POST(
      new Request("https://local.test/arrival", {
        method: "POST",
        body: JSON.stringify({ arrival_date: "2026-09-06", arrival_time: "14:30", late_entry_reason: "Paper log" }),
      }) as never,
      { params: Promise.resolve({ id: "admission" }) },
    );
    expect(response.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith("confirm_admission_arrival_review", {
      p_case_id: "admission",
      p_actor_id: "actor",
      p_arrival_date: "2026-09-06",
      p_arrival_at: "2026-09-06T18:30:00.000Z",
      p_late_entry_reason: "Paper log",
    });
  });

  it("sends no time when none is given, so the database dates it", async () => {
    state.rpc.mockResolvedValue({ data: "resident", error: null });
    await POST(
      new Request("https://local.test/arrival", { method: "POST", body: JSON.stringify({ arrival_date: "2026-09-06" }) }) as never,
      { params: Promise.resolve({ id: "admission" }) },
    );
    expect(state.rpc.mock.calls[0][1]).toMatchObject({ p_arrival_at: null, p_late_entry_reason: null });
  });

  it("refuses a malformed time before calling the database", async () => {
    const response = await POST(
      new Request("https://local.test/arrival", { method: "POST", body: JSON.stringify({ arrival_date: "2026-09-06", arrival_time: "25:00" }) }) as never,
      { params: Promise.resolve({ id: "admission" }) },
    );
    expect(response.status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("shows the movement guard's own wording, which is written for staff", async () => {
    const message =
      "Only an owner or org admin can date a resident movement more than 3 day(s) back. Ask one to enter it, with the reason it is late.";
    state.rpc.mockResolvedValue({ data: null, error: { message } });
    const response = await POST(
      new Request("https://local.test/arrival", { method: "POST", body: JSON.stringify({ arrival_date: "2026-09-06", arrival_time: "09:00" }) }) as never,
      { params: Promise.resolve({ id: "admission" }) },
    );
    expect(await response.json()).toEqual({ error: message });
  });
});
