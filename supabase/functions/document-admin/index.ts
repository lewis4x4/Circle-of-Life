/**
 * Knowledge Base — document lifecycle (update metadata, soft delete).
 * Auth: user JWT. Roles: owner, org_admin only.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCorsHeaders, jsonResponse } from "../_shared/cors.ts";
import { withTiming } from "../_shared/structured-log.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ADMIN_ROLES = ["owner", "org_admin"] as const;

Deno.serve(async (req) => {
  const t = withTiming("document-admin");
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, origin);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error: authError,
  } = await admin.auth.getUser(token);
  if (authError || !user) {
    return jsonResponse({ error: "Unauthorized" }, 401, origin);
  }

  const { data: profile } = await admin
    .from("user_profiles")
    .select("app_role, organization_id")
    .eq("id", user.id)
    .single();

  const userRole = profile?.app_role ?? "caregiver";
  const orgId = profile?.organization_id as string | undefined;

  if (!ADMIN_ROLES.includes(userRole as (typeof ADMIN_ROLES)[number])) {
    return jsonResponse({ error: "Forbidden: admin/owner only" }, 403, origin);
  }

  let body: {
    action?: string;
    document_id?: string;
    audience?: string;
    status?: string;
    review_owner?: string | null;
    review_due_at?: string | null;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, origin);
  }

  const { action, document_id } = body;

  if (!document_id) {
    return jsonResponse({ error: "document_id required" }, 400, origin);
  }

  const { data: doc, error: docErr } = await admin.from("documents").select("*").eq("id", document_id).single();
  if (docErr || !doc) {
    return jsonResponse({ error: "Document not found" }, 404, origin);
  }
  if (doc.workspace_id !== orgId) {
    return jsonResponse({ error: "Forbidden" }, 403, origin);
  }

  try {
    switch (action) {
      case "update": {
        const updates: Record<string, unknown> = {};
        const auditMeta: Record<string, unknown> = {};

        if (body.audience && body.audience !== doc.audience) {
          updates.audience = body.audience;
          updates.classification_updated_by = user.id;
          updates.classification_updated_at = new Date().toISOString();
          auditMeta.audience_from = doc.audience;
          auditMeta.audience_to = body.audience;
        }
        if (body.status && body.status !== doc.status) {
          updates.status = body.status;
          if (body.status === "published") {
            updates.approved_by = user.id;
            updates.approved_at = new Date().toISOString();
          }
          auditMeta.status_from = doc.status;
          auditMeta.status_to = body.status;
        }
        if (body.review_owner !== undefined) {
          updates.review_owner = body.review_owner;
          auditMeta.review_owner = body.review_owner;
        }
        if (body.review_due_at !== undefined) {
          updates.review_due_at = body.review_due_at;
          auditMeta.review_due_at = body.review_due_at;
        }

        if (Object.keys(updates).length === 0) {
          return jsonResponse({ error: "No changes specified" }, 400, origin);
        }

        updates.updated_at = new Date().toISOString();
        const { error: updateErr } = await admin.from("documents").update(updates).eq("id", document_id);
        if (updateErr) throw updateErr;

        let eventType = "status_changed";
        if (auditMeta.audience_to) eventType = "reclassified";
        if (auditMeta.status_to === "published") eventType = "published";
        if (auditMeta.status_to === "approved") eventType = "approved";

        await admin.from("document_audit_events").insert({
          actor_user_id: user.id,
          document_id,
          document_title_snapshot: doc.title,
          event_type: eventType,
          metadata: auditMeta,
        });

        t.log({ event: "update_ok", outcome: "success", document_id });
        return new Response(JSON.stringify({ success: true, updates }), {
          headers: { ...getCorsHeaders(origin), "Content-Type": "application/json" },
        });
      }

      case "delete": {
        const meta = doc.metadata as { storage_path?: string; storage_bucket?: string } | null;
        if (meta?.storage_path) {
          await admin.storage.from(meta.storage_bucket || "documents").remove([meta.storage_path]);
        }

        const { error: delErr } = await admin
          .from("documents")
          .update({ deleted_at: new Date().toISOString(), status: "archived" })
          .eq("id", document_id);
        if (delErr) throw delErr;

        await admin.from("document_audit_events").insert({
          actor_user_id: user.id,
          document_id,
          document_title_snapshot: doc.title,
          event_type: "deleted",
          metadata: {},
        });

        t.log({ event: "soft_delete_ok", outcome: "success", document_id });
        return new Response(JSON.stringify({ success: true, deleted: document_id }), {
          headers: { ...getCorsHeaders(origin), "Content-Type": "application/json" },
        });
      }

      case "regenerate_markdown": {
        // Trigger the ingest function's regenerate_markdown path
        const ingestUrl = `${SUPABASE_URL}/functions/v1/ingest`;
        const authHeader = req.headers.get("authorization") ?? "";
        const ingestRes = await fetch(ingestUrl, {
          method: "POST",
          headers: {
            "Authorization": authHeader,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ document_id, action: "regenerate_markdown" }),
          signal: AbortSignal.timeout(180_000),
        });

        const ingestResult = await ingestRes.json();
        if (!ingestRes.ok) {
          t.log({ event: "regenerate_failed", outcome: "error", error_message: ingestResult.error });
          return new Response(JSON.stringify(ingestResult), {
            status: ingestRes.status,
            headers: { ...getCorsHeaders(origin), "Content-Type": "application/json" },
          });
        }

        t.log({ event: "regenerate_ok", outcome: "success", document_id });
        return new Response(JSON.stringify(ingestResult), {
          headers: { ...getCorsHeaders(origin), "Content-Type": "application/json" },
        });
      }

      default:
        return jsonResponse({ error: `Unknown action: ${action ?? "missing"}` }, 400, origin);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    t.log({ event: "document_admin_error", outcome: "error", error_message: msg });
    return jsonResponse({ error: msg }, 500, origin);
  }
});
