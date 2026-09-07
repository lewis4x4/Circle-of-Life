import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCurrentApiActor, revalidateCurrentApiActor } from "@/lib/auth/current-api-actor";
import type { Database } from "@/types/database";

const updateProfileSchema = z.object({
  fullName: z.string().trim().max(120, "Display name must be 120 characters or less.").nullable(),
});

export async function POST(request: NextRequest) {
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
  const actorResult = await requireCurrentApiActor({ scope: "admin.profile" });
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  try {
    const currentResult = await revalidateCurrentApiActor(actor, { scope: "admin.profile.revalidate" });
    if ("response" in currentResult) return currentResult.response;
    const currentActor = currentResult.actor;

    const updatePayload = {
      full_name: fullName,
      updated_at: new Date().toISOString(),
    } as unknown as Database["public"]["Tables"]["user_profiles"]["Update"];

    const { data: updated, error: updateError } = await currentActor.admin
      .from("user_profiles")
      .update(updatePayload)
      .eq("id", currentActor.id)
      .eq("organization_id", currentActor.organizationId)
      .eq("is_active", true)
      .is("deleted_at", null)
      .select("id, full_name, avatar_url")
      .maybeSingle();

    if (updateError || !updated) {
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
