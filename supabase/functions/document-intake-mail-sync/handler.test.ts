import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PDFDocument } from "npm:pdf-lib@1.17.1";
import {
  firstHopAuthentication,
  GRAPH_BASE,
  handleMailSyncRequest,
  type MailDeps,
  type Mailbox,
  runMailSync,
  sniff,
} from "./handler.ts";

const ORG = "00000000-0000-0000-0000-000000000001";
const MAILBOX = "40000000-0000-4000-8000-000000000001";
const HOMEWOOD = "00000000-0000-0000-0000-000000000301";
const ADDRESS = "docs@circleoflifecommunities.com";
// Synthetic fixture built at runtime so secret scanners never see a literal.
const SECRET = "m".repeat(40);
const DELTA_PATH = `${GRAPH_BASE}/users/${encodeURIComponent(ADDRESS)}/mailFolders/inbox/messages/delta`;

// ── Fixtures ────────────────────────────────────────────────────────────────

async function realPdf(pages = 2): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage();
  return await doc.save();
}

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/.{76}/g, "$&\r\n");
}

type Part = { name: string; type: string; bytes: Uint8Array; inline?: boolean };

function eml(opts: { from: string; auth?: string[]; internal?: boolean; subject?: string; parts: Part[] }): Uint8Array {
  const boundary = "b0undary";
  const headers = [
    ...(opts.auth ?? []).map((a) => `Authentication-Results: ${a}`),
    ...(opts.internal ? ["X-MS-Exchange-Organization-AuthAs: Internal"] : []),
    `From: Sender <${opts.from}>`,
    `To: ${ADDRESS}`,
    `Subject: ${opts.subject ?? "Scan for Jane Doe"}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  const body = [`--${boundary}`, "Content-Type: text/plain", "", "See attached.", ""];
  for (const p of opts.parts) {
    body.push(
      `--${boundary}`,
      `Content-Type: ${p.type}; name="${p.name}"`,
      `Content-Disposition: ${p.inline ? "inline" : "attachment"}; filename="${p.name}"`,
      ...(p.inline ? ["Content-ID: <sig@x>"] : []),
      "Content-Transfer-Encoding: base64",
      "",
      b64(p.bytes),
      "",
    );
  }
  body.push(`--${boundary}--`, "");
  return new TextEncoder().encode([...headers, "", ...body].join("\r\n"));
}

const PASS = "circleoflifecommunities.com; spf=pass smtp.mailfrom=copier.example; dkim=pass header.d=example; dmarc=pass action=none header.from=example";
const FAIL = "circleoflifecommunities.com; spf=fail smtp.mailfrom=evil.example; dkim=none; dmarc=fail action=none header.from=example";

// ── Fakes ───────────────────────────────────────────────────────────────────

type DeltaPage = { value: Array<Record<string, unknown>>; next?: string; delta?: string };

function world(opts: {
  mailbox?: Partial<Mailbox>;
  messages: Record<string, Uint8Array | number>;
  pages: Record<string, DeltaPage | number>;
  env?: Record<string, string>;
  routes?: Record<string, string>;
  graphResponses?: Record<string, Response[]>;
}) {
  const mailbox: Mailbox = { id: MAILBOX, organization_id: ORG, address: ADDRESS, folders: ["inbox"], cursors: {}, ...opts.mailbox };
  const env: Record<string, string> = {
    MS_GRAPH_TENANT_ID: "tenant",
    MS_GRAPH_CLIENT_ID: "client",
    MS_GRAPH_CLIENT_SECRET: "secret",
    DOCUMENT_INTAKE_MAIL_SYNC_SECRET: SECRET,
    ...opts.env,
  };
  const storage = new Map<string, Uint8Array>();
  const messages = new Map<string, Record<string, unknown> & { id: string }>();
  const items: Array<{ id: string; message_id: string; file_name: string; sha256: string; facility_id: string | null; path: string; verified: boolean; released: boolean; pages?: number | null }> = [];
  const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const fetched: string[] = [];
  const sleeps: number[] = [];
  const routes = opts.routes ?? { "copier@homewood.example": HOMEWOOD };

  const deps: MailDeps = {
    db: {
      rpc(fn, args) {
        rpcs.push({ fn, args });
        const p = args.p_payload as Record<string, unknown>;
        switch (fn) {
          case "document_intake_worker_record_message": {
            const key = String(p.provider_message_id);
            const prev = messages.get(key);
            const row = { ...(prev ?? {}), ...p, id: prev?.id ?? crypto.randomUUID() };
            messages.set(key, row);
            return Promise.resolve({ data: row, error: null });
          }
          case "document_intake_worker_create_mail_item": {
            const found = items.find((i) => i.message_id === args.p_message && i.file_name === p.file_name && i.sha256 === p.sha256);
            if (found) return Promise.resolve({ data: { item_id: found.id, path: found.path, existing: true, verified: found.verified }, error: null });
            const message = [...messages.values()].find((m) => m.id === args.p_message)!;
            const facility = message.sender_authenticated ? routes[String(message.sender_address)] ?? null : null;
            const id = crypto.randomUUID();
            const item = { id, message_id: String(args.p_message), file_name: String(p.file_name), sha256: String(p.sha256), facility_id: facility, path: `${ORG}/${facility ?? "unassigned"}/${id}/original`, verified: false, released: false };
            items.push(item);
            return Promise.resolve({ data: { item_id: id, path: item.path, existing: false, verified: false }, error: null });
          }
          case "document_intake_attest_source": {
            const item = items.find((i) => i.id === args.p_item)!;
            item.verified = true;
            item.pages = args.p_page_count as number | null;
            return Promise.resolve({ data: {}, error: null });
          }
          case "document_intake_worker_release_mail_item": {
            items.find((i) => i.id === args.p_item)!.released = true;
            return Promise.resolve({ data: null, error: null });
          }
          default:
            return Promise.resolve({ data: null, error: null });
        }
      },
      activeMailboxes: () => Promise.resolve({ data: [mailbox], error: null }),
      findMessage(_mailbox, providerId) {
        const m = messages.get(providerId);
        return Promise.resolve({ data: m ? { id: m.id, status: String(m.status) } : null, error: null });
      },
      upload(_bucket, path, bytes) {
        if (storage.has(path)) return Promise.resolve("exists");
        storage.set(path, bytes);
        return Promise.resolve("stored");
      },
      download: (_bucket, path) => Promise.resolve(storage.get(path) ?? null),
    },
    env: (name) => env[name],
    fetch: (input) => {
      const url = String(input);
      fetched.push(url);
      if (url.startsWith("https://login.microsoftonline.com/")) {
        return Promise.resolve(new Response(JSON.stringify({ access_token: "tok" }), { status: 200 }));
      }
      const queued = opts.graphResponses?.[url];
      if (queued?.length) return Promise.resolve(queued.shift()!);
      const value = /\/messages\/([^/]+)\/\$value$/.exec(url);
      if (value) {
        const m = opts.messages[decodeURIComponent(value[1])];
        if (typeof m === "number" || m === undefined) return Promise.resolve(new Response("", { status: typeof m === "number" ? m : 404 }));
        return Promise.resolve(new Response(m as Uint8Array<ArrayBuffer>, { status: 200 }));
      }
      const page = opts.pages[url];
      if (page === undefined) return Promise.resolve(new Response(JSON.stringify({ error: { code: "notFound" } }), { status: 404 }));
      if (typeof page === "number") return Promise.resolve(new Response(JSON.stringify({ error: { code: "SyncStateNotFound" } }), { status: page }));
      return Promise.resolve(new Response(JSON.stringify({
        value: page.value,
        ...(page.next ? { "@odata.nextLink": page.next } : {}),
        ...(page.delta ? { "@odata.deltaLink": page.delta } : {}),
      }), { status: 200 }));
    },
    now: () => new Date("2026-09-25T15:00:00Z"),
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    log: () => {},
  };
  const states = () => rpcs.filter((r) => r.fn === "document_intake_worker_mailbox_state").map((r) => r.args);
  return { deps, storage, messages, items, rpcs, fetched, sleeps, states };
}

const INITIAL = `${DELTA_PATH}?$select=id,internetMessageId,receivedDateTime,from,subject,hasAttachments`;
const NEW_CURSOR = `${DELTA_PATH}?$deltatoken=new`;

function msg(id: string) {
  return { id, internetMessageId: `<${id}@example>`, receivedDateTime: "2026-09-25T14:00:00Z" };
}

// ── Tests ───────────────────────────────────────────────────────────────────

Deno.test("stores the raw message first, itemizes a PDF and advances the cursor", async () => {
  const pdf = await realPdf(3);
  const w = world({
    messages: { m1: eml({ from: "copier@homewood.example", auth: [PASS], parts: [{ name: "scan.pdf", type: "application/pdf", bytes: pdf }] }) },
    pages: { [INITIAL]: { value: [msg("m1")], delta: NEW_CURSOR } },
  });
  const summary = await runMailSync(w.deps);
  assertEquals([summary.ok, summary.messages_stored, summary.items_created, summary.folders_advanced], [true, 1, 1, 1]);
  const [item] = w.items;
  assertEquals([item.facility_id, item.verified, item.released, item.pages], [HOMEWOOD, true, true, 3]);
  assert(w.storage.has(item.path));
  const raw = [...w.storage.keys()].find((k) => k.endsWith(".eml"))!;
  assert(raw.startsWith(`${ORG}/mail/${MAILBOX}/`));
  const stored = w.messages.get("m1")!;
  assertEquals([stored.status, stored.sender_authenticated, stored.part_count], ["itemized", true, 1]);
  assert(!("subject" in stored));
  assertEquals((stored.subject_hash as string).length, 64);
  // Raw stored before the first manifest row, manifest before the item.
  const first = w.rpcs.findIndex((r) => r.fn === "document_intake_worker_record_message");
  assertEquals(w.rpcs[first].args.p_payload && (w.rpcs[first].args.p_payload as Record<string, unknown>).status, "stored");
  assertEquals(w.states().at(-1), { p_mailbox: MAILBOX, p_folder: "inbox", p_cursor: NEW_CURSOR, p_succeeded: true, p_error: null });
});

Deno.test("the cursor does not advance when one message of the round fails", async () => {
  const pdf = await realPdf();
  const w = world({
    messages: {
      m1: eml({ from: "copier@homewood.example", auth: [PASS], parts: [{ name: "a.pdf", type: "application/pdf", bytes: pdf }] }),
      m2: 500,
    },
    pages: { [INITIAL]: { value: [msg("m1"), msg("m2")], delta: NEW_CURSOR } },
  });
  const summary = await runMailSync(w.deps);
  assertEquals([summary.ok, summary.folders_failed, summary.folders_advanced], [false, 1, 0]);
  assert(!w.states().some((s) => s.p_succeeded === true));
  assertEquals(w.states().at(-1), { p_mailbox: MAILBOX, p_folder: "inbox", p_cursor: null, p_succeeded: false, p_error: "graph_message_http_500" });
  assertEquals(w.messages.get("m1")!.status, "itemized");
});

Deno.test("unauthenticated sender: the payload says so and the item has no facility", async () => {
  const pdf = await realPdf();
  const w = world({
    messages: {
      // A route exists for this address, but the first-hop result is dmarc=fail
      // (a lower, forged header claiming pass does not count).
      m1: eml({ from: "copier@homewood.example", auth: [FAIL, PASS], parts: [{ name: "a.pdf", type: "application/pdf", bytes: pdf }] }),
    },
    pages: { [INITIAL]: { value: [msg("m1")], delta: NEW_CURSOR } },
  });
  await runMailSync(w.deps);
  const payloads = w.rpcs.filter((r) => r.fn === "document_intake_worker_record_message").map((r) => r.args.p_payload as Record<string, unknown>);
  assert(payloads.every((p) => p.sender_authenticated === false));
  assertEquals(payloads[0].sender_address, "copier@homewood.example");
  assertEquals(w.items.length, 1);
  assertEquals(w.items[0].facility_id, null);
  assert(w.items[0].path.includes("/unassigned/"));
});

Deno.test("first-hop authentication rules", () => {
  assertEquals(firstHopAuthentication([{ key: "authentication-results", value: PASS }]).authenticated, true);
  assertEquals(firstHopAuthentication([{ key: "authentication-results", value: FAIL }, { key: "authentication-results", value: PASS }]).authenticated, false);
  assertEquals(firstHopAuthentication([{ key: "x-ms-exchange-organization-authas", value: "Internal" }]).authenticated, true);
  assertEquals(firstHopAuthentication([{ key: "x-ms-exchange-organization-authas", value: "Anonymous" }]).authenticated, false);
  assertEquals(firstHopAuthentication([]).authenticated, false);
});

Deno.test("an encrypted PDF is recorded as an exception, never itemized", async () => {
  const encrypted = new TextEncoder().encode("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R /Encrypt 5 0 R >>\n%%EOF");
  const w = world({
    messages: { m1: eml({ from: "copier@homewood.example", auth: [PASS], parts: [{ name: "locked.pdf", type: "application/pdf", bytes: encrypted }] }) },
    pages: { [INITIAL]: { value: [msg("m1")], delta: NEW_CURSOR } },
  });
  const summary = await runMailSync(w.deps);
  assertEquals(w.items.length, 0);
  const stored = w.messages.get("m1")!;
  assertEquals([stored.status, stored.exception_code, stored.part_count], ["exception", "encrypted_attachment", 0]);
  assertEquals([summary.exceptions, summary.folders_advanced], [1, 1]);
});

Deno.test("the same message on two delta pages yields one receipt", async () => {
  const pdf = await realPdf();
  const page2 = `${DELTA_PATH}?$skiptoken=p2`;
  const w = world({
    messages: { m1: eml({ from: "copier@homewood.example", auth: [PASS], parts: [{ name: "a.pdf", type: "application/pdf", bytes: pdf }] }) },
    pages: {
      [INITIAL]: { value: [msg("m1")], next: page2 },
      [page2]: { value: [msg("m1"), { id: "gone", "@removed": { reason: "deleted" } }], delta: NEW_CURSOR },
    },
  });
  const summary = await runMailSync(w.deps);
  assertEquals(summary.messages_seen, 1);
  assertEquals(w.fetched.filter((u) => u.includes("/messages/m1/$value")).length, 1);
  assertEquals(w.messages.size, 1);
  assertEquals(w.items.length, 1);
  // A second round over the same message is a no-op.
  const again = await runMailSync(w.deps);
  assertEquals([again.messages_already_done, again.items_created], [1, 0]);
  assertEquals(w.items.length, 1);
});

Deno.test("410 on the stored cursor restarts the folder without a cursor", async () => {
  const OLD = `${DELTA_PATH}?$deltatoken=old`;
  const pdf = await realPdf();
  const w = world({
    mailbox: { cursors: { inbox: OLD } },
    messages: { m1: eml({ from: "copier@homewood.example", auth: [PASS], parts: [{ name: "a.pdf", type: "application/pdf", bytes: pdf }] }) },
    pages: { [OLD]: 410, [INITIAL]: { value: [msg("m1")], delta: NEW_CURSOR } },
  });
  const summary = await runMailSync(w.deps);
  assertEquals([summary.ok, summary.cursor_restarts, summary.folders_advanced], [true, 1, 1]);
  const deltaCalls = w.fetched.filter((u) => u.includes("/messages/delta"));
  assertEquals(deltaCalls, [OLD, INITIAL]);
  assert(w.states().some((s) => s.p_error === "delta_cursor_expired" && s.p_cursor === null));
  assertEquals(w.states().at(-1)!.p_cursor, NEW_CURSOR);
});

Deno.test("429 waits for Retry-After (bounded) and continues", async () => {
  const w = world({
    messages: {},
    pages: { [INITIAL]: { value: [], delta: NEW_CURSOR } },
    graphResponses: { [INITIAL]: [new Response("", { status: 429, headers: { "Retry-After": "7" } }), new Response("", { status: 503, headers: { "Retry-After": "600" } })] },
  });
  const summary = await runMailSync(w.deps);
  assertEquals(w.sleeps, [7000, 30000]);
  assertEquals(summary.folders_advanced, 1);
});

Deno.test("archives are not opened; small inline signature images are skipped", async () => {
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Array(22).fill(0), 5, 0, 0, 0, ...new TextEncoder().encode("a.pdf"), ...new Array(40).fill(0)]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(500).fill(1)]);
  const w = world({
    messages: {
      m1: eml({ from: "someone@example.com", parts: [{ name: "docs.zip", type: "application/zip", bytes: zip }] }),
      m2: eml({ from: "someone@example.com", parts: [{ name: "logo.png", type: "image/png", bytes: png, inline: true }] }),
    },
    pages: { [INITIAL]: { value: [msg("m1"), msg("m2")], delta: NEW_CURSOR } },
  });
  await runMailSync(w.deps);
  assertEquals([w.messages.get("m1")!.status, w.messages.get("m1")!.exception_code], ["exception", "archive_not_opened"]);
  assertEquals(w.messages.get("m2")!.status, "no_documents");
  assertEquals(w.items.length, 0);
});

Deno.test("content decides the type, not the file name", () => {
  assertEquals(sniff(new TextEncoder().encode("%PDF-1.4 hello world")), { kind: "document", mime: "application/pdf" });
  assertEquals(sniff(new TextEncoder().encode("MZ executable pretending.pdf")), { kind: "other" });
  assertEquals(sniff(new Uint8Array([0, 0, 0, 0x18, ...new TextEncoder().encode("ftypheic"), 0, 0, 0, 0])), { kind: "document", mime: "image/heic" });
});

Deno.test("Graph not configured: recorded per mailbox, nothing fetched", async () => {
  const w = world({ messages: {}, pages: {}, env: { MS_GRAPH_CLIENT_SECRET: "" } });
  const summary = await runMailSync(w.deps);
  assertEquals([summary.outcome, summary.reason], ["blocked", "graph_not_configured"]);
  assertEquals(w.fetched, []);
  assertEquals(w.states(), [{ p_mailbox: MAILBOX, p_folder: "inbox", p_cursor: null, p_succeeded: false, p_error: "graph_not_configured" }]);
});

Deno.test("requests without the cron secret are refused", async () => {
  const w = world({ messages: {}, pages: {} });
  const res = await handleMailSyncRequest(new Request("http://x", { method: "POST", headers: { "x-cron-secret": "wrong" } }), w.deps);
  assertEquals(res.status, 401);
  assertEquals(w.fetched, []);
});
