import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actorCanAccessTargetUser, requireAdminApiActor } from "@/lib/admin/api-auth";
import { canManageUser } from "@/lib/rbac";
import { writeUserAuditEntry } from "@/lib/audit/user-management-audit";

/** Explicitly changes both sign-in identity and the profile email. Safe to retry after partial failure. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApiActor({ allowedRoles: ["owner", "org_admin", "facility_admin", "manager"] });
  if ("response" in auth) return auth.response;
  const { actor } = auth;
  const { id } = await params;
  let parsed;
  try { parsed = z.object({ email: z.string().trim().email().toLowerCase() }).strict().safeParse(await request.json()); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!parsed.success) return NextResponse.json({ error: "Valid login email required" }, { status: 422 });
  if (id === actor.id || !(await actorCanAccessTargetUser(actor, id))) return NextResponse.json({ error: "Another authorized administrator must change this account's login email" }, { status: 403 });
  const { data: target } = await actor.admin.from("user_profiles").select("id,email,app_role")
    .eq("id", id).eq("organization_id", actor.organization_id).is("deleted_at", null).maybeSingle();
  if (!target || !canManageUser(actor.app_role, target.app_role)) return NextResponse.json({ error: "Cannot modify this account" }, { status: 403 });
  const { data: identity, error: authError } = await actor.admin.auth.admin.updateUserById(id, { email: parsed.data.email });
  if (authError || identity.user?.email?.toLowerCase() !== parsed.data.email) return NextResponse.json({ error: "Login email could not be changed. Retry the command.", sync_status: "retry_required" }, { status: 502 });
  const { data, error } = await actor.admin.from("user_profiles").update({ email: parsed.data.email })
    .eq("id", id).eq("organization_id", actor.organization_id).select("id,email").single();
  if (error || !data) return NextResponse.json({ error: "Login email changed; profile email needs retry with the same address.", sync_status: "retry_required" }, { status: 500 });
  await writeUserAuditEntry({ organizationId: actor.organization_id, actingUserId: actor.id, targetUserId: id, action: "update_profile", changes: { before: { email: target.email }, after: { email: data.email }, meta: { operation: "login_email" } } });
  return NextResponse.json({ data, sync_status: "synchronized" });
}
