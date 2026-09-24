/** Minimal AgentMail REST client (https://docs.agentmail.to). Server-only; the key never reaches a browser. */
export const AGENTMAIL_API = process.env.AGENTMAIL_API_BASE ?? "https://api.agentmail.to/v0";

async function call<T>(apiKey: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${AGENTMAIL_API}${path}`, { ...init, headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...init?.headers }, cache: "no-store" });
  if (!response.ok) throw new Error(`AgentMail ${init?.method ?? "GET"} ${path.split("/")[1] ?? ""} failed with ${response.status}`);
  return (await response.json()) as T;
}

/** Signed CDN link for an attachment's bytes. */
export async function getAttachmentDownloadUrl(apiKey: string, inboxId: string, messageId: string, attachmentId: string): Promise<string> {
  const body = await call<{ download_url?: string }>(apiKey, `/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
  if (!body.download_url || !body.download_url.startsWith("https://")) throw new Error("AgentMail attachment has no secure download link");
  return body.download_url;
}

export async function createInbox(apiKey: string, input: { username: string; domain?: string; display_name: string; client_id: string }) {
  return call<{ inbox_id: string; email: string }>(apiKey, "/inboxes", { method: "POST", body: JSON.stringify(input) });
}

export async function createWebhook(apiKey: string, input: { url: string; event_types: string[]; client_id: string }) {
  return call<{ webhook_id?: string; secret?: string }>(apiKey, "/webhooks", { method: "POST", body: JSON.stringify(input) });
}
