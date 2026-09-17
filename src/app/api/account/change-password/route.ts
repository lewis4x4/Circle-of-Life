/**
 * POST /api/account/change-password — authenticated password change; clears must-change flag.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { changePasswordSchema } from "@/lib/validation/change-password";
import { adminSetMustChangePassword } from "@/lib/supabase/must-change-password-admin";
import {
  TEMPORARY_PASSWORD_EXPIRES_AT_KEY,
  isTemporaryPasswordExpired,
} from "@/lib/auth/temporary-password";
import {
  checkFailureRateLimit,
  clearFailureRateLimit,
  recordFailureRateLimit,
} from "@/lib/security/in-memory-failure-rate-limit";
import { logError } from "@/lib/observability/logger";

/** Five wrong current-password guesses per user per 15 minutes. */
const CHANGE_PASSWORD_RATE_LIMIT = { maxFailures: 5, windowMs: 15 * 60 * 1000 };
import { createClient as createServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

function createPasswordVerifyClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const session = sessionData.session;
  const user = session?.user;
  if (sessionError || !user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = changePasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const { current_password, new_password } = parsed.data;

  // A forced change carries a deadline. Past it the temporary password is no longer a
  // credential the user may trade in for a permanent one — an admin has to reissue.
  // Checked before the password probe so an expired account cannot be used as an oracle.
  const appMetadata = (user.app_metadata ?? {}) as Record<string, unknown>;
  if (appMetadata.must_change_password === true) {
    const expiresAt = appMetadata[TEMPORARY_PASSWORD_EXPIRES_AT_KEY];
    if (isTemporaryPasswordExpired(typeof expiresAt === "string" ? expiresAt : null)) {
      return NextResponse.json(
        {
          error:
            "Your temporary password has expired. Ask an administrator to issue a new one.",
          code: "temporary_password_expired",
        },
        { status: 403 },
      );
    }
  }

  // This endpoint verifies `current_password` by signing in with it, which makes it a
  // password oracle for anyone holding a session. Cap the failures (COL-362).
  const limiterKey = `account.change-password:${user.id}`;
  const limit = checkFailureRateLimit(limiterKey, CHANGE_PASSWORD_RATE_LIMIT);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: "Too many incorrect attempts. Try again shortly.",
        code: "rate_limited",
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const verifyClient = createPasswordVerifyClient();
  const { error: signInError } = await verifyClient.auth.signInWithPassword({
    email: user.email,
    password: current_password,
  });
  if (signInError) {
    recordFailureRateLimit(limiterKey, CHANGE_PASSWORD_RATE_LIMIT);
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 403 });
  }

  const { error: updateError } = await supabase.auth.updateUser({ password: new_password });
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  try {
    await adminSetMustChangePassword(user.id, false);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not clear password policy flag";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // `updateUser` above already re-minted the session cookie, but it did so *before* the
  // flag was cleared, so that token still carries must_change_password: true. Without a
  // second refresh the client gate keeps bouncing the user back here after a successful
  // change — they are locked out by the very screen that was supposed to release them.
  const { error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) {
    logError("account.change-password.refresh", refreshError, {
      action: "refresh_session_after_password_change",
    });
    return NextResponse.json(
      {
        error:
          "Your password was changed, but your session could not be refreshed. Sign out and sign back in.",
        code: "session_refresh_failed",
        password_changed: true,
      },
      { status: 500 },
    );
  }

  // A successful change clears the budget — the user proved they hold the credential.
  clearFailureRateLimit(limiterKey);

  return NextResponse.json({ ok: true });
}
