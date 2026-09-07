import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
const currentActor = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: currentActor }) }));
import { commitRestrictiveUserAccess } from "./user-access-lifecycle";

const rpc = vi.fn();
const admin = { rpc } as unknown as SupabaseClient<Database>;
const command = { targetUserId: "target", actingUserId: "actor", organizationId: "org",
  operation: "demote" as const, desiredRole: "caregiver" as const, requestKey: "original-receipt" };
const receipt = { id: "job", target_user_id: "target", organization_id: "org", desired_app_role: "caregiver",
  desired_claim_version: 4, phase: "finalized" };
beforeEach(() => {
  vi.clearAllMocks();
  currentActor.mockResolvedValue({ data: { user_id: "actor", organization_id: "org", session_id: "current-session", auth_claim_version: 9 }, error: null });
});
it("surfaces an independent current security hold on a finalized receipt as action_required", async () => {
  rpc.mockImplementation(async (name: string) => ({ data: name === "user_auth_sync_status_review" ? { phase: "dead_letter" } : receipt, error: null }));
  expect((await commitRestrictiveUserAccess(admin, command)).sync_status).toBe("action_required");
  expect(rpc).toHaveBeenCalledWith("restrict_user_access_review", expect.objectContaining({
    p_actor_session_id: "current-session", p_actor_claim_version: 9, p_request_key: "original-receipt",
  }));
});
it("does not label a completed historical receipt synchronized while actual Auth state drifts", async () => {
  rpc.mockImplementation(async (name: string) => ({ data: name === "user_auth_sync_status_review" ? { phase: "pending_auth" } : receipt, error: null }));
  expect((await commitRestrictiveUserAccess(admin, command)).sync_status).toBe("retry_required");
});
it("does not issue a service command when the request actor does not match", async () => {
  currentActor.mockResolvedValue({ data: { user_id: "other", organization_id: "org", session_id: "other-session", auth_claim_version: 9 }, error: null });
  await expect(commitRestrictiveUserAccess(admin, command)).rejects.toThrow("authorization is unavailable");
  expect(rpc).not.toHaveBeenCalled();
});
