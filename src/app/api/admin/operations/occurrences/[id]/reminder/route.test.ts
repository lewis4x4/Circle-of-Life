import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/operations/auth", () => ({
  requireOperationsActor: vi.fn(),
  revalidateOperationsActor: vi.fn(),
}));
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn() }));

import { requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";
import { POST } from "./route";

const taskId = "11111111-1111-4111-8111-111111111111";
const revision = "22222222-2222-4222-8222-222222222222";
const rpc = vi.fn();
const actor = { id: "current-user", currentActor: { client: { rpc } } };
const reminder = {
  id: taskId, issue_id: null, source_label: "Generator check", state: "active", phase: "due", problem: null,
  revision, generation: 1, acknowledged_at: null, snoozed_until: null,
  can_respond: true, suppressed: false, channel: "in_app", delivery_status: "sent", replayed: false,
};
const run = (body: unknown, id = taskId) => POST(
  new Request("https://local.test/reminder", { method: "POST", body: JSON.stringify(body) }),
  { params: Promise.resolve({ id }) },
);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireOperationsActor).mockResolvedValue({ actor } as never);
  vi.mocked(revalidateOperationsActor).mockResolvedValue({ actor } as never);
  rpc.mockResolvedValue({ data: null, error: null });
});

describe("reminder commands at the session boundary", () => {
  it("rejects an invalid occurrence before accessing the database", async () => {
    expect((await run({ command: "refresh" }, "invalid")).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("honors denied and expired sessions before issuing a command", async () => {
    vi.mocked(requireOperationsActor).mockResolvedValueOnce({ response: new Response(null, { status: 401 }) } as never);
    expect((await run({ command: "refresh" })).status).toBe(401);
    vi.mocked(revalidateOperationsActor).mockResolvedValueOnce({ response: new Response(null, { status: 403 }) } as never);
    expect((await run({ command: "refresh" })).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    { command: "refresh", actor_id: "injected" },
    { command: "refresh", recipient_id: taskId },
    { command: "refresh", channel: "email" },
    { command: "complete", expected_revision: revision, request_key: "request-001" },
    { command: "snooze", expected_revision: revision, request_key: "request-001", until: "tomorrow" },
  ])("rejects authority/channel injection or invalid commands: %j", async (body) => {
    expect((await run(body)).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes the exact retry key and revision to the authenticated RPC", async () => {
    await run({ command: "acknowledge", expected_revision: revision, request_key: "stable-request-001" });
    expect(rpc).toHaveBeenCalledWith("operation_reminder_review", expect.objectContaining({
      p_task: taskId, p_command: "acknowledge", p_expected_revision: revision,
      p_request_key: "stable-request-001", p_until: null,
    }));
  });

  it.each([["42501", 403], ["40001", 409], ["22023", 400], ["XX000", 503]])(
    "maps %s without disclosing database details", async (code, status) => {
      rpc.mockResolvedValueOnce({ data: null, error: { code, message: "private subject and SQL detail" } });
      const response = await run({ command: "refresh" });
      expect(response.status).toBe(status);
      expect(await response.text()).not.toContain("private subject");
    },
  );

  it("does not present a malformed successful RPC as a confirmed reminder", async () => {
    rpc.mockResolvedValueOnce({ data: { state: "active", channel: "email" }, error: null });
    expect((await run({ command: "refresh" })).status).toBe(503);
  });

  it("returns only the validated reminder after both session checks", async () => {
    rpc.mockResolvedValueOnce({ data: { ...reminder, internal_subject: "private" }, error: null });
    const response = await run({ command: "refresh" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reminder });
    expect(revalidateOperationsActor).toHaveBeenCalledTimes(2);
  });

  it("withholds a successful RPC result if the session expires during the command", async () => {
    rpc.mockResolvedValueOnce({ data: reminder, error: null });
    vi.mocked(revalidateOperationsActor)
      .mockResolvedValueOnce({ actor } as never)
      .mockResolvedValueOnce({ response: new Response(null, { status: 401 }) } as never);
    const response = await run({ command: "refresh" });
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("");
  });

  it("passes the selected issue identity without allowing a substituted recipient", async () => {
    rpc.mockResolvedValueOnce({ data: { ...reminder, issue_id: revision }, error: null });
    expect((await run({ command: "refresh", issue_id: revision })).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("operation_reminder_review", expect.objectContaining({
      p_task: taskId, p_issue: revision, p_command: "refresh",
    }));
  });
});
