import { act, render, screen, waitFor } from "@testing-library/react";
import type { Session } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  clearClientRoleContext: vi.fn(),
  primeClientRoleContext: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: authMocks.createClient,
  withSupabaseAuthLockRetry: <T,>(operation: () => Promise<T>) => operation(),
}));

vi.mock("@/lib/auth/client-role-context", () => ({
  clearClientRoleContext: authMocks.clearClientRoleContext,
  primeClientRoleContext: authMocks.primeClientRoleContext,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
}));

import { HavenAuthProvider, useHavenAuth } from "./haven-auth-context";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function sessionFor(userId: string, organizationId: string): Session {
  return {
    user: {
      id: userId,
      email: `${userId}@example.com`,
      app_metadata: {
        app_role: "facility_admin",
        organization_id: organizationId,
      },
    },
  } as unknown as Session;
}

function AuthStateProbe() {
  const { user, organizationId, loading } = useHavenAuth();
  return (
    <div>
      <span data-testid="user-id">{user?.id ?? "none"}</span>
      <span data-testid="organization-id">{organizationId ?? "none"}</span>
      <span data-testid="loading">{String(loading)}</span>
    </div>
  );
}

describe("HavenAuthProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not restore a stale role context when the session changes during a load", async () => {
    const staleSession = deferred<{ data: { session: Session }; error: null }>();
    const currentSession = sessionFor("current-user", "current-organization");
    let onAuthStateChange: (() => void) | undefined;

    const rpc = vi.fn().mockResolvedValue({
        data: {
          user_id: "current-user",
          app_role: "facility_admin",
          organization_id: "current-organization",
          full_name: "Current User",
          avatar_url: null,
          organization_name: "Current Organization",
          is_managed: true,
        },
        error: null,
      });

    const supabase = {
      auth: {
        getSession: vi
          .fn()
          .mockImplementationOnce(() => staleSession.promise)
          .mockResolvedValueOnce({ data: { session: currentSession }, error: null }),
        onAuthStateChange: vi.fn((callback: () => void) => {
          onAuthStateChange = callback;
          return { data: { subscription: { unsubscribe: vi.fn() } } };
        }),
      },
      rpc,
    };
    authMocks.createClient.mockReturnValue(supabase);

    render(
      <HavenAuthProvider>
        <AuthStateProbe />
      </HavenAuthProvider>,
    );

    await waitFor(() => expect(supabase.auth.getSession).toHaveBeenCalledTimes(1));

    await act(async () => {
      onAuthStateChange?.();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId("user-id")).toHaveTextContent("current-user");
      expect(screen.getByTestId("organization-id")).toHaveTextContent(
        "current-organization",
      );
      expect(screen.getByTestId("loading")).toHaveTextContent("false");
    });
    expect(authMocks.primeClientRoleContext).toHaveBeenCalledTimes(1);
    expect(authMocks.primeClientRoleContext).toHaveBeenCalledWith(supabase, {
      userId: "current-user",
      organizationId: "current-organization",
      appRole: "facility_admin",
    });

    await act(async () => {
      staleSession.resolve({
        data: { session: sessionFor("stale-user", "stale-organization") },
        error: null,
      });
      await staleSession.promise;
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(authMocks.primeClientRoleContext).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("user-id")).toHaveTextContent("current-user");
    expect(screen.getByTestId("organization-id")).toHaveTextContent(
      "current-organization",
    );
  });

  it("clears a session whose current actor no longer resolves", async () => {
    const supabase = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: sessionFor("stale-user", "stale-organization") },
          error: null,
        }),
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      },
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    authMocks.createClient.mockReturnValue(supabase);

    render(
      <HavenAuthProvider>
        <AuthStateProbe />
      </HavenAuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("user-id")).toHaveTextContent("none");
    expect(screen.getByTestId("organization-id")).toHaveTextContent("none");
    expect(authMocks.primeClientRoleContext).not.toHaveBeenCalled();
  });

  it("keeps the signed-in identity on screen through a same-user token refresh (COL-674)", async () => {
    let onAuthStateChange: ((event: string, session: Session | null) => void) | undefined;
    const current = sessionFor("current-user", "current-organization");
    const actor = deferred<{ data: unknown; error: null }>();
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: { user_id: "current-user", app_role: "facility_admin", organization_id: "current-organization", is_managed: true },
        error: null,
      })
      .mockImplementationOnce(() => actor.promise);
    const supabase = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: current }, error: null }),
        onAuthStateChange: vi.fn((callback: (event: string, session: Session | null) => void) => {
          onAuthStateChange = callback;
          return { data: { subscription: { unsubscribe: vi.fn() } } };
        }),
      },
      rpc,
    };
    authMocks.createClient.mockReturnValue(supabase);

    render(
      <HavenAuthProvider>
        <AuthStateProbe />
      </HavenAuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("user-id")).toHaveTextContent("current-user"));

    await act(async () => {
      onAuthStateChange?.("INITIAL_SESSION", current);
      await Promise.resolve();
    });
    expect(rpc).toHaveBeenCalledTimes(1);

    await act(async () => {
      onAuthStateChange?.("TOKEN_REFRESHED", current);
      await Promise.resolve();
    });
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    // While the background re-read is in flight, nothing flips back to loading.
    expect(screen.getByTestId("user-id")).toHaveTextContent("current-user");
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
    expect(authMocks.clearClientRoleContext).not.toHaveBeenCalled();

    await act(async () => {
      actor.resolve({
        data: { user_id: "current-user", app_role: "facility_admin", organization_id: "current-organization", is_managed: true },
        error: null,
      });
      await actor.promise;
    });
    expect(screen.getByTestId("user-id")).toHaveTextContent("current-user");
  });
});
