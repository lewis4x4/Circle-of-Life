import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  user: { id: "actor", app_metadata: { app_role: "owner", organization_id: "stale-org" } },
  appRole: "caregiver", organizationId: "current-org",
}));
vi.mock("@/contexts/haven-auth-context", () => ({ useHavenAuth: () => state }));
import { useAuth } from "./useAuth";
it("gives legacy administrator controls only current resolved role and organization", () => {
  expect(useAuth().user?.app_metadata).toMatchObject({ app_role: "caregiver", organization_id: "current-org" });
  expect(state.user.app_metadata.app_role).toBe("owner");
});
