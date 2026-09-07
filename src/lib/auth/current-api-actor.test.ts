import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createServiceRoleClient: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: mocks.createServiceRoleClient,
}));
vi.mock("@/lib/observability/logger", () => ({ logError: mocks.logError }));

import { requireCurrentApiActor, revalidateCurrentApiActor } from "./current-api-actor";

type ProfileResult = {
  data: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
};

function makeSessionClient(options?: {
  user?: Record<string, unknown> | null;
  sessionError?: Record<string, unknown> | null;
  profile?: ProfileResult;
  profiles?: ProfileResult[];
  events?: string[];
}) {
  const events = options?.events ?? [];
  const profile = options?.profile ?? {
    data: {
      id: "user-1",
      organization_id: "org-1",
      app_role: "nurse",
      email: "nurse@example.test",
      full_name: "Current Nurse",
    },
    error: null,
  };
  const profiles = [...(options?.profiles ?? [])];
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    is: vi.fn(() => query),
    maybeSingle: vi.fn(async () => {
      events.push("profile-resolved");
      return profiles.length > 0 ? profiles.shift() : profile;
    }),
  };
  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: {
          user:
            options && "user" in options
              ? options.user
              : { id: "user-1", email: "session@example.test", app_metadata: {} },
        },
        error: options?.sessionError ?? null,
      })),
    },
    from: vi.fn(() => query),
    query,
  };
}

describe("requireCurrentApiActor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createServiceRoleClient.mockReturnValue({ kind: "service" });
  });

  it("does not construct the service client for a missing session", async () => {
    mocks.createClient.mockResolvedValue(makeSessionClient({ user: null }));

    const result = await requireCurrentApiActor();

    expect("response" in result && result.response.status).toBe(401);
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
  });

  it.each(["inactive", "deleted"])(
    "rejects an %s profile before service-role construction",
    async () => {
      mocks.createClient.mockResolvedValue(
        makeSessionClient({ profile: { data: null, error: null } }),
      );

      const result = await requireCurrentApiActor();

      expect("response" in result && result.response.status).toBe(403);
      expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
    },
  );

  it.each([
    { label: "stale authorization version", error: { code: "HAVEN_AUTHORIZATION_STALE" } },
    {
      label: "revoked database session",
      error: { message: "HAVEN_AUTHORIZATION_STALE: session is no longer current" },
    },
  ])("rejects a $label before service-role construction", async ({ error }) => {
    mocks.createClient.mockResolvedValue(
      makeSessionClient({ profile: { data: null, error } }),
    );

    const result = await requireCurrentApiActor();

    expect("response" in result && result.response.status).toBe(401);
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
  });

  it("uses the current database role instead of stale JWT app_metadata", async () => {
    mocks.createClient.mockResolvedValue(
      makeSessionClient({
        user: {
          id: "user-1",
          email: "session@example.test",
          app_metadata: { app_role: "owner", organization_id: "wrong-org" },
        },
      }),
    );

    const result = await requireCurrentApiActor({ allowedRoles: ["owner"] });

    expect("response" in result && result.response.status).toBe(403);
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
  });

  it("constructs the service client only after current profile resolution", async () => {
    const events: string[] = [];
    const sessionClient = makeSessionClient({ events });
    mocks.createClient.mockResolvedValue(sessionClient);
    mocks.createServiceRoleClient.mockImplementation(() => {
      events.push("service-created");
      return { kind: "service" };
    });

    const result = await requireCurrentApiActor({ allowedRoles: ["nurse"] });

    expect(events).toEqual(["profile-resolved", "service-created"]);
    expect(sessionClient.query.eq).toHaveBeenCalledWith("is_active", true);
    expect(sessionClient.query.is).toHaveBeenCalledWith("deleted_at", null);
    expect("actor" in result && result.actor).toMatchObject({
      id: "user-1",
      organizationId: "org-1",
      appRole: "nurse",
    });
  });

  it("logs unexpected profile lookup failures without returning database detail", async () => {
    const sentinel = "database connection string leaked";
    mocks.createClient.mockResolvedValue(
      makeSessionClient({
        profile: { data: null, error: { code: "XX000", message: sentinel } },
      }),
    );

    const result = await requireCurrentApiActor({ scope: "test.scope" });
    expect("response" in result && await result.response.text()).not.toContain(sentinel);
    expect(mocks.logError).toHaveBeenCalledWith(
      "test.scope",
      expect.objectContaining({ message: sentinel }),
      { action: "resolve_current_profile" },
    );
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
  });

  it("revalidation rejects a role demotion without constructing another service client", async () => {
    const sessionClient = makeSessionClient({
      profiles: [
        { data: { id: "user-1", organization_id: "org-1", app_role: "owner", email: null, full_name: null }, error: null },
        { data: { id: "user-1", organization_id: "org-1", app_role: "nurse", email: null, full_name: null }, error: null },
      ],
    });
    mocks.createClient.mockResolvedValue(sessionClient);
    const initial = await requireCurrentApiActor({ allowedRoles: ["owner"] });
    expect("actor" in initial).toBe(true);
    if (!("actor" in initial)) return;

    const current = await revalidateCurrentApiActor(initial.actor, { allowedRoles: ["owner"] });

    expect("response" in current && current.response.status).toBe(403);
    expect(mocks.createServiceRoleClient).toHaveBeenCalledTimes(1);
  });

  it("revalidation rejects an actor disabled after initial authorization", async () => {
    const sessionClient = makeSessionClient({
      profiles: [
        { data: { id: "user-1", organization_id: "org-1", app_role: "nurse", email: null, full_name: null }, error: null },
        { data: null, error: null },
      ],
    });
    mocks.createClient.mockResolvedValue(sessionClient);
    const initial = await requireCurrentApiActor({ allowedRoles: ["nurse"] });
    expect("actor" in initial).toBe(true);
    if (!("actor" in initial)) return;

    const current = await revalidateCurrentApiActor(initial.actor, { allowedRoles: ["nurse"] });

    expect("response" in current && current.response.status).toBe(403);
    expect(mocks.createServiceRoleClient).toHaveBeenCalledTimes(1);
  });
});
