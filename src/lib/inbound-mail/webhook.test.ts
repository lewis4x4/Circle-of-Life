import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { verifySvixSignature } from "./svix";
import { handleAgentMailWebhook } from "./webhook";

const key = Buffer.from("synthetic-signing-key-32-bytes!!");
const secret = `whsec_${key.toString("base64")}`;
const now = 1_790_000_000;
function sign(body: string, id = "msg_1", ts = String(now)) {
  return { id, timestamp: ts, signature: `v1,${createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64")}` };
}
function request(body: string, headers = sign(body)) {
  return new Request("http://localhost/api/webhooks/agentmail", { method: "POST", body, headers: { "svix-id": headers.id, "svix-timestamp": headers.timestamp, "svix-signature": headers.signature } });
}
const event = (over: Record<string, unknown> = {}) => JSON.stringify({ event_type: "message.received", event_id: "evt_1", message: { inbox_id: "inbox_1", message_id: "m_1", from: "dcf@example.invalid", to: ["a@example.invalid"], subject: "Pending verification", text: "body", attachments: [], ...over } });

describe("Svix signature", () => {
  it("accepts a correct signature among several and rejects tampering, old timestamps and wrong secrets", () => {
    const body = event();
    const good = sign(body);
    expect(verifySvixSignature(secret, { ...good, signature: `v1,AAAA ${good.signature}` }, body, now)).toBe(true);
    expect(verifySvixSignature(secret, good, `${body} `, now)).toBe(false);
    expect(verifySvixSignature(secret, good, body, now + 301)).toBe(false);
    expect(verifySvixSignature(`whsec_${Buffer.from("other-key").toString("base64")}`, good, body, now)).toBe(false);
    expect(verifySvixSignature("not-a-secret", good, body, now)).toBe(false);
    expect(verifySvixSignature(secret, { ...good, signature: null }, body, now)).toBe(false);
  });
});

describe("AgentMail webhook", () => {
  const base = { secret, apiKey: "key", now };
  it("refuses when not configured and when the signature is wrong, recording nothing", async () => {
    const record = vi.fn();
    expect((await handleAgentMailWebhook(request(event()), { ...base, secret: undefined, record })).status).toBe(503);
    const body = event();
    expect((await handleAgentMailWebhook(request(body, { ...sign(body), signature: "v1,Zm9v" }), { ...base, record })).status).toBe(401);
    expect(record).not.toHaveBeenCalled();
  });
  it("ignores other event types", async () => {
    const record = vi.fn();
    const body = JSON.stringify({ event_type: "message.sent", message: { inbox_id: "i", message_id: "m" } });
    expect((await handleAgentMailWebhook(request(body), { ...base, record })).status).toBe(200);
    expect(record).not.toHaveBeenCalled();
  });
  it("stores allowed attachments under id-only paths, skips other types, and records once", async () => {
    const store = vi.fn().mockResolvedValue(undefined);
    const record = vi.fn().mockResolvedValue({ recorded: true });
    const body = event({ attachments: [
      { attachment_id: "a1", filename: "Resident Letter.pdf", content_type: "application/pdf", size: 5 },
      { attachment_id: "a2", filename: "notes.docx", content_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 5 },
    ] });
    const response = await handleAgentMailWebhook(request(body), { ...base, store, record, downloadUrl: async () => "https://cdn.example.invalid/a1", fetchBytes: async () => new Uint8Array([37, 80, 68, 70, 45]) });
    expect(response.status).toBe(200);
    expect(store).toHaveBeenCalledTimes(1);
    expect(store.mock.calls[0]![0]).toMatch(/^agentmail\/[0-9a-f]{16}\/[0-9a-f]{64}$/);
    expect(store.mock.calls[0]![0]).not.toContain("Resident");
    const payload = record.mock.calls[0]![0];
    expect(payload).toMatchObject({ provider_inbox_id: "inbox_1", provider_message_id: "m_1", subject: "Pending verification" });
    expect(payload.attachments.map((a: { status: string }) => a.status)).toEqual(["stored", "skipped_type"]);
  });
  it("asks Svix to retry when recording fails", async () => {
    const response = await handleAgentMailWebhook(request(event()), { ...base, record: vi.fn().mockRejectedValue(new Error("db down")) });
    expect(response.status).toBe(500);
  });
});
