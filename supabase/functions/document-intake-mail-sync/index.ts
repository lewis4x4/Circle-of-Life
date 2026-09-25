/**
 * Document Intake mail receiver (COL-771, DI-06). Cron: every 5 minutes.
 *
 * Reads each active `document_intake_mailboxes` row with Microsoft Graph
 * (application permission `Mail.Read`, scoped by Exchange RBAC to that one
 * mailbox). Everything that decides lives in `handler.ts`; this file wires
 * the service-role client, env, clock and sleep.
 *
 * Auth: `x-cron-secret` must equal env `DOCUMENT_INTAKE_MAIL_SYNC_SECRET`.
 * Env: MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { withTiming } from "../_shared/structured-log.ts";
import { handleMailSyncRequest, type MailDb, type Mailbox } from "./handler.ts";

Deno.serve(async (req) => {
  const t = withTiming("document-intake-mail-sync");
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const db: MailDb = {
    async rpc(fn, args) {
      const { data, error } = await admin.rpc(fn, args);
      return { data, error: error ? { code: error.code, message: error.message } : null };
    },
    async activeMailboxes() {
      const { data, error } = await admin
        .from("document_intake_mailboxes")
        .select("id, organization_id, address, folders, cursors")
        .eq("active", true)
        .order("created_at");
      return { data: (data ?? null) as Mailbox[] | null, error: error ? { code: error.code, message: error.message } : null };
    },
    async findMessage(mailboxId, providerMessageId) {
      const { data, error } = await admin
        .from("document_intake_messages")
        .select("id, status")
        .eq("mailbox_id", mailboxId)
        .eq("provider_message_id", providerMessageId)
        .maybeSingle();
      return { data, error: error ? { code: error.code, message: error.message } : null };
    },
    async upload(bucket, path, bytes, contentType) {
      const { error } = await admin.storage.from(bucket).upload(path, bytes, { contentType, upsert: false });
      if (!error) return "stored";
      const status = String((error as { statusCode?: string | number }).statusCode ?? "");
      return status === "409" || /already exists/i.test(error.message) ? "exists" : "failed";
    },
    async download(bucket, path) {
      const { data, error } = await admin.storage.from(bucket).download(path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
  };
  return await handleMailSyncRequest(req, {
    db,
    env: (name) => Deno.env.get(name),
    fetch: (input, init) => fetch(input, init),
    now: () => new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: t.log,
  });
});
