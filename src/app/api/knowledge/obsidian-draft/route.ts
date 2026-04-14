import { NextResponse } from "next/server";

import obsidianDraft from "@/lib/knowledge/obsidian-draft";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createClient } from "@/lib/supabase/server";

type Body = {
  documentId?: string;
};

const ALLOWED_ROLES = new Set(["owner", "org_admin", "facility_admin"]);

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const documentId = body.documentId?.trim();
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
  } catch (error) {
    console.error("[obsidian-draft] service role", error);
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
    return NextResponse.json({ error: "Only facility admin, org admin, or owner can create Obsidian drafts" }, { status: 403 });
  }

  const { data: document, error: documentError } = await admin
    .from("documents")
    .select("id, workspace_id, title, markdown_text, raw_text, summary, mime_type, audience, status, metadata, created_at, updated_at")
    .eq("id", documentId)
    .is("deleted_at", null)
    .maybeSingle();

  if (documentError || !document) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  if (document.workspace_id !== profile.organization_id) {
    return NextResponse.json({ error: "Organization mismatch" }, { status: 403 });
  }

  try {
    const draft = await obsidianDraft.createObsidianDraftFromDocument({
      id: document.id,
      title: document.title,
      markdown_text: document.markdown_text,
      raw_text: document.raw_text,
      summary: document.summary,
      mime_type: document.mime_type,
      audience: document.audience,
      status: document.status,
      metadata: (document.metadata ?? {}) as Record<string, unknown>,
      created_at: document.created_at,
      updated_at: document.updated_at,
    });

    await admin.from("document_audit_events").insert({
      actor_user_id: user.id,
      document_id: document.id,
      document_title_snapshot: document.title,
      event_type: "obsidian_draft_created",
      metadata: {
        note_path: draft.notePath,
        suggested_target_folder: draft.suggestedTargetFolder,
        related_links: draft.relatedLinks,
      },
    });

    return NextResponse.json({
      ok: true,
      notePath: draft.notePath,
      draftTitle: draft.draftTitle,
      suggestedTargetFolder: draft.suggestedTargetFolder,
      relatedLinks: draft.relatedLinks,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create Obsidian draft";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
