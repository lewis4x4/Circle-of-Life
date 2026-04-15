import { NextResponse } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createClient } from "@/lib/supabase/server";

const ALLOWED_ROLES = new Set(["owner", "org_admin", "facility_admin"]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const documentId = url.searchParams.get("documentId")?.trim();
  if (!documentId) {
    return NextResponse.json({ error: "documentId is required" }, { status: 400 });
  }

  const sessionClient = await createClient();
  const {
    data: { user },
    error: sessionError,
  } = await sessionClient.auth.getUser();

  if (sessionError || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch {
    return NextResponse.json({ error: "Server configuration error" }, { status: 503 });
  }

  const { data: profile, error: profileError } = await admin
    .from("user_profiles")
    .select("organization_id, app_role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile?.organization_id || !profile.app_role) {
    return NextResponse.json({ error: "Profile not found" }, { status: 403 });
  }

  if (!ALLOWED_ROLES.has(profile.app_role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: document, error: documentError } = await admin
    .from("documents")
    .select("id, workspace_id, title, status, audience, summary, word_count, mime_type, metadata, review_owner, review_due_at, approved_at, approved_by, classification_updated_at")
    .eq("id", documentId)
    .is("deleted_at", null)
    .maybeSingle();

  if (documentError || !document) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  if (document.workspace_id !== profile.organization_id) {
    return NextResponse.json({ error: "Organization mismatch" }, { status: 403 });
  }

  const { data: auditRows, error: auditError } = await admin
    .from("document_audit_events")
    .select("id, event_type, metadata, actor_user_id, created_at, document_title_snapshot")
    .eq("document_id", documentId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (auditError) {
    return NextResponse.json({ error: auditError.message }, { status: 500 });
  }

  const userIds = Array.from(
    new Set(
      [
        document.review_owner,
        document.approved_by,
        ...(auditRows ?? []).map((row) => row.actor_user_id),
      ].filter((value): value is string => typeof value === "string" && value.length > 0),
    ),
  );

  const { data: profileRows } =
    userIds.length > 0
      ? await admin
          .from("user_profiles")
          .select("id, full_name, email")
          .in("id", userIds)
      : { data: [] };

  const userLabels = Object.fromEntries(
    ((profileRows ?? []) as Array<{ id: string; full_name: string; email: string }>).map((row) => [
      row.id,
      row.full_name || row.email || row.id,
    ]),
  );

  return NextResponse.json({
    ok: true,
    document,
    auditEvents: auditRows ?? [],
    currentUserId: user.id,
    userLabels,
  });
}
