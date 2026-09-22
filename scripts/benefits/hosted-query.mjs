// Run one SQL file or statement against a Haven hosted project through the Management API,
// the same transport as `supabase db query --linked` and scripts/check-migration-ledger.mjs.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const [ref, source] = process.argv.slice(2);
if (!ref || !source) { console.error("usage: node hosted-query.mjs <project-ref> <file.sql|sql>"); process.exit(2); }
const raw = process.env.SUPABASE_ACCESS_TOKEN?.trim() || execFileSync("security", ["find-generic-password", "-s", "Supabase CLI", "-a", "access-token", "-w"], { encoding: "utf8" }).trim();
const token = raw.startsWith("go-keyring-base64:") ? Buffer.from(raw.slice("go-keyring-base64:".length), "base64").toString("utf8").trim() : raw;
const query = source.endsWith(".sql") ? readFileSync(source, "utf8") : source;
const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query }) });
const text = await response.text();
if (!response.ok) { console.error(`HTTP ${response.status}: ${text}`); process.exit(1); }
console.log(text);
