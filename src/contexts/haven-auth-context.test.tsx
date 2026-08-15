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

    const profileQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      is: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          app_role: "facility_admin",
          organization_id: "current-organization",
          full_name: "Current User",
          avatar_url: null,
          organizations: { name: "Current Organization" },
        },
        error: null,
      }),
    };
    profileQuery.select.mockReturnValue(profileQuery);
    profileQuery.eq.mockReturnValue(profileQuery);
    profileQuery.is.mockReturnValue(profileQuery);

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
      from: vi.fn(() => profileQuery),
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

    expect(supabase.from).toHaveBeenCalledTimes(1);
    expect(authMocks.primeClientRoleContext).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("user-id")).toHaveTextContent("current-user");
    expect(screen.getByTestId("organization-id")).toHaveTextContent(
      "current-organization",
    );
  });
});
