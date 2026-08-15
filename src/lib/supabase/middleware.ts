import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import type { AuthClaimUser } from "@/lib/auth/app-role";

export type SessionUpdateResult = {
  response: NextResponse;
  user: AuthClaimUser | null;
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
  try {
    // Verify the signed JWT instead of reading the untrusted user copy stored
    // in cookies. This project uses asymmetric signing, so the public key is
    // cached after the first request and subsequent route checks stay local.
    const { data, error } = await supabase.auth.getClaims();
    if (!error && typeof data?.claims?.sub === "string") {
      user = {
        app_metadata: data.claims.app_metadata as Record<string, unknown> | undefined,
        user_metadata: data.claims.user_metadata as Record<string, unknown> | undefined,
      };
    }
  } catch (e: unknown) {
    /* auth check failed — treat as unauthenticated */
    void e;
  }
  return { response, user };
}
