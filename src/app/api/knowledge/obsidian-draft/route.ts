import { NextResponse } from "next/server";

import { requireCurrentApiActor, revalidateCurrentApiActor } from "@/lib/auth/current-api-actor";
import obsidianDraft from "@/lib/knowledge/obsidian-draft";
import { ObsidianVaultUnavailableError } from "@/lib/knowledge/obsidian-draft";
import { logError } from "@/lib/observability/logger";

type Body = {
  documentId?: string;
};

const ALLOWED_ROLES = ["owner", "org_admin", "facility_admin"] as const;

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

  const actorResult = await requireCurrentApiActor({
    allowedRoles: ALLOWED_ROLES,
    scope: "knowledge.obsidian-draft",
  });
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const admin = actor.admin;

  const { data: document, error: documentError } = await admin
    .from("documents")
    .select("id, workspace_id, title, markdown_text, raw_text, summary, mime_type, audience, status, metadata, created_at, updated_at")
    .eq("id", documentId)
    .eq("workspace_id", actor.organizationId)
    .is("deleted_at", null)
    .maybeSingle();

  if (documentError || !document) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  try {
    const currentResult = await revalidateCurrentApiActor(actor, {
      allowedRoles: ALLOWED_ROLES,
      scope: "knowledge.obsidian-draft.revalidate",
    });
    if ("response" in currentResult) return currentResult.response;
    const currentActor = currentResult.actor;
    if (currentActor.organizationId !== document.workspace_id) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
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

    await currentActor.admin.from("document_audit_events").insert({
      actor_user_id: currentActor.id,
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
    if (error instanceof ObsidianVaultUnavailableError) {
      return NextResponse.json(
        {
          ok: true,
          skipped: true,
          reason: "vault_unavailable",
          message:
            "Upload succeeded, but this Haven runtime cannot access your local Obsidian vault. Run Haven on the same machine as the vault or set OBSIDIAN_ACTIVE_VAULT_PATH on a runtime that can reach it.",
        },
        { status: 200 },
      );
    }
    logError("knowledge.obsidian-draft", error, { action: "create_draft", documentId });
    return NextResponse.json({ error: "Could not create Obsidian draft" }, { status: 500 });
  }
}
