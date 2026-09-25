/**
 * document-intake-mail-sync/handler — one cron tick of the Document Intake
 * mail receiver (COL-771, DI-06). Pure module: database, fetch, env, clock and
 * sleep are injected.
 *
 * For each active mailbox and folder: Microsoft Graph delta query from the
 * stored cursor. Every new message is stored first (raw .eml + sha256), its
 * first-hop authentication read from the receiving tenant's own
 * Authentication-Results header, and each accepted attachment becomes one
 * byte-verified intake item. The folder cursor advances only after every
 * message of the round has a stored receipt or a recorded exception; any
 * failure leaves the cursor where it was so the next round sees the same
 * messages again (every step is idempotent).
 *
 * Read-only against the mailbox: no Mail.Send, no move, no delete. A message
 * the provider reports as removed never deletes stored evidence.
 * Logs carry ids, codes and counts only — never subjects, names or bodies.
 */

import PostalMime from "npm:postal-mime@2.4.4";
import { PDFDocument } from "npm:pdf-lib@1.17.1";
import { DOCUMENT_INTAKE_BUCKET, DOCUMENT_INTAKE_MAX_SOURCE_BYTES } from "../_shared/document-intake-contract.ts";

export const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const DELTA_SELECT = "$select=id,internetMessageId,receivedDateTime,from,subject,hasAttachments";
export const MAX_RAW_BYTES = 60 * 1024 * 1024;
export const INLINE_IMAGE_SKIP_BYTES = 20 * 1024;
export const MAX_RETRY_AFTER_SECONDS = 30;
export const MAX_GRAPH_ATTEMPTS = 4;
export const MAX_PAGES_PER_FOLDER = 50;
/** Stop starting new work after this long; unfinished rounds keep their cursor. */
export const TICK_BUDGET_MS = 110_000;

// ── Injected surfaces ───────────────────────────────────────────────────────

export type DbError = { code?: string; message?: string };

export type Mailbox = {
  id: string;
  organization_id: string;
  address: string;
  folders: string[];
  cursors: Record<string, string>;
};

export type UploadOutcome = "stored" | "exists" | "failed";

export interface MailDb {
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: DbError | null }>;
  activeMailboxes(): Promise<{ data: Mailbox[] | null; error: DbError | null }>;
  findMessage(mailboxId: string, providerMessageId: string): Promise<{ data: { id: string; status: string } | null; error: DbError | null }>;
  /** Upload with upsert false. "exists" when an object is already at the path. */
  upload(bucket: string, path: string, bytes: Uint8Array, contentType: string): Promise<UploadOutcome>;
  download(bucket: string, path: string): Promise<Uint8Array | null>;
}

export type LogFn = (entry: { event: string; outcome?: "success" | "blocked" | "error"; [key: string]: unknown }) => void;

export type MailDeps = {
  db: MailDb;
  env: (name: string) => string | undefined;
  fetch: typeof fetch;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  log: LogFn;
};

export type MailSummary = {
  ok: boolean;
  outcome?: "blocked";
  reason?: string;
  mailboxes: number;
  folders: number;
  folders_advanced: number;
  folders_failed: number;
  cursor_restarts: number;
  messages_seen: number;
  messages_stored: number;
  messages_already_done: number;
  items_created: number;
  exceptions: number;
};

/** A failure that must stop the round without advancing the cursor. */
export class SyncFailure extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

// ── Bytes ───────────────────────────────────────────────────────────────────

export async function sha256Hex(bytes: Uint8Array | string): Promise<string> {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  const digest = await crypto.subtle.digest("SHA-256", data as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  return sig.every((b, i) => bytes[offset + i] === b);
}
function ascii(bytes: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...bytes.subarray(from, to));
}

export type Sniffed = { kind: "document"; mime: string } | { kind: "archive" } | { kind: "other" };

/** Content decides; file names and declared types never do. */
export function sniff(bytes: Uint8Array): Sniffed {
  if (bytes.length < 12) return { kind: "other" };
  if (ascii(bytes, 0, Math.min(bytes.length, 1024)).includes("%PDF-")) return { kind: "document", mime: "application/pdf" };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { kind: "document", mime: "image/jpeg" };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: "document", mime: "image/png" };
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return { kind: "document", mime: "image/webp" };
  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])) return { kind: "document", mime: "image/tiff" };
  if (ascii(bytes, 4, 8) === "ftyp") {
    const brand = ascii(bytes, 8, 12);
    if (["heic", "heix", "hevc", "hevx", "heim", "heis"].includes(brand)) return { kind: "document", mime: "image/heic" };
    if (["mif1", "msf1"].includes(brand)) return { kind: "document", mime: "image/heif" };
  }
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    // Office files are zips whose first entry is [Content_Types].xml; they are
    // not documents we accept, but they are not archives to open either.
    const nameLength = bytes[26] | (bytes[27] << 8);
    const firstEntry = ascii(bytes, 30, 30 + Math.min(nameLength, 64));
    return firstEntry === "[Content_Types].xml" || firstEntry.startsWith("mimetype") ? { kind: "other" } : { kind: "archive" };
  }
  return { kind: "other" };
}

