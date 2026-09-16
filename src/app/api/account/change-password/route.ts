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

  const verifyClient = createPasswordVerifyClient();
  const { error: signInError } = await verifyClient.auth.signInWithPassword({
    email: user.email,
    password: current_password,
  });
  if (signInError) {
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

  return NextResponse.json({ ok: true });
}
