import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireActor: vi.fn(),
  revalidateActor: vi.fn(),
  verifyState: vi.fn(),
  exchangeCode: vi.fn(),
}));

vi.mock("@/lib/auth/current-api-actor", () => ({
  requireCurrentApiActor: mocks.requireActor,
  revalidateCurrentApiActor: mocks.revalidateActor,
}));
vi.mock("@/lib/reputation/oauth-state", () => ({ verifyOAuthState: mocks.verifyState }));
vi.mock("@/lib/reputation/google-oauth", () => ({
  exchangeAuthorizationCode: mocks.exchangeCode,
}));

import { GET } from "./route";

function request() {
  return new Request("https://haven.test/api/reputation/oauth/google/callback?code=code-1&state=state-1");
}

describe("Google OAuth callback current actor gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyState.mockReturnValue({ userId: "user-1", orgId: "org-1" });
    mocks.requireActor.mockResolvedValue({
      actor: {
        id: "user-1",
        organizationId: "org-1",
        appRole: "owner",
        admin: {},
      },
    });
    mocks.revalidateActor.mockImplementation(async (actor) => ({ actor }));
  });

  it("does not exchange a provider code when the current actor is denied", async () => {
    mocks.requireActor.mockResolvedValue({
      response: Response.json({ error: "Sign in again to continue." }, { status: 401 }),
    });

    const response = await GET(request());

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("error=session_mismatch");
    expect(mocks.exchangeCode).not.toHaveBeenCalled();
  });

  it("does not exchange a provider code when signed state organization is stale", async () => {
    mocks.verifyState.mockReturnValue({ userId: "user-1", orgId: "old-org" });

    const response = await GET(request());

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("error=session_mismatch");
    expect(mocks.exchangeCode).not.toHaveBeenCalled();
  });

  it("does not exchange a provider code when the owner is disabled after initial resolution", async () => {
    mocks.revalidateActor.mockResolvedValue({
      response: Response.json({ error: "Sign in again" }, { status: 401 }),
    });

    const response = await GET(request());

    expect(response.headers.get("location")).toContain("error=session_mismatch");
    expect(mocks.exchangeCode).not.toHaveBeenCalled();
  });
});
