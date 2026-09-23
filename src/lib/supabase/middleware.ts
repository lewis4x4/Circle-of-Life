import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import type { AuthClaimUser } from "@/lib/auth/app-role";
import {
  SHELL_ACTOR_CACHE_COOKIE,
  readShellActor,
  shellActorCacheConfig,
  signShellActor,
} from "@/lib/supabase/shell-actor-cache";

export type SessionUpdateResult = {
  response: NextResponse;
  user: AuthClaimUser | null;
  unavailable?: boolean;
};

type ShellActor = {
  user_id: string;
  organization_id: string;
  app_role: string;
  auth_claim_version: number;
  /** Exposed by migration 387 from user_profiles.settings. */
  must_change_password?: boolean;
};

export async function updateSession(request: NextRequest): Promise<SessionUpdateResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return { response: NextResponse.next({ request }), user: null };
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  let user: AuthClaimUser | null = null;
  let unavailable = false;
  // Set on the final response only: setAll above may replace `response` while
  // the session refreshes.
  let actorCookie: { value: string; maxAge: number } | null = null;
  let clearActorCookie = false;
  const cacheConfig = shellActorCacheConfig();
  const cookieActor = request.cookies.get(SHELL_ACTOR_CACHE_COOKIE)?.value;
  try {
    // Verify the signed JWT instead of reading the untrusted user copy stored
    // in cookies. This project uses asymmetric signing, so the public key is
    // cached after the first request and subsequent route checks stay local.
    const { data, error } = await supabase.auth.getClaims();
    if (!error && typeof data?.claims?.sub === "string") {
      const binding = {
        sub: data.claims.sub,
        sessionId: typeof data.claims.session_id === "string" ? data.claims.session_id : "",
        claimVersion: typeof data.claims.auth_claim_version === "number" ? data.claims.auth_claim_version : null,
      };
      // COL-674: a recent, signed, session-bound answer routes this request
      // without the database round trip. See shell-actor-cache.ts for why that
      // is safe; data access is still re-authorized by every query.
      const cached = cacheConfig ? await readShellActor(cookieActor, binding, cacheConfig) : null;
      if (cached) {
        user = {
          app_metadata: {
            app_role: cached.app_role,
            organization_id: cached.organization_id,
            auth_claim_version: cached.auth_claim_version,
            must_change_password: false,
          },
        };
      } else {
        const { data: currentActor, error: actorError } = await supabase.rpc(
          "haven_current_shell_actor" as never,
        );
        const actor = currentActor as ShellActor | null;
        if (!actorError && actor?.user_id === data.claims.sub) {
          user = {
            app_metadata: {
              app_role: actor.app_role,
              organization_id: actor.organization_id,
              auth_claim_version: actor.auth_claim_version,
              must_change_password: actor.must_change_password === true,
            },
          };
          if (cacheConfig) {
            const value = await signShellActor(actor, binding, cacheConfig);
            if (value) actorCookie = { value, maxAge: cacheConfig.ttlSeconds };
            else clearActorCookie = Boolean(cookieActor);
          }
        } else if (actorError?.code === "HAVEN_AUTHORIZATION_STALE" || (!actorError && currentActor === null)) {
          // The documented global sign-out endpoint requires the target session's
          // JWT. This request owns that JWT, so it can revoke all refresh tokens;
          // migration 326 already denied this access token immediately.
          clearActorCookie = Boolean(cookieActor);
          await supabase.auth.signOut({ scope: "global" });
        } else {
          unavailable = true;
        }
      }
    } else {
      clearActorCookie = Boolean(cookieActor);
    }
  } catch (e: unknown) {
    // A transport failure denies this request without revoking healthy sessions.
    unavailable = true;
    void e;
  }
  if (actorCookie) {
    response.cookies.set(SHELL_ACTOR_CACHE_COOKIE, actorCookie.value, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: actorCookie.maxAge,
    });
  } else if (clearActorCookie) {
    response.cookies.set(SHELL_ACTOR_CACHE_COOKIE, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }
  return { response, user, unavailable };
}
