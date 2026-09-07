import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompletionPayload } from "@/lib/rounding/types";

const mocks = vi.hoisted(() => ({ queue: vi.fn(), client: { auth: { getUser: vi.fn() } } }));
vi.mock("next/navigation", () => ({ useParams: () => ({ residentId: "resident" }), useSearchParams: () => new URLSearchParams("taskId=task") }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => mocks.client, isBrowserSupabaseConfigured: () => true }));
vi.mock("@/lib/caregiver/facility-context", () => ({ loadCaregiverFacilityContext: async () => ({ ok: true, ctx: { organizationId: "org", facilityId: "facility", facilityName: "Synthetic" } }) }));
vi.mock("@/hooks/useRoundingOfflineSync", () => ({ useRoundingOfflineSync: () => ({ queuedTaskIdSet: new Set() }) }));
vi.mock("@/lib/pwa/rounding-sync", () => ({ queueRoundingCompletion: mocks.queue, shouldQueueRoundingRequest: (e: unknown) => e instanceof TypeError }));
vi.mock("@/components/rounding/QuickObservationForm", () => ({ QuickObservationForm: ({ onSubmit }: { onSubmit: (p: CompletionPayload) => void }) => <button onClick={() => onSubmit({ quickStatus: "awake", note: "Synthetic observation" })}>Save synthetic round</button> }));
import Page from "./page";

beforeEach(() => {
  mocks.queue.mockReset().mockResolvedValue({});
  mocks.client.auth.getUser.mockResolvedValue({ data: { user: { id: "operator" } } });
  vi.stubGlobal("navigator", { onLine: true });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function installFetch(complete: ReturnType<typeof vi.fn>) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/complete")) return complete(url, init);
    return new Response(JSON.stringify({ tasks: [{ id: "task", due_at: "2026-09-07T12:00:00Z", derived_status: "due_now", residents: { id: "resident", first_name: "Synthetic", last_name: "Resident" } }] }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
describe("caregiver completion delivery", () => {
  it("queues precisely the original online request after a lost response", async () => {
    const complete = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    installFetch(complete);
    render(<Page />);
    fireEvent.click(await screen.findByRole("button", { name: "Save synthetic round" }));
    await waitFor(() => expect(mocks.queue).toHaveBeenCalledOnce());
    const submitted = JSON.parse(complete.mock.calls[0][1].body);
    expect(submitted.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isNaN(Date.parse(submitted.observedAt))).toBe(false);
    expect(mocks.queue).toHaveBeenCalledWith("task", "resident", submitted, { ownerUserId: "operator", organizationId: "org", facilityId: "facility" });
  });
  it("keeps retry identity and time after an unacknowledged server failure", async () => {
    const complete = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ error: "Save failed" }), { status: 500 })));
    installFetch(complete);
    render(<Page />);
    fireEvent.click(await screen.findByRole("button", { name: "Save synthetic round" }));
    await screen.findByText("Save failed");
    fireEvent.click(screen.getByRole("button", { name: "Save synthetic round" }));
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(2));
    expect(JSON.parse(complete.mock.calls[1][1].body)).toEqual(JSON.parse(complete.mock.calls[0][1].body));
    expect(mocks.queue).not.toHaveBeenCalled();
  });
  it("retains a genuine conflict for reconciliation", async () => {
    const complete = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Conflict" }), { status: 409 }));
    installFetch(complete);
    render(<Page />);
    fireEvent.click(await screen.findByRole("button", { name: "Save synthetic round" }));
    await screen.findByText(/retained in the Outbox/);
    expect(mocks.queue).toHaveBeenCalledWith("task", "resident", JSON.parse(complete.mock.calls[0][1].body), expect.any(Object));
  });
});
