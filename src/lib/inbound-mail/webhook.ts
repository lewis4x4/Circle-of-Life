import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getAttachmentDownloadUrl } from "./agentmail";
import { verifySvixSignature } from "./svix";

export const INBOUND_MAIL_BUCKET = "inbound-mail";
export const INBOUND_MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png"]);
const MAX_BODY = 5 * 1024 * 1024;

const eventSchema = z.object({
  event_type: z.string(),
  event_id: z.string().max(300).optional(),
  message: z.object({
    inbox_id: z.string().min(1).max(300),
    message_id: z.string().min(1).max(500),
    from: z.string().max(320).optional(),
    to: z.array(z.string().max(320)).max(100).optional(),
    subject: z.string().max(5000).optional(),
    text: z.string().optional(),
    extracted_text: z.string().optional(),
    timestamp: z.string().optional(),
    created_at: z.string().optional(),
    attachments: z.array(z.object({
      attachment_id: z.string().min(1).max(500),
      filename: z.string().max(1000).optional(),
      content_type: z.string().max(200).optional(),
      size: z.number().int().min(0).optional(),
    }).passthrough()).max(50).optional(),
  }).passthrough(),
}).passthrough();

type Deps = {
  secret: string | undefined;
  apiKey: string | undefined;
  now?: number;
  fetchBytes?: (url: string) => Promise<Uint8Array>;
  downloadUrl?: typeof getAttachmentDownloadUrl;
  store?: (path: string, bytes: Uint8Array, contentType: string) => Promise<void>;
  record?: (payload: Record<string, unknown>) => Promise<{ recorded: boolean; reason?: string }>;
};

/** Logs carry outcome codes only — never addresses, subjects, names or bodies. */
function log(outcome: string, extra: Record<string, string | number | boolean> = {}) {
  console.info(JSON.stringify({ event: "agentmail_webhook", outcome, ...extra }));
}

async function defaultFetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`attachment download ${response.status}`);
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > INBOUND_MAX_ATTACHMENT_BYTES) throw new Error("attachment too large");
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Receives an AgentMail `message.received` delivery: verifies the Svix signature, stores allowed
 * attachments in the private bucket, and records the message once through the service-only RPC,
 * which builds the Medicaid proposal. Non-2xx means "retry" to Svix; recording is idempotent per message.
 */
export async function handleAgentMailWebhook(request: Request, deps: Deps): Promise<Response> {
  if (!deps.secret || !deps.apiKey) { log("not_configured"); return NextResponse.json({ error: "Inbound mail is not configured" }, { status: 503 }); }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return NextResponse.json({ error: "Too large" }, { status: 413 });
  const raw = await request.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "Too large" }, { status: 413 });
  const ok = verifySvixSignature(deps.secret, { id: request.headers.get("svix-id"), timestamp: request.headers.get("svix-timestamp"), signature: request.headers.get("svix-signature") }, raw, deps.now);
  if (!ok) { log("bad_signature"); return NextResponse.json({ error: "Invalid signature" }, { status: 401 }); }
  let event: z.infer<typeof eventSchema>;
  try { event = eventSchema.parse(JSON.parse(raw)); } catch { log("bad_payload"); return NextResponse.json({ error: "Invalid payload" }, { status: 400 }); }
  if (event.event_type !== "message.received") { log("ignored_event"); return NextResponse.json({ ignored: true }); }
  const m = event.message;
  const store = deps.store ?? (async (path, bytes, contentType) => {
    const { error } = await createServiceRoleClient().storage.from(INBOUND_MAIL_BUCKET).upload(path, bytes, { contentType, upsert: false });
    if (error && !/exists|duplicate/i.test(error.message)) throw new Error("storage upload failed");
  });
  const attachments: Array<Record<string, unknown>> = [];
  for (const a of m.attachments ?? []) {
    const contentType = (a.content_type ?? "application/octet-stream").split(";")[0]!.trim().toLowerCase();
    const base = { filename: (a.filename ?? "attachment").slice(0, 255), content_type: contentType, size_bytes: a.size ?? 0 };
    if (!ALLOWED.has(contentType)) { attachments.push({ ...base, status: "skipped_type" }); continue; }
    if ((a.size ?? 0) > INBOUND_MAX_ATTACHMENT_BYTES) { attachments.push({ ...base, status: "skipped_size" }); continue; }
    try {
      const url = await (deps.downloadUrl ?? getAttachmentDownloadUrl)(deps.apiKey, m.inbox_id, m.message_id, a.attachment_id);
      const bytes = await (deps.fetchBytes ?? defaultFetchBytes)(url);
      if (bytes.length > INBOUND_MAX_ATTACHMENT_BYTES) { attachments.push({ ...base, size_bytes: bytes.length, status: "skipped_size" }); continue; }
      // Storage paths carry provider ids only, never names or filenames.
      const path = `agentmail/${createHash("sha256").update(m.inbox_id).digest("hex").slice(0, 16)}/${createHash("sha256").update(`${m.message_id}/${a.attachment_id}`).digest("hex")}`;
      await store(path, bytes, contentType);
      attachments.push({ ...base, size_bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), storage_path: path, status: "stored" });
    } catch {
      attachments.push({ ...base, status: "failed" });
    }
  }
  const payload = {
    provider_inbox_id: m.inbox_id, provider_message_id: m.message_id, provider_event_id: event.event_id ?? null,
    from: m.from ?? null, to: m.to ?? [], subject: m.subject ?? null, text: (m.extracted_text || m.text || "").slice(0, 200_000),
    received_at: m.timestamp ?? m.created_at ?? null, attachments,
  };
  try {
    const result = deps.record
      ? await deps.record(payload)
      : await createServiceRoleClient().rpc("inbound_mail_record" as never, { p_payload: payload } as never).then(({ data, error }) => { if (error) throw new Error("record failed"); return data as unknown as { recorded: boolean; reason?: string }; });
    log(result.recorded ? "recorded" : result.reason ?? "not_recorded", { attachments: attachments.length });
    return NextResponse.json({ ok: true });
  } catch {
    log("record_failed");
    return NextResponse.json({ error: "Retry" }, { status: 500 });
  }
}
