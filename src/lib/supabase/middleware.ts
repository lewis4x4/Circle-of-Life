import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";

export type SessionUpdateResult = {
  response: NextResponse;
  user: User | null;
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

  let user: User | null = null;
  try {
    // getSession() reads local cookies (no network) and refreshes only when the
    // access token is actually expired. getUser() hits the Supabase Auth API on
    // every request and was adding 300-1500ms of round-trip to every nav. The
    // proxy only uses this user object for routing/redirect decisions; all data
    // access is re-verified by RLS using the JWT attached to each query.
    const { data } = await supabase.auth.getSession();
    user = data.session?.user ?? null;
  } catch (e: unknown) {
    /* auth check failed — treat as unauthenticated */
    void e;
  }
  return { response, user };
}
