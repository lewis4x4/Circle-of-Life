#!/usr/bin/env node
/**
 * Repair every account in `canonical-roster.mjs` to the canonical password
 * using the Supabase service-role admin API.
 *
 * Idempotent: re-running on a healthy roster does nothing observable. Each
 * account passes through a three-step ensure:
 *
 *   1. Account exists in `auth.users` with the right `id` + `app_role`.
 *      If missing, create it via `auth.admin.createUser` (this also
 *      provisions the `auth.identities` row that password sign-in requires).
 *   2. `app_metadata.app_role` matches the canonical role. If it drifted,
 *      patch via `auth.admin.updateUserById`. Full-name in `user_metadata`
 *      is reset too so the demo data stays predictable.
 *   3. Password is reset to canonical. Always — this is the operation that
 *      cleared the drift on `milton.smith` during Phase A and that this
 *      script now codifies for the remaining drifted accounts.
 *
 * Why a script and not a migration: migration 166 already attempts the
 * same thing in SQL, but it hashed the wrong literal (`'Sp33dy22'` instead
 * of `'HavenDemo2026!'`) and the ad-hoc fix that corrected it for most
 * accounts was applied via this same admin API. Codifying the admin-API
 * fix is closer to the actual repair than a fresh migration would be, and
 * the resulting auth state is stable against `npm run seed:verify`.
 *
 * Requires `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` or the env. The
 * script refuses to run without it.
 *
 * Usage:
 *   npm run seed:repair
 *
 *   PHASE1_DEMO_PASSWORD=... npm run seed:repair  # for password rotations
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

import { CANONICAL_PASSWORD, CANONICAL_ROSTER } from "./canonical-roster.mjs";

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, ".env.local");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...rest] = trimmed.split("=");
    if (!(key in process.env)) process.env[key] = rest.join("=");
  }
}
loadEnvFile(ENV_PATH);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("[seed:repair] FAIL: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required.");
  console.error("[seed:repair] copy them from the pilot .env.local before re-running.");
  process.exit(2);
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const summary = { created: 0, passwordReset: 0, roleFixed: 0, alreadyOk: 0, failed: [] };

const orgId = "00000000-0000-0000-0000-000000000001";

for (const account of CANONICAL_ROSTER) {
  const { id, email, appRole, fullName } = account;
  const tag = `${appRole.padEnd(16)} ${email}`;

  try {
    const { data: existing, error: getErr } = await admin.auth.admin.getUserById(id);
    if (getErr && getErr.status !== 404) {
      throw new Error(`getUserById failed: ${getErr.message}`);
    }

    if (!existing?.user) {
      const { error: createErr } = await admin.auth.admin.createUser({
        // @ts-expect-error supabase-js accepts a fixed UUID for admin.createUser
        id,
        email,
        password: CANONICAL_PASSWORD,
        email_confirm: true,
        app_metadata: {
          app_role: appRole,
          organization_id: orgId,
          provider: "email",
          providers: ["email"],
        },
        user_metadata: { full_name: fullName, email_verified: true },
      });
      if (createErr) throw new Error(`createUser failed: ${createErr.message}`);
      summary.created++;
      console.log(`  [created]   ${tag}`);
      continue;
    }

    const currentRole = existing.user.app_metadata?.app_role ?? null;
    const roleDrifted = currentRole !== appRole;

    const updates = {
      password: CANONICAL_PASSWORD,
      email_confirm: true,
    };
    if (roleDrifted) {
      updates.app_metadata = {
        ...existing.user.app_metadata,
        app_role: appRole,
        organization_id: existing.user.app_metadata?.organization_id ?? orgId,
        provider: "email",
        providers: ["email"],
      };
      updates.user_metadata = { ...existing.user.user_metadata, full_name: fullName };
    }

    const { error: updateErr } = await admin.auth.admin.updateUserById(id, updates);
    if (updateErr) throw new Error(`updateUserById failed: ${updateErr.message}`);

    if (roleDrifted) {
      summary.roleFixed++;
      console.log(`  [role-fix]  ${tag}  (was: ${currentRole ?? "(none)"} → ${appRole})`);
    } else {
      summary.passwordReset++;
      console.log(`  [pw-reset]  ${tag}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    summary.failed.push({ email, msg });
    console.error(`  [FAIL]      ${tag}  ${msg}`);
  }
}

console.log("");
console.log(`[seed:repair] roster=${CANONICAL_ROSTER.length}  created=${summary.created}  pw-reset=${summary.passwordReset}  role-fixed=${summary.roleFixed}  failed=${summary.failed.length}`);

if (summary.failed.length > 0) {
  console.error("[seed:repair] FAIL — some accounts could not be repaired:");
  for (const f of summary.failed) console.error(`  - ${f.email}: ${f.msg}`);
  process.exit(1);
}

console.log("[seed:repair] OK — every roster account reset to canonical password.");
console.log("[seed:repair] next: `npm run seed:verify` to confirm auth.");
