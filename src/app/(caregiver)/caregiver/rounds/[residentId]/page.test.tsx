import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompletionPayload } from "@/lib/rounding/types";

const mocks = vi.hoisted(() => ({
  queue: vi.fn(), residentId: "resident", taskId: "task", facilityId: "facility", organizationId: "org",
  userId: "operator", sessionId: "", authListener: undefined as undefined | ((event: string) => void),
  client: { rpc: vi.fn(), auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } },
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ residentId: mocks.residentId }), useSearchParams: () => new URLSearchParams(`taskId=${mocks.taskId}`) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => mocks.client, isBrowserSupabaseConfigured: () => true }));
vi.mock("@/lib/caregiver/facility-context", () => ({ loadCaregiverFacilityContext: async () => ({ ok: true, ctx: { organizationId: mocks.organizationId, facilityId: mocks.facilityId, facilityName: "Synthetic" } }) }));
vi.mock("@/hooks/useRoundingOfflineSync", () => ({ useRoundingOfflineSync: () => ({ queuedTaskIdSet: new Set() }) }));
vi.mock("@/lib/pwa/rounding-sync", () => ({ queueRoundingCompletion: mocks.queue, shouldQueueRoundingRequest: (e: unknown) => e instanceof TypeError }));
import Page from "./page";

beforeEach(() => {
  mocks.residentId = "resident"; mocks.taskId = "task"; mocks.facilityId = "facility"; mocks.organizationId = "org";
  mocks.userId = "operator"; mocks.sessionId = crypto.randomUUID();
  mocks.queue.mockReset().mockResolvedValue({});
  mocks.client.rpc.mockReset().mockImplementation(async () => ({ data: { user_id: mocks.userId, session_id: mocks.sessionId, organization_id: mocks.organizationId } }));
  mocks.client.auth.getSession.mockReset().mockImplementation(async () => ({ data: { session: {
    user: { id: mocks.userId }, access_token: `header.${btoa(JSON.stringify({ session_id: mocks.sessionId }))}.signature`,
  } } }));
  mocks.client.auth.onAuthStateChange.mockImplementation((callback) => {
    mocks.authListener = callback;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  });
  vi.stubGlobal("navigator", { onLine: true });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function response(body: object, status = 200) { return new Response(JSON.stringify(body), { status }); }
function installFetch(complete: (url: string, init?: RequestInit) => unknown) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/complete")) return complete(url, init);
    if (url.includes("vocabulary")) return response({});
    return response({ tasks: [{ id: mocks.taskId, due_at: "2026-09-07T12:00:00Z", derived_status: "due_now", residents: { id: mocks.residentId, first_name: "Synthetic", last_name: "Resident" } }] });
  }));
}
async function fillAndSubmit() {
  fireEvent.click(await screen.findByRole("radio", { name: "Distressed" }));
  fireEvent.change(screen.getByPlaceholderText("Add exception or intervention details when needed"), { target: { value: "Original distressed observation" } });
  fireEvent.click(screen.getByRole("button", { name: "Complete round" }));
}
function submitted(complete: ReturnType<typeof vi.fn>, index = 0): CompletionPayload { return JSON.parse(complete.mock.calls[index][1].body); }

