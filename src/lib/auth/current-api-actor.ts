import { NextResponse } from "next/server";

import { logError } from "@/lib/observability/logger";
import { ALL_APP_ROLES, type AppRole } from "@/lib/rbac";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createClient } from "@/lib/supabase/server";
import { readMustChangePasswordFromSettings } from "@/lib/auth/must-change-password";

type CurrentProfileRow = {
  id: string;
  organization_id: string | null;
  app_role: AppRole | null;
  email: string | null;
  full_name: string | null;
  settings: unknown;
};

export type CurrentApiActor = {
  id: string;
  organizationId: string;
  appRole: AppRole;
  email: string | null;
  fullName: string | null;
  sessionEmail: string | null;
  client: Awaited<ReturnType<typeof createClient>>;
  admin: ReturnType<typeof createServiceRoleClient>;
};

export type CurrentApiActorResult =
  | { actor: CurrentApiActor }
  | { response: NextResponse };

function isStaleAuthorizationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === "HAVEN_AUTHORIZATION_STALE" ||
    (typeof candidate.message === "string" &&
      candidate.message.includes("HAVEN_AUTHORIZATION_STALE"))
  );
}

async function resolveCurrentProfile(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  scope: string,
): Promise<{ profile: CurrentProfileRow } | { response: NextResponse }> {
  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("id, organization_id, app_role, email, full_name, settings")
    .eq("id", userId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .maybeSingle();

  if (profileError) {
    if (!isStaleAuthorizationError(profileError)) {
      logError(scope, profileError, { action: "resolve_current_profile" });
    }
    return {
      response: NextResponse.json(
        { error: isStaleAuthorizationError(profileError) ? "Sign in again to continue." : "Could not verify account access" },
        { status: isStaleAuthorizationError(profileError) ? 401 : 500 },
      ),
    };
  }

  const current = profile as CurrentProfileRow | null;
  if (
    !current?.organization_id ||
    !current.app_role ||
    !(ALL_APP_ROLES as readonly string[]).includes(current.app_role)
  ) {
    return {
      response: NextResponse.json({ error: "Profile not found" }, { status: 403 }),
    };
  }

  return { profile: current };
}

/**
 * A user owing a password change may not act through the API. Enforced here, on the
 * shared actor resolver, so it applies to every route that derives an actor from the
 * session rather than to whichever routes someone remembered to annotate (COL-362).
 *
 * Pass `allowPendingPasswordChange` only for the endpoints that let the user complete
 * or abandon the change.
 */
function enforcePendingPasswordChange(
  profile: CurrentProfileRow,
  allowPendingPasswordChange?: boolean,
): { response: NextResponse } | null {
  if (allowPendingPasswordChange) return null;
  if (!readMustChangePasswordFromSettings(profile.settings)) return null;

  return {
    response: NextResponse.json(
      {
        error: "You must change your temporary password before continuing.",
        code: "password_change_required",
      },
      { status: 403 },
    ),
  };
}

function enforceAllowedRole(
  profile: CurrentProfileRow,
  allowedRoles?: readonly AppRole[],
): { response: NextResponse } | null {
  if (allowedRoles && !allowedRoles.includes(profile.app_role as AppRole)) {
    return {
      response: NextResponse.json({ error: "Insufficient permissions" }, { status: 403 }),
    };
  }
  return null;
}

/**
 * Resolves a user-derived API actor through the request-scoped Supabase client.
 *
 * The profile read deliberately happens before service-role construction. Under
 * migration 326, PostgREST's pre-request guard rejects missing/revoked sessions,
 * stale authorization versions, deleted Auth users, and inactive/deleted
 * profiles. Role and organization are then taken from the current database row,
 * never from request JSON or JWT app_metadata.
 */
export async function requireCurrentApiActor(options?: {
  allowedRoles?: readonly AppRole[];
  scope?: string;
  /** Only for endpoints that exist to resolve the forced change itself. */
  allowPendingPasswordChange?: boolean;
}): Promise<CurrentApiActorResult> {
  const scope = options?.scope ?? "api.current-actor";

  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch (error) {
    logError(scope, error, { action: "create_session_client" });
    return {
      response: NextResponse.json({ error: "Server configuration error" }, { status: 503 }),
    };
  }

  const {
    data: { user },
    error: sessionError,
  } = await supabase.auth.getUser();

  if (sessionError || !user) {
    return {
      response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }),
    };
  }

  const profileResult = await resolveCurrentProfile(supabase, user.id, scope);
  if ("response" in profileResult) return profileResult;
  const current = profileResult.profile;
  const pending = enforcePendingPasswordChange(current, options?.allowPendingPasswordChange);
  if (pending) return pending;
  const denied = enforceAllowedRole(current, options?.allowedRoles);
  if (denied) return denied;

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch (error) {
    logError(scope, error, { action: "create_service_client" });
    return {
      response: NextResponse.json({ error: "Server configuration error" }, { status: 503 }),
    };
  }

  return {
    actor: {
      id: current.id,
      organizationId: current.organization_id as string,
      appRole: current.app_role as AppRole,
      email: current.email,
      fullName: current.full_name,
      sessionEmail: user.email ?? null,
      client: supabase,
      admin,
    },
  };
}

/**
 * Revalidates an already resolved actor immediately before a sensitive action.
 * This performs a fresh Auth identity check and request-scoped profile read, so
 * migration 326 re-evaluates session/version and current profile authority.
 */
export async function revalidateCurrentApiActor(
  actor: CurrentApiActor,
  options?: {
    allowedRoles?: readonly AppRole[];
    scope?: string;
    allowPendingPasswordChange?: boolean;
  },
): Promise<CurrentApiActorResult> {
  const scope = options?.scope ?? "api.current-actor.revalidate";
  const {
    data: { user },
    error: sessionError,
  } = await actor.client.auth.getUser();
  if (sessionError || !user || user.id !== actor.id) {
    return {
      response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }),
    };
  }

  const profileResult = await resolveCurrentProfile(actor.client, actor.id, scope);
  if ("response" in profileResult) return profileResult;
  const current = profileResult.profile;
  const pending = enforcePendingPasswordChange(current, options?.allowPendingPasswordChange);
  if (pending) return pending;
  const denied = enforceAllowedRole(current, options?.allowedRoles);
  if (denied) return denied;

  return {
    actor: {
      ...actor,
      organizationId: current.organization_id as string,
      appRole: current.app_role as AppRole,
      email: current.email,
      fullName: current.full_name,
      sessionEmail: user.email ?? null,
    },
  };
}
