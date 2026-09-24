#!/usr/bin/env node
/**
 * COL-771: create one Medicaid agency inbox per facility in AgentMail and register the webhook.
 * Prints the SQL that maps each inbox to its facility (apply with `supabase db query --linked`
 * after asserting the project ref), and the webhook signing secret to store as AGENTMAIL_WEBHOOK_SECRET.
 *
 * Usage:
 *   AGENTMAIL_API_KEY=... node scripts/inbound-mail/setup-agentmail-inboxes.mjs \
 *     --webhook-url https://<haven-host>/api/webhooks/agentmail \
 *     --org <organization uuid> --facility "<facility uuid>=<username>" [--facility ...] [--domain <verified domain>]
 * Re-running is safe: AgentMail client_id makes inbox and webhook creation idempotent.
 */
const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const facilities = args.flatMap((a, i) => (a === "--facility" ? [args[i + 1]] : [])).map((pair) => {
  const [id, username] = (pair ?? "").split("=");
  if (!/^[0-9a-f-]{36}$/i.test(id ?? "") || !/^[a-z0-9][a-z0-9.-]{1,60}$/.test(username ?? "")) throw new Error(`Bad --facility ${pair}; expected <uuid>=<username>`);
  return { id, username };
});
const apiKey = process.env.AGENTMAIL_API_KEY;
const base = process.env.AGENTMAIL_API_BASE ?? "https://api.agentmail.to/v0";
const webhookUrl = arg("--webhook-url");
const org = arg("--org");
const domain = arg("--domain");
if (!apiKey || !webhookUrl?.startsWith("https://") || !/^[0-9a-f-]{36}$/i.test(org ?? "") || facilities.length === 0) {
  console.error("Need AGENTMAIL_API_KEY, --webhook-url https://..., --org <uuid> and at least one --facility <uuid>=<username>.");
  process.exit(2);
}
async function call(path, body) {
  const response = await fetch(`${base}${path}`, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const text = await response.text();
  if (!response.ok) throw new Error(`AgentMail ${path} ${response.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}
const sql = [];
for (const f of facilities) {
  const inbox = await call("/inboxes", { username: f.username, ...(domain ? { domain } : {}), display_name: "Circle of Life Medicaid", client_id: `haven-medicaid-${f.id}` });
  console.error(`inbox ${inbox.email}`);
  const esc = (v) => String(v).replace(/'/g, "''");
  sql.push(`insert into public.inbound_mail_inboxes(organization_id,facility_id,purpose,provider_inbox_id,email) values ('${org}','${f.id}','medicaid_agency','${esc(inbox.inbox_id)}','${esc(inbox.email.toLowerCase())}') on conflict (provider_inbox_id) do update set email=excluded.email,updated_at=now();`);
}
const webhook = await call("/webhooks", { url: webhookUrl, event_types: ["message.received"], client_id: "haven-inbound-mail" });
console.log(sql.join("\n"));
console.error(webhook.secret ? "Webhook signing secret (store as AGENTMAIL_WEBHOOK_SECRET; do not commit):" : "Webhook registered; copy its signing secret from the AgentMail console into AGENTMAIL_WEBHOOK_SECRET.");
if (webhook.secret) console.error(webhook.secret);