describe("caregiver completion delivery with the real observation form", () => {
  it.each(["server failure", "failed outbox preservation"])("freezes and replays every clinical field after %s", async (failure) => {
    const complete = vi.fn().mockImplementation(() => failure === "server failure"
      ? Promise.resolve(response({ error: "Save failed" }, 500)) : Promise.reject(new TypeError("Failed to fetch")));
    mocks.queue.mockRejectedValue(new Error("Outbox unavailable; keep draft open"));
    installFetch(complete); render(<Page />); await fillAndSubmit();
    await screen.findByText(failure === "server failure" ? "Save failed" : "Outbox unavailable; keep draft open");
    expect(screen.getByRole("radio", { name: "Awake" })).toBeDisabled();
    expect(screen.getByPlaceholderText("Add exception or intervention details when needed")).toBeDisabled();
    expect(screen.getByPlaceholderText("Required only for late entries")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Record" })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "Awake" }));
    fireEvent.change(screen.getByPlaceholderText("Add exception or intervention details when needed"), { target: { value: "Changed clinical observation" } });
    fireEvent.click(screen.getByRole("button", { name: "Complete round" }));
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(2));
    expect(submitted(complete, 1)).toEqual(submitted(complete));
    expect(submitted(complete)).toMatchObject({ quickStatus: "distressed", note: "Original distressed observation", retryOwner: { userId: "operator", sessionId: mocks.sessionId, organizationId: "org", facilityId: "facility" } });
    if (failure !== "server failure") await waitFor(() => expect(mocks.queue).toHaveBeenCalledTimes(2));
  });

  it.each([400, 500])("allows a delayed reason amendment only on explicit unsaved 400 (status %s)", async (status) => {
    const complete = vi.fn().mockImplementationOnce(async () => response({ error: "Add delayed reason", reasonRequired: true }, status))
      .mockImplementation(async () => response({ error: "Save failed" }, 500));
    installFetch(complete); render(<Page />); await fillAndSubmit(); await screen.findByText("Add delayed reason");
    const reason = screen.getByPlaceholderText("Required only for late entries");
    if (status === 400) expect(reason).toBeEnabled(); else expect(reason).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Awake" })).toBeDisabled();
    fireEvent.change(reason, { target: { value: "Emergency assistance delayed entry" } });
    fireEvent.click(screen.getByRole("button", { name: "Complete round" }));
    await screen.findByText("Save failed");
    expect(submitted(complete, 1)).toEqual({ ...submitted(complete), lateReason: status === 400 ? "Emergency assistance delayed entry" : null });
    expect(reason).toBeDisabled();
  });

  it("queues precisely the original online request and owner after a lost response", async () => {
    const complete = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    installFetch(complete); render(<Page />); await fillAndSubmit();
    await screen.findByText(/Connection lost. Round queued/);
    expect(mocks.queue).toHaveBeenCalledWith("task", "resident", submitted(complete), { ownerUserId: "operator", organizationId: "org", facilityId: "facility" });
    expect(screen.queryByRole("button", { name: "Complete round" })).not.toBeInTheDocument();
  });

  it("queues an offline observation using the captured session without a network authority call", async () => {
    const complete = vi.fn(); installFetch(complete); render(<Page />);
    await screen.findByRole("button", { name: "Complete round" });
    mocks.client.rpc.mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("navigator", { onLine: false });
    await fillAndSubmit(); await screen.findByText(/Round queued for sync/);
    expect(complete).not.toHaveBeenCalled();
    expect(mocks.queue.mock.calls[0][2].retryOwner.sessionId).toBe(mocks.sessionId);
  });

  it("retains a genuine conflict for reconciliation and suppresses another observation", async () => {
    const complete = vi.fn().mockImplementation(async () => response({ error: "Conflict" }, 409));
    installFetch(complete); render(<Page />); await fillAndSubmit();
    await screen.findByText(/retained in the Outbox/);
    expect(mocks.queue).toHaveBeenCalledWith("task", "resident", submitted(complete), expect.any(Object));
    expect(screen.queryByRole("button", { name: "Complete round" })).not.toBeInTheDocument();
  });

  it("restores the original observation across route changes and unmounts", async () => {
    const complete = vi.fn().mockImplementation(async () => response({ error: "Save failed" }, 500));
    installFetch(complete); const view = render(<Page />); await fillAndSubmit(); await screen.findByText("Save failed");
    mocks.taskId = "other-task"; mocks.residentId = "other-resident"; view.rerender(<Page />);
    expect(await screen.findByRole("radio", { name: "Awake" })).toBeEnabled();
    view.unmount(); mocks.taskId = "task"; mocks.residentId = "resident"; render(<Page />);
    expect(await screen.findByRole("radio", { name: "Distressed" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByPlaceholderText("Add exception or intervention details when needed")).toHaveValue("Original distressed observation");
    fireEvent.click(screen.getByRole("button", { name: "Complete round" }));
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(2)); expect(submitted(complete, 1)).toEqual(submitted(complete));
  });

  it.each(["user", "session", "organization", "facility"])("does not adopt retained clinical data into another %s", async (scope) => {
    const complete = vi.fn().mockImplementation(async () => response({ error: "Save failed" }, 500));
    installFetch(complete); const view = render(<Page />); await fillAndSubmit(); await screen.findByText("Save failed");
    const original = { userId: mocks.userId, sessionId: mocks.sessionId, organizationId: mocks.organizationId, facilityId: mocks.facilityId };
    if (scope === "user") mocks.userId = "other-operator";
    if (scope === "session") mocks.sessionId = "other-session";
    if (scope === "organization") mocks.organizationId = "other-org";
    if (scope === "facility") mocks.facilityId = "other-facility";
    await act(async () => mocks.authListener?.("SIGNED_IN"));
    expect(await screen.findByRole("radio", { name: "Awake" })).toBeEnabled();
    expect(screen.queryByDisplayValue("Original distressed observation")).not.toBeInTheDocument();
    Object.assign(mocks, original); view.unmount(); render(<Page />);
    expect(await screen.findByRole("radio", { name: "Distressed" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Complete round" }));
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(2)); expect(submitted(complete, 1)).toEqual(submitted(complete));
  });

  it("rejects a silent session switch before retry and before fallback queuing", async () => {
    const complete = vi.fn().mockImplementation(async () => response({ error: "Save failed" }, 500));
    installFetch(complete); render(<Page />); await fillAndSubmit(); await screen.findByText("Save failed");
    mocks.sessionId = "changed-session";
    fireEvent.click(screen.getByRole("button", { name: "Complete round" }));
    await screen.findByText(/account or session changed/);
    expect(complete).toHaveBeenCalledOnce(); expect(mocks.queue).not.toHaveBeenCalled();
  });

  it("keeps an incomplete success acknowledgment pending and consumes a confirmed acknowledgment across remount", async () => {
    const complete = vi.fn().mockImplementationOnce(async () => response({}))
      .mockImplementation(async () => response({ ok: true }));
    installFetch(complete); const view = render(<Page />); await fillAndSubmit();
    await screen.findByText(/Save acknowledgment was incomplete/);
    fireEvent.click(screen.getByRole("button", { name: "Complete round" }));
    await screen.findByText("Round saved successfully.");
    expect(submitted(complete, 1)).toEqual(submitted(complete));
    view.unmount(); render(<Page />); await screen.findByText("Round saved successfully.");
    expect(screen.queryByRole("button", { name: "Complete round" })).not.toBeInTheDocument();
    expect(complete).toHaveBeenCalledTimes(2);
  });
  it("does not send or queue under a replacement session after a lost in-flight response", async () => {
    let rejectSave!: (error: Error) => void;
    const complete = vi.fn().mockImplementation(() => new Promise((_resolve, reject) => { rejectSave = reject; }));
    installFetch(complete); render(<Page />); await fillAndSubmit();
    await waitFor(() => expect(complete).toHaveBeenCalledOnce());
    mocks.sessionId = "replacement-session";
    await act(async () => rejectSave(new TypeError("Failed to fetch")));
    await screen.findByText(/account or session changed/);
    expect(mocks.queue).not.toHaveBeenCalled();
  });

  it("applies an in-flight acknowledgment only to its original task after navigation", async () => {
    let finishSave!: (value: Response) => void;
    const complete = vi.fn().mockImplementation(() => new Promise((resolve) => { finishSave = resolve; }));
    installFetch(complete); const view = render(<Page />); await fillAndSubmit();
    await waitFor(() => expect(complete).toHaveBeenCalledOnce());
    mocks.taskId = "next-task"; mocks.residentId = "next-resident"; view.rerender(<Page />);
    expect(await screen.findByRole("radio", { name: "Awake" })).toBeEnabled();
    await act(async () => finishSave(response({ ok: true })));
    expect(screen.queryByText("Round saved successfully.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Complete round" })).toBeEnabled();
    mocks.taskId = "task"; mocks.residentId = "resident"; view.rerender(<Page />);
    await screen.findByText("Round saved successfully.");
    expect(screen.queryByRole("button", { name: "Complete round" })).not.toBeInTheDocument();
  });

});