function containsAscii(bytes: Uint8Array, needle: string): boolean {
  const n = new TextEncoder().encode(needle);
  outer: for (let i = 0; i <= bytes.length - n.length; i++) {
    for (let j = 0; j < n.length; j++) if (bytes[i + j] !== n[j]) continue outer;
    return true;
  }
  return false;
}

/** Page count, or `encrypted`. A PDF pdf-lib cannot parse is still preserved (null pages). */
export async function inspectPdf(bytes: Uint8Array): Promise<{ encrypted: boolean; pages: number | null }> {
  if (containsAscii(bytes, "/Encrypt")) return { encrypted: true, pages: null };
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    return { encrypted: false, pages: doc.getPageCount() };
  } catch (error) {
    if (error instanceof Error && /encrypt/i.test(error.message + error.name)) return { encrypted: true, pages: null };
    return { encrypted: false, pages: null };
  }
}

// ── First-hop authentication ────────────────────────────────────────────────

export type HeaderLine = { key: string; value: string };

/**
 * The receiving tenant stamps its Authentication-Results at the top of the
 * message; anything below it was written by hops we do not trust. The sender
 * counts as authenticated only on that first header's dmarc=pass, or when
 * Exchange marks the message as internal to the tenant.
 */
export function firstHopAuthentication(headers: HeaderLine[]): { authenticated: boolean; results: string | null } {
  const first = headers.find((h) => h.key.toLowerCase() === "authentication-results");
  const internal = headers.some((h) => h.key.toLowerCase() === "x-ms-exchange-organization-authas" && h.value.trim().toLowerCase() === "internal");
  const results = first ? first.value.slice(0, 8000) : null;
  return { authenticated: internal || Boolean(results && /\bdmarc=pass\b/i.test(results)), results };
}

// ── Graph ───────────────────────────────────────────────────────────────────

async function graphToken(deps: MailDeps, tenant: string, clientId: string, secret: string): Promise<string> {
  let response: Response;
  try {
    response = await deps.fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: secret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new SyncFailure("graph_token_unreachable");
  }
  if (!response.ok) {
    await response.text().catch(() => "");
    throw new SyncFailure(`graph_token_http_${response.status}`);
  }
  const body = await response.json().catch(() => null) as { access_token?: string } | null;
  if (!body?.access_token) throw new SyncFailure("graph_token_invalid");
  return body.access_token;
}

/** GET with bounded Retry-After handling for 429/503. Returns the final response. */
async function graphGet(deps: MailDeps, token: string, url: string): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    let response: Response;
    try {
      response = await deps.fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
    } catch {
      throw new SyncFailure("graph_unreachable");
    }
    if ((response.status === 429 || response.status === 503) && attempt < MAX_GRAPH_ATTEMPTS) {
      await response.text().catch(() => "");
      const retryAfter = Number(response.headers.get("retry-after"));
      const seconds = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, MAX_RETRY_AFTER_SECONDS) : 2 ** attempt;
      await deps.sleep(seconds * 1000);
      continue;
    }
    return response;
  }
}

async function isSyncStateGone(response: Response): Promise<boolean> {
  if (response.status === 410) return true;
  if (response.status !== 400 && response.status !== 404) return false;
  const body = await response.clone().json().catch(() => null) as { error?: { code?: string } } | null;
  const code = body?.error?.code?.toLowerCase() ?? "";
  return code === "syncstatenotfound" || code === "resyncrequired" || code === "syncstateinvalid";
}

type DeltaMessage = { id: string; internetMessageId?: string; receivedDateTime?: string; "@removed"?: unknown };

// ── One message ─────────────────────────────────────────────────────────────

type MessageOutcome = { status: "itemized" | "no_documents" | "exception" | "already_done"; items: number; exception: string | null };

async function storeObject(deps: MailDeps, path: string, bytes: Uint8Array, sha: string, contentType: string): Promise<void> {
  const outcome = await deps.db.upload(DOCUMENT_INTAKE_BUCKET, path, bytes, contentType);
  if (outcome === "stored") return;
  if (outcome === "exists") {
    const existing = await deps.db.download(DOCUMENT_INTAKE_BUCKET, path);
    if (existing && (await sha256Hex(existing)) === sha) return;
    throw new SyncFailure("stored_object_mismatch");
  }
  throw new SyncFailure("storage_upload_failed");
}

