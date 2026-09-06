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
});
