import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Database } from "@/types/database";

const updateProfileSchema = z.object({
  fullName: z.string().trim().max(120, "Display name must be 120 characters or less.").nullable(),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = updateProfileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const fullName = parsed.data.fullName?.trim() || null;

  try {
    const admin = createServiceRoleClient();
    const { data: existing, error: profileError } = await admin
      .from("user_profiles")
      .select("id")
      .eq("id", user.id)
      .is("deleted_at", null)
      .maybeSingle();

    if (profileError || !existing) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    const updatePayload = {
      full_name: fullName,
      updated_at: new Date().toISOString(),
    } as unknown as Database["public"]["Tables"]["user_profiles"]["Update"];

    const { data: updated, error: updateError } = await admin
      .from("user_profiles")
      .update(updatePayload)
      .eq("id", user.id)
      .select("id, full_name, avatar_url")
      .single();

    if (updateError) {
      return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
    }

    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error(
      "[ProfileRoute] Failed to update profile",
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.json({ error: "Profile update is not configured on this server" }, { status: 503 });
  }
}