async function rpc(deps: MailDeps, fn: string, args: Record<string, unknown>, code: string): Promise<unknown> {
  const { data, error } = await deps.db.rpc(fn, args);
  if (error) throw new SyncFailure(code);
  return data;
}

function safeFileName(name: string | null | undefined, index: number, mime: string): string {
  const cleaned = Array.from(name ?? "", (ch) => (ch === "/" || ch === "\\" || ch.charCodeAt(0) < 0x20 ? "_" : ch)).join("").trim().slice(0, 255);
  if (cleaned) return cleaned;
  const ext = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/tiff": "tif", "image/heic": "heic", "image/heif": "heif" }[mime] ?? "bin";
  return `attachment-${index + 1}.${ext}`;
}

type ParsedAttachment = { filename?: string | null; disposition?: string | null; related?: boolean; contentId?: string | null; content: ArrayBuffer | Uint8Array | string };

export async function processMessage(deps: MailDeps, token: string, mailbox: Mailbox, folder: string, message: DeltaMessage): Promise<MessageOutcome> {
  const existing = await deps.db.findMessage(mailbox.id, message.id);
  if (existing.error) throw new SyncFailure("message_lookup_failed");
  if (existing.data && existing.data.status !== "stored") return { status: "already_done", items: 0, exception: null };

  // 1. The raw message, stored before anything is parsed.
  const rawResponse = await graphGet(deps, token, `${GRAPH_BASE}/users/${encodeURIComponent(mailbox.address)}/messages/${encodeURIComponent(message.id)}/$value`);
  if (!rawResponse.ok) {
    await rawResponse.text().catch(() => "");
    throw new SyncFailure(`graph_message_http_${rawResponse.status}`);
  }
  const raw = new Uint8Array(await rawResponse.arrayBuffer());
  const base = {
    folder,
    provider_message_id: message.id,
    internet_message_id: message.internetMessageId?.slice(0, 998) ?? null,
    received_at: message.receivedDateTime ?? null,
  };
  if (raw.length > MAX_RAW_BYTES) {
    await rpc(deps, "document_intake_worker_record_message", { p_mailbox: mailbox.id, p_payload: { ...base, raw_size_bytes: raw.length, status: "exception", exception_code: "message_too_large" } }, "record_message_failed");
    return { status: "exception", items: 0, exception: "message_too_large" };
  }
  const rawSha = await sha256Hex(raw);
  const rawPath = `${mailbox.organization_id}/mail/${mailbox.id}/${await sha256Hex(message.id)}.eml`;
  await storeObject(deps, rawPath, raw, rawSha, "message/rfc822");

  // 2. Who sent it, as the receiving tenant saw it.
  let parsed: { headers?: HeaderLine[]; from?: { address?: string }; subject?: string; attachments?: ParsedAttachment[] };
  try {
    parsed = await PostalMime.parse(raw, { attachmentEncoding: "arraybuffer" }) as unknown as typeof parsed;
  } catch {
    await rpc(deps, "document_intake_worker_record_message", {
      p_mailbox: mailbox.id,
      p_payload: { ...base, raw_path: rawPath, raw_sha256: rawSha, raw_size_bytes: raw.length, status: "exception", exception_code: "unparseable_message" },
    }, "record_message_failed");
    return { status: "exception", items: 0, exception: "unparseable_message" };
  }
  const auth = firstHopAuthentication(parsed.headers ?? []);
  const sender = parsed.from?.address?.trim().toLowerCase() || null;
  const payload = {
    ...base,
    sender_address: sender ? sender.slice(0, 320) : null,
    sender_authenticated: auth.authenticated,
    authentication_results: auth.results,
    subject_hash: await sha256Hex(parsed.subject ?? ""),
    raw_path: rawPath,
    raw_sha256: rawSha,
    raw_size_bytes: raw.length,
  };
  const stored = await rpc(deps, "document_intake_worker_record_message", { p_mailbox: mailbox.id, p_payload: { ...payload, part_count: 0, status: "stored" } }, "record_message_failed") as { id?: string } | null;
  if (!stored?.id) throw new SyncFailure("record_message_failed");

  // 3. Attachments, accepted by content.
  const accepted: { bytes: Uint8Array; mime: string; fileName: string }[] = [];
  const exceptions: string[] = [];
  const attachments = parsed.attachments ?? [];
  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i];
    const bytes = typeof att.content === "string" ? new TextEncoder().encode(att.content) : new Uint8Array(att.content);
    const kind = sniff(bytes);
    if (kind.kind === "archive") {
      exceptions.push("archive_not_opened");
      continue;
    }
    if (kind.kind !== "document") continue;
    const inline = att.disposition === "inline" || att.related === true || Boolean(att.contentId);
    if (inline && kind.mime !== "application/pdf" && bytes.length < INLINE_IMAGE_SKIP_BYTES) continue;
    if (bytes.length > DOCUMENT_INTAKE_MAX_SOURCE_BYTES) {
      exceptions.push("attachment_too_large");
      continue;
    }
    accepted.push({ bytes, mime: kind.mime, fileName: safeFileName(att.filename, i, kind.mime) });
  }

  let items = 0;
  let parts = 0;
  for (const part of accepted) {
    let pages: number | null = 1;
    if (part.mime === "application/pdf") {
      const pdf = await inspectPdf(part.bytes);
      if (pdf.encrypted) {
        exceptions.push("encrypted_attachment");
        continue;
      }
      pages = pdf.pages;
    }
    const sha = await sha256Hex(part.bytes);
    const created = await rpc(deps, "document_intake_worker_create_mail_item", {
      p_message: stored.id,
      p_payload: { file_name: part.fileName, mime: part.mime, size_bytes: part.bytes.length, sha256: sha },
    }, "create_mail_item_failed") as { item_id: string; path: string; existing: boolean; verified: boolean };
    if (!created.verified) {
      await storeObject(deps, created.path, part.bytes, sha, part.mime);
      await rpc(deps, "document_intake_attest_source", {
        p_item: created.item_id,
        p_object_id: null,
        p_size: part.bytes.length,
        p_mime: part.mime,
        p_sha256: sha,
        p_page_count: pages,
      }, "attest_source_failed");
    }
    // Idempotent: a no-op for an item already released.
    await rpc(deps, "document_intake_worker_release_mail_item", { p_item: created.item_id }, "release_mail_item_failed");
    parts++;
    if (!created.existing) items++;
  }

  const exception = exceptions[0] ?? null;
  const status = exception ? "exception" : parts > 0 ? "itemized" : "no_documents";
  await rpc(deps, "document_intake_worker_record_message", {
    p_mailbox: mailbox.id,
    p_payload: { ...payload, part_count: parts, status, exception_code: exception },
  }, "record_message_failed");
  return { status, items, exception };
}

