#!/usr/bin/env node
// Netlify must not publish a frontend ahead of the database it calls.
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function productionProject(env) {
  if (env.NETLIFY !== "true" || env.CONTEXT !== "production") return null;
  const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  const match = url.hostname.match(/^([a-z0-9]+)\.supabase\.co$/);
  if (!match || url.protocol !== "https:") throw new Error("Production requires an explicit hosted Supabase URL.");
  if (env.SUPABASE_PROJECT_REF && env.SUPABASE_PROJECT_REF !== match[1]) {
    throw new Error("The build database and release database do not match.");
  }
  return match[1];
}

function main() {
  let project;
  try { project = productionProject(process.env); }
  catch (error) { console.error(`[deploy:schema] FAIL: ${error.message}`); process.exitCode = 1; return; }
  if (!project) {
    console.log("[deploy:schema] Not a production Netlify build; hosted activation not requested.");
    return;
  }
  const result = spawnSync(process.execPath, ["scripts/check-migration-ledger.mjs", "--project", project], { stdio: "inherit" });
  if (result.status !== 0) {
    console.error("[deploy:schema] Production publish blocked: reconcile the target migration ledger before deploying this source.");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
