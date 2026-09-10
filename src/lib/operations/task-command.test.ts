import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
vi.mock("@/lib/operations/auth", () => ({ requireOperationsActor: vi.fn(), revalidateOperationsActor: vi.fn() }));
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn() }));
import { requireOperationsActor, revalidateOperationsActor } from "./auth";
import { runOperationTaskCommand } from "./task-command";
const rpc = vi.fn();
const adminRpc = vi.fn(() => { throw new Error("Service RPC forbidden"); });
const actor = { id: "actor", currentActor: { client: { rpc }, admin: { rpc: adminRpc } } };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOperationsActor).mockResolvedValue({ actor } as never);
  vi.mocked(revalidateOperationsActor).mockResolvedValue({ actor } as never);
});
describe("operations locked task commands", () => {
  it("reports manual escalation as unavailable before any database lock or command", async () => {
    const response = await runOperationTaskCommand("task", "escalate", { reason: "manual" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Manual escalation requires a scoped command and is not available yet" });
    expect(revalidateOperationsActor).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each(["start", "reinstate"] as const)("delegates %s to a single authenticated atomic command", async (action) => {
    rpc.mockResolvedValue({ data: { success: true }, error: null });
    expect((await runOperationTaskCommand("task", action)).status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("haven_operation_task_command", { p_task_id: "task", p_action: action, p_payload: {} });
    expect(adminRpc).not.toHaveBeenCalled();
  });
  it("does not call or replay a task command after reauthentication fails", async () => {
    vi.mocked(revalidateOperationsActor).mockResolvedValue({ response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) });
    expect((await runOperationTaskCommand("task", "start")).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("reports denied authority after a database wait without exposing schema details", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "private subject rejected" } });
    const response = await runOperationTaskCommand("task", "reinstate");
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Task unavailable" });
  });
  it.each([null, {}, []])("does not manufacture successful state from an unconfirmed receipt: %j", async (data) => {
    rpc.mockResolvedValue({ data, error: null });
    expect((await runOperationTaskCommand("task", "start")).status).toBe(500);
  });
});