// ── One folder ──────────────────────────────────────────────────────────────

async function syncFolder(deps: MailDeps, token: string, mailbox: Mailbox, folder: string, summary: MailSummary, deadline: number): Promise<void> {
  const initial = `${GRAPH_BASE}/users/${encodeURIComponent(mailbox.address)}/mailFolders/${encodeURIComponent(folder)}/messages/delta?${DELTA_SELECT}`;
  let url = mailbox.cursors?.[folder] || initial;
  let restarted = false;
  const seen = new Set<string>();
  let deltaLink: string | null = null;

  for (let page = 0; page < MAX_PAGES_PER_FOLDER; page++) {
    if (deps.now().getTime() > deadline) throw new SyncFailure("tick_budget_exhausted");
    const response = await graphGet(deps, token, url);
    if (await isSyncStateGone(response)) {
      await response.text().catch(() => "");
      if (restarted) throw new SyncFailure("delta_restart_failed");
      // The provider forgot our cursor: start over from the beginning. Every
      // message already stored is skipped by its manifest row.
      restarted = true;
      summary.cursor_restarts++;
      await deps.db.rpc("document_intake_worker_mailbox_state", { p_mailbox: mailbox.id, p_folder: folder, p_cursor: null, p_succeeded: false, p_error: "delta_cursor_expired" });
      deps.log({ event: "delta_restart", mailbox_id: mailbox.id });
      url = initial;
      page = -1;
      continue;
    }
    if (!response.ok) {
      await response.text().catch(() => "");
      throw new SyncFailure(`graph_delta_http_${response.status}`);
    }
    const body = await response.json().catch(() => null) as { value?: DeltaMessage[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string } | null;
    if (!body || !Array.isArray(body.value)) throw new SyncFailure("graph_delta_invalid");
    for (const message of body.value) {
      if (!message?.id || message["@removed"] !== undefined) continue;
      if (seen.has(message.id)) continue;
      seen.add(message.id);
      summary.messages_seen++;
      if (deps.now().getTime() > deadline) throw new SyncFailure("tick_budget_exhausted");
      const outcome = await processMessage(deps, token, mailbox, folder, message);
      if (outcome.status === "already_done") {
        summary.messages_already_done++;
      } else {
        summary.messages_stored++;
        summary.items_created += outcome.items;
        if (outcome.exception) summary.exceptions++;
      }
    }
    if (body["@odata.nextLink"]) {
      url = body["@odata.nextLink"];
      continue;
    }
    deltaLink = body["@odata.deltaLink"] ?? null;
    break;
  }
  if (!deltaLink) throw new SyncFailure("delta_incomplete");
  const { error } = await deps.db.rpc("document_intake_worker_mailbox_state", { p_mailbox: mailbox.id, p_folder: folder, p_cursor: deltaLink, p_succeeded: true, p_error: null });
  if (error) throw new SyncFailure("cursor_save_failed");
}

// ── The tick ────────────────────────────────────────────────────────────────

export async function runMailSync(deps: MailDeps): Promise<MailSummary> {
  const summary: MailSummary = {
    ok: true,
    mailboxes: 0,
    folders: 0,
    folders_advanced: 0,
    folders_failed: 0,
    cursor_restarts: 0,
    messages_seen: 0,
    messages_stored: 0,
    messages_already_done: 0,
    items_created: 0,
    exceptions: 0,
  };
  const deadline = deps.now().getTime() + TICK_BUDGET_MS;
  const { data: mailboxes, error } = await deps.db.activeMailboxes();
  if (error || !mailboxes) {
    deps.log({ event: "mailboxes_unavailable", outcome: "error", error_code: error?.code });
    return { ...summary, ok: false };
  }
  summary.mailboxes = mailboxes.length;
  const foldersOf = (m: Mailbox) => (m.folders?.length ? m.folders : ["inbox"]);

  const tenant = deps.env("MS_GRAPH_TENANT_ID")?.trim();
  const clientId = deps.env("MS_GRAPH_CLIENT_ID")?.trim();
  const secret = deps.env("MS_GRAPH_CLIENT_SECRET")?.trim();
  if (!tenant || !clientId || !secret) {
    for (const mailbox of mailboxes) {
      for (const folder of foldersOf(mailbox)) {
        await deps.db.rpc("document_intake_worker_mailbox_state", { p_mailbox: mailbox.id, p_folder: folder, p_cursor: null, p_succeeded: false, p_error: "graph_not_configured" });
      }
    }
    return { ...summary, outcome: "blocked", reason: "graph_not_configured" };
  }
  if (mailboxes.length === 0) return summary;

  let token: string;
  try {
    token = await graphToken(deps, tenant, clientId, secret);
  } catch (caught) {
    const code = caught instanceof SyncFailure ? caught.code : "graph_token_failed";
    for (const mailbox of mailboxes) {
      for (const folder of foldersOf(mailbox)) {
        await deps.db.rpc("document_intake_worker_mailbox_state", { p_mailbox: mailbox.id, p_folder: folder, p_cursor: null, p_succeeded: false, p_error: code });
      }
    }
    deps.log({ event: "graph_token_failed", outcome: "error", error_code: code });
    return { ...summary, ok: false };
  }

  for (const mailbox of mailboxes) {
    for (const folder of foldersOf(mailbox)) {
      summary.folders++;
      try {
        await syncFolder(deps, token, mailbox, folder, summary, deadline);
        summary.folders_advanced++;
      } catch (caught) {
        const code = caught instanceof SyncFailure ? caught.code : "sync_error";
        summary.folders_failed++;
        if (code !== "tick_budget_exhausted") summary.ok = false;
        await deps.db.rpc("document_intake_worker_mailbox_state", { p_mailbox: mailbox.id, p_folder: folder, p_cursor: null, p_succeeded: false, p_error: code });
        deps.log({ event: "folder_failed", outcome: "error", mailbox_id: mailbox.id, error_code: code });
      }
    }
  }
  return summary;
}

// ── Request entry point ─────────────────────────────────────────────────────

function sameSecret(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

export async function handleMailSyncRequest(req: Request, deps: MailDeps): Promise<Response> {
  const json = (body: Record<string, unknown>, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  const secret = deps.env("DOCUMENT_INTAKE_MAIL_SYNC_SECRET");
  const header = req.headers.get("x-cron-secret");
  if (!secret || secret.length < 16 || !header || !sameSecret(header, secret)) {
    deps.log({ event: "auth_failed", outcome: "error" });
    return json({ ok: false, error: "Unauthorized" }, 401);
  }
  const summary = await runMailSync(deps);
  deps.log({ event: "tick_done", outcome: summary.ok ? (summary.outcome ?? "success") : "error", ...summary });
  return json(summary, 200);
}
