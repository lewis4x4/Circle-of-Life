import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import type { AuthClaimUser } from "@/lib/auth/app-role";

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
  try {
    // Verify the signed JWT instead of reading the untrusted user copy stored
    // in cookies. This project uses asymmetric signing, so the public key is
    // cached after the first request and subsequent route checks stay local.
    const { data, error } = await supabase.auth.getClaims();
    if (!error && typeof data?.claims?.sub === "string") {
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
          },
        };
      } else if (actorError?.code === "HAVEN_AUTHORIZATION_STALE" || (!actorError && currentActor === null)) {
        // The documented global sign-out endpoint requires the target session's
        // JWT. This request owns that JWT, so it can revoke all refresh tokens;
        // migration 326 already denied this access token immediately.
        await supabase.auth.signOut({ scope: "global" });
      } else {
        unavailable = true;
      }
    }
  } catch (e: unknown) {
    // A transport failure denies this request without revoking healthy sessions.
    unavailable = true;
    void e;
  }
  return { response, user, unavailable };
}
