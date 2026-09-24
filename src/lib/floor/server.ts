/**
 * Server-only helpers for the /api/floor/* routes (COL-690, spec 40 §1, §4).
 * Never import from a client component: this file mints sessions with the
 * service-role client.
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";

import { FLOOR_ERROR_STATUS, publicFloorErrorCode, type FloorErrorCode } from "@/lib/floor/contract";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { SHELL_ACTOR_CACHE_COOKIE } from "@/lib/supabase/shell-actor-cache";
import type { Database } from "@/types/database";

export const NO_STORE = { "Cache-Control": "no-store" } as const;

export function floorJson(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): NextResponse {
  return NextResponse.json(body, { status: init.status ?? 200, headers: { ...NO_STORE, ...(init.headers ?? {}) } });
}

export function floorErrorResponse(dbCode: string, extra: { tries_left?: number } = {}): NextResponse {
  const code: FloorErrorCode = publicFloorErrorCode(dbCode);
  const headers: Record<string, string> = {};
  if (code === "device_throttled") headers["Retry-After"] = "300";
  if (code === "locked") headers["Retry-After"] = "900";
  return floorJson({ error: code, ...extra }, { status: FLOOR_ERROR_STATUS[code], headers });
}

type CookieLike = { name: string; value: string };

/**
 * Supabase auth cookies: `sb-<ref>-auth-token`, its `.0`, `.1` chunks, and the
 * PKCE `-code-verifier`. Plus the shell actor cache, which is bound to the
 * session it was minted for.
 */
export function isHavenSessionCookie(name: string): boolean {
  if (name === SHELL_ACTOR_CACHE_COOKIE) return true;
  return /^sb-.+-auth-token(?:-code-verifier)?(?:\.\d+)?$/.test(name);
}

/**
 * Expire every Haven session cookie the request carried, on the response. A
 * cookie the SSR client sets afterwards on the same response replaces its
 * expiry (the response cookie jar is keyed by name), so this is safe to run
 * before minting a new session.
 */
export function clearHavenSessionCookies(requestCookies: CookieLike[], response: NextResponse): void {
  for (const cookie of requestCookies) {
    if (!isHavenSessionCookie(cookie.name)) continue;
    response.cookies.set(cookie.name, "", {
      path: "/",
      maxAge: 0,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      httpOnly: cookie.name === SHELL_ACTOR_CACHE_COOKIE,
    });
  }
}

function supabasePublicEnv(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  return url && key ? { url, key } : null;
}

/**
 * An SSR auth client whose cookie writes land on `response`. `readCookies`
 * is what it sees as the incoming session: the request's cookies to sign a
 * session out, or nothing to mint a fresh one.
 */
export function createResponseBoundAuthClient(readCookies: CookieLike[], response: NextResponse) {
  const env = supabasePublicEnv();
  if (!env) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return createServerClient<Database>(env.url, env.key, {
    cookies: {
      getAll() {
        return readCookies.map(({ name, value }) => ({ name, value }));
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });
}

/**
 * Mint a Supabase session for `email` onto `response` (spec 40 §1): a
 * service-role magic link gives a hashed token, which the SSR client exchanges
 * with `verifyOtp`, so the session cookies are written to this response. No
 * email is sent. Existing session cookies on the request are expired first,
 * so the new person never inherits the previous person's session.
 */
export async function mintFloorSession(input: {
  email: string;
  userId: string;
  requestCookies: CookieLike[];
  response: NextResponse;
}): Promise<{ ok: true } | { ok: false; stage: "link" | "verify" | "mismatch" }> {
  clearHavenSessionCookies(input.requestCookies, input.response);

  const admin = createServiceRoleClient();
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email: input.email });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) return { ok: false, stage: "link" };

  const auth = createResponseBoundAuthClient([], input.response);
  const { data, error } = await auth.auth.verifyOtp({ type: "email", token_hash: tokenHash });
  if (error || !data.session) return { ok: false, stage: "verify" };
  if (data.session.user.id !== input.userId) {
    // The email resolved to someone else: never hand that session out.
    clearHavenSessionCookies(input.response.cookies.getAll(), input.response);
    return { ok: false, stage: "mismatch" };
  }
  return { ok: true };
}

/**
 * End the Haven session on this tablet: revoke it (`signOut({ scope: 'local' })`
 * through the SSR client, which also writes the cookie removals) and expire
 * every session cookie the request carried, which covers a session that had
 * already expired and could not be signed out.
 */
export async function endFloorSession(requestCookies: CookieLike[], response: NextResponse): Promise<void> {
  if (requestCookies.some((cookie) => isHavenSessionCookie(cookie.name) && cookie.name !== SHELL_ACTOR_CACHE_COOKIE)) {
    try {
      const auth = createResponseBoundAuthClient(requestCookies, response);
      await auth.auth.signOut({ scope: "local" });
    } catch {
      // Revocation is best effort; the cookies are cleared below either way.
    }
  }
  clearHavenSessionCookies(requestCookies, response);
}
