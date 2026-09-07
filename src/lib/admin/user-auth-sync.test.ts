import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { drainUserAuthSyncJobs, processUserAuthSyncJob } from "./user-auth-sync";

const job = {
  id: "job", target_user_id: "target", organization_id: "org", desired_app_role: "nurse",
  desired_claim_version: 9, direction: "expansive", operation: "promote", should_ban: false,
  phase: "pending_auth", lease_token: "lease",
};
const rpc = vi.fn();
const updateUserById = vi.fn();
const admin = { rpc, auth: { admin: { updateUserById } } } as unknown as SupabaseClient<Database>;
beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockImplementation(async (name: string) => ({ data: name === "finalize_user_auth_sync_job"
    ? { ...job, phase: "finalized" } : job, error: null }));
  updateUserById.mockResolvedValue({ error: null });
});

describe("leased Auth synchronization", () => {
  it("validates authority before provider work and again before committing expansion", async () => {
    expect((await processUserAuthSyncJob(admin, "job"))?.phase).toBe("finalized");
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "claim_user_auth_sync_job", "validate_user_auth_sync_job", "request_user_auth_reconciliation", "validate_user_auth_sync_job",
      "mark_user_auth_sync_succeeded", "finalize_user_auth_sync_job",
    ]);
    expect(rpc.mock.invocationCallOrder[1]).toBeLessThan(updateUserById.mock.invocationCallOrder[0]);
    expect(updateUserById.mock.invocationCallOrder[0]).toBeLessThan(rpc.mock.invocationCallOrder[3]);
    expect(updateUserById).toHaveBeenCalledWith("target", { app_metadata: {
      app_role: "nurse", organization_id: "org", auth_claim_version: 9, haven_auth_sync_job_id: "job",
    } });
  });
  it("persists a bounded failure code and never finalizes when Auth fails", async () => {
    updateUserById.mockResolvedValue({ error: { message: "provider body with private identity" } });
    expect((await processUserAuthSyncJob(admin))?.phase).toBe("pending_auth");
    expect(rpc).toHaveBeenCalledWith("request_user_auth_reconciliation", { p_job_id: "job" });
    expect(rpc).toHaveBeenLastCalledWith("fail_user_auth_sync_job", {
      p_job_id: "job", p_lease_token: "lease", p_error_code: "auth_sync_failed",
    });
    expect(rpc.mock.calls.some(([name]) => name === "finalize_user_auth_sync_job")).toBe(false);
  });
  it("refuses stale retries before they call Auth", async () => {
    rpc.mockImplementation(async (name: string) => name === "validate_user_auth_sync_job"
      ? { data: null, error: { code: "40001" } } : { data: job, error: null });
    expect((await processUserAuthSyncJob(admin))?.phase).toBe("dead_letter");
    expect(updateUserById).not.toHaveBeenCalled();
  });
  it("does not finalize if the actor loses authority while Auth is in flight", async () => {
    let validations = 0;
    rpc.mockImplementation(async (name: string) => name === "validate_user_auth_sync_job" && ++validations === 2
      ? { data: null, error: { code: "42501" } } : { data: job, error: null });
    expect((await processUserAuthSyncJob(admin))?.phase).toBe("dead_letter");
    expect(updateUserById).toHaveBeenCalledOnce();
    expect(rpc.mock.calls.some(([name]) => name === "finalize_user_auth_sync_job")).toBe(false);
  });
  it("resumes an interrupted Auth-success receipt using the same idempotent desired update", async () => {
    rpc.mockResolvedValue({ data: { ...job, phase: "auth_succeeded" }, error: null });
    await processUserAuthSyncJob(admin);
    expect(updateUserById).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenLastCalledWith("finalize_user_auth_sync_job", { p_job_id: "job", p_lease_token: "lease" });
  });
  it("has no provider side effects without a claimed job", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await drainUserAuthSyncJobs(admin)).toEqual({ processed: 0, finalized: 0, retryRequired: 0 });
    expect(updateUserById).not.toHaveBeenCalled();
  });
  it("retirement bans sign-in without calling Auth deletion", async () => {
    rpc.mockResolvedValue({ data: { ...job, operation: "hard_delete", direction: "restrictive", should_ban: true }, error: null });
    await processUserAuthSyncJob(admin);
    expect(updateUserById).toHaveBeenCalledWith("target", expect.objectContaining({ ban_duration: "876000h" }));
  });
  it("preserves an independent ban during ordinary promotion metadata writes", async () => {
    await processUserAuthSyncJob(admin);
    const changes = updateUserById.mock.calls[0][1];
    expect(changes).not.toHaveProperty("ban_duration");
    expect(changes.app_metadata).not.toHaveProperty("haven_auth_ban_job_id");
  });
  it("unbans only a reconciliation explicitly proven to repair an obsolete own ban", async () => {
    rpc.mockResolvedValue({ data: { ...job, operation: "reconcile", direction: "restrictive", allow_unban: true }, error: null });
    await processUserAuthSyncJob(admin);
    expect(updateUserById).toHaveBeenCalledWith("target", expect.objectContaining({
      ban_duration: "0s", app_metadata: expect.objectContaining({ haven_auth_ban_job_id: "job", haven_auth_ban_version: 9 }),
    }));
  });

});
