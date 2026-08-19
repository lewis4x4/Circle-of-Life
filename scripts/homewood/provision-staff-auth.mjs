#!/usr/bin/env node
/**
 * Homewood Lodge ALF — staff auth invite.
 *
 * For each `staff` row at Homewood with `user_id IS NULL`:
 *   1. Send a Supabase invite email — the employee clicks the link in
 *      their inbox and sets their own password on first sign-in.
 *   2. Set `app_metadata.app_role` on the freshly-invited user, mapped
 *      from `staff.staff_role`.
 *   3. Update `staff.user_id` to the new auth user's id.
 *   4. Grant `user_facility_access` for the Homewood facility (so the
 *      employee actually sees Homewood data after they sign in).
 *
 * No shared launch password. Each employee owns their credentials.
 *
 * Idempotent — rows where `user_id` is already set are skipped. If
 * Supabase reports the email is already invited/registered, the script
 * links the existing user instead of failing.
 *
 * Usage:
 *   npm run homewood:provision-staff -- --dry-run    # preview, no emails sent
 *   npm run homewood:provision-staff                 # send invite emails
 *
 * Required env (auto-loaded from .env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Optional env:
 *   HOMEWOOD_FACILITY_ID (default: 00000000-0000-0000-0002-000000000003)
 *   INVITE_REDIRECT_TO   (URL the invite link points to — defaults to the
 *                         Supabase project's site URL configured in the
 *                         Supabase dashboard)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const DEFAULT_HOMEWOOD_FACILITY_ID = "00000000-0000-0000-0002-000000000003";
const LOG_PATH = path.join(ROOT, "docs", "homewood", "STAFF_PROVISIONING_LOG.md");

/**
 * staff.staff_role → app_role. Update this map deliberately, never
 * silently — the script halts if it encounters a value not in this table.
 */
const STAFF_ROLE_TO_APP_ROLE = {
  administrator: "facility_admin",
  assistant_administrator: "facility_admin",
  resident_aide: "caregiver",
  cna: "caregiver",
  lpn: "nurse",
  rn: "nurse",
  med_tech: "med_tech",
  dietary_staff: "dietary",
  dietary_manager: "dietary",
  activities_director: "coordinator",
  maintenance: "maintenance_role",
  housekeeping: "housekeeper",
  driver: "maintenance_role",
};

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function requireEnv(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  throw new Error(`Missing required env var: ${names.join(" or ")}`);
}

/** Redact email for the committed log so personal addresses don't end up in git history. */
function redactEmail(email) {
  if (!email || typeof email !== "string") return email;
  const at = email.indexOf("@");
  if (at < 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at);
  const keep = local.slice(0, Math.min(2, local.length));
  return `${keep}${"*".repeat(Math.max(1, local.length - keep.length))}${domain}`;
}

function safeMessage(err) {
  if (!err) return "";
  if (typeof err === "string") return err;
  return err.message || err.code || JSON.stringify(err);
}

async function findUserByEmail(supa, email) {
  let page = 1;
  while (page < 50) {
    const { data, error } = await supa.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = data.users.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase());
    if (found) return found;
    if ((data.users?.length ?? 0) < 200) return null;
    page += 1;
  }
  return null;
}

async function main() {
  loadEnvFile(path.join(ROOT, ".env.local"));
  const dryRun = process.argv.includes("--dry-run");

  const url = requireEnv("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const facilityId = process.env.HOMEWOOD_FACILITY_ID?.trim() || DEFAULT_HOMEWOOD_FACILITY_ID;
  const redirectTo = process.env.INVITE_REDIRECT_TO?.trim() || undefined;

  const supa = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  console.log(`[homewood:provision-staff] mode: ${dryRun ? "DRY-RUN" : "INVITE"}  facility: ${facilityId}`);
  if (!dryRun) console.log(`[homewood:provision-staff] invites will be sent via Supabase Auth email${redirectTo ? ` (redirect: ${redirectTo})` : ""}.`);

  const { data: facility, error: ferr } = await supa
    .from("facilities")
    .select("id, organization_id, name")
    .eq("id", facilityId)
    .single();
  if (ferr || !facility) {
    console.error(`[homewood:provision-staff] FAIL facility lookup: ${safeMessage(ferr)}`);
    process.exit(1);
  }
  const organizationId = facility.organization_id;

  const { data: staffRows, error: serr } = await supa
    .from("staff")
    .select("id, first_name, last_name, email, staff_role, user_id, employment_status")
    .eq("facility_id", facilityId)
    .is("user_id", null)
    .is("deleted_at", null);
  if (serr) {
    console.error(`[homewood:provision-staff] FAIL staff lookup: ${safeMessage(serr)}`);
    process.exit(1);
  }
  if (!staffRows || staffRows.length === 0) {
    console.log("[homewood:provision-staff] no staff rows with user_id IS NULL — nothing to do.");
    process.exit(0);
  }
  console.log(`[homewood:provision-staff] candidate staff rows: ${staffRows.length}`);

  // Pre-flight: every staff_role must be in the mapping.
  const unmapped = [...new Set(staffRows.map((s) => s.staff_role))].filter((r) => !(r in STAFF_ROLE_TO_APP_ROLE));
  if (unmapped.length > 0) {
    console.error(`[homewood:provision-staff] FAIL: unmapped staff_role values present: ${unmapped.join(", ")}`);
    console.error("  Add explicit mappings to STAFF_ROLE_TO_APP_ROLE before re-running.");
    process.exit(1);
  }

  // Rows without email cannot be invited. Skip them and continue so the
  // rest of the roster still gets links; record SKIP-NO-EMAIL in the log.
  const noEmail = staffRows.filter((s) => !s.email || s.email.trim() === "");
  if (noEmail.length > 0) {
    console.warn(`[homewood:provision-staff] SKIP: ${noEmail.length} staff rows have no email and will not be invited.`);
    for (const s of noEmail) console.warn(`  - ${s.id}  (${s.staff_role})`);
  }

  const results = [];
  for (const staff of noEmail) {
    results.push({
      staff_id: staff.id,
      name: `${staff.first_name} ${staff.last_name}`,
      email: "",
      staff_role: staff.staff_role,
      app_role: STAFF_ROLE_TO_APP_ROLE[staff.staff_role],
      action: "SKIP-NO-EMAIL",
      reason: "staff.email is empty; populate before a later invite pass",
    });
  }

  for (const staff of staffRows.filter((s) => s.email && s.email.trim() !== "")) {
    const fullName = `${staff.first_name} ${staff.last_name}`;
    const email = staff.email.trim();
    const appRole = STAFF_ROLE_TO_APP_ROLE[staff.staff_role];
    const result = {
      staff_id: staff.id,
      name: fullName,
      email,
      staff_role: staff.staff_role,
      app_role: appRole,
      action: "PENDING",
      reason: "",
    };

    if (dryRun) {
      result.action = "DRY-WOULD-INVITE";
      result.reason = `app_role=${appRole}; would email invite to ${redactEmail(email)}`;
      results.push(result);
      continue;
    }

    // 1) Send invite — Supabase creates the auth.users row and emails the link.
    let userId = null;
    const inviteResult = await supa.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName, source: "homewood-provision-staff" },
      ...(redirectTo ? { redirectTo } : {}),
    });
    if (inviteResult.error) {
      const msg = safeMessage(inviteResult.error).toLowerCase();
      if (msg.includes("already") && (msg.includes("registered") || msg.includes("exists") || msg.includes("invited"))) {
        const existing = await findUserByEmail(supa, email).catch((e) => {
          throw new Error(`existing-user lookup failed: ${safeMessage(e)}`);
        });
        if (!existing) {
          result.action = "FAILED";
          result.reason = "Supabase said already-registered but lookup found nothing";
          results.push(result);
          continue;
        }
        userId = existing.id;
        result.action = "LINKED-EXISTING";
      } else {
        result.action = "FAILED";
        result.reason = `invite error: ${safeMessage(inviteResult.error)}`;
        results.push(result);
        continue;
      }
    } else {
      userId = inviteResult.data.user?.id;
      result.action = "INVITED";
    }

    if (!userId) {
      result.action = "FAILED";
      result.reason = "no user id after invite/link";
      results.push(result);
      continue;
    }

    // 2) Set app_role
    const roleUpd = await supa.auth.admin.updateUserById(userId, {
      app_metadata: { app_role: appRole },
    });
    if (roleUpd.error) {
      result.action = "FAILED";
      result.reason = `app_role set error: ${safeMessage(roleUpd.error)}`;
      results.push(result);
      continue;
    }

    // 3) Link staff row
    const staffUpd = await supa.from("staff").update({ user_id: userId }).eq("id", staff.id);
    if (staffUpd.error) {
      result.action = "FAILED";
      result.reason = `staff.user_id update error: ${safeMessage(staffUpd.error)}`;
      results.push(result);
      continue;
    }

    // 4) Grant facility access
    const { data: existingGrant } = await supa
      .from("user_facility_access")
      .select("id")
      .eq("user_id", userId)
      .eq("facility_id", facilityId)
      .is("revoked_at", null)
      .maybeSingle();
    if (!existingGrant) {
      const grant = await supa.from("user_facility_access").insert({
        user_id: userId,
        facility_id: facilityId,
        organization_id: organizationId,
        is_primary: true,
      });
      if (grant.error) {
        result.action = "PARTIAL-NO-ACCESS";
        result.reason = `invited + linked but facility access insert failed: ${safeMessage(grant.error)}`;
        results.push(result);
        continue;
      }
    }

    result.reason = `app_role=${appRole}; user_id=${userId}; facility access granted`;
    results.push(result);
  }

  const tally = results.reduce((acc, r) => {
    acc[r.action] = (acc[r.action] ?? 0) + 1;
    return acc;
  }, {});

  // Log
  const lines = [];
  lines.push(`# Homewood — Staff Auth Provisioning Log`);
  lines.push("");
  lines.push(`_Generated: \`${new Date().toISOString()}\` — mode: **${dryRun ? "DRY-RUN" : "INVITE"}**_`);
  lines.push("");
  lines.push(`- Facility: \`${facility.name}\` (${facilityId})`);
  lines.push(`- Organization: \`${organizationId}\``);
  lines.push(`- Source: \`staff\` rows where \`user_id IS NULL\` AND \`deleted_at IS NULL\``);
  lines.push(`- Flow: Supabase \`inviteUserByEmail\` — each employee clicks the link in their inbox and sets their own password on first sign-in. No shared launch password.`);
  lines.push("");
  lines.push(`## Tally`);
  lines.push("");
  lines.push("| Outcome | Count |");
  lines.push("|---|---:|");
  for (const k of Object.keys(tally).sort()) lines.push(`| ${k} | ${tally[k]} |`);
  lines.push("");
  lines.push(`## staff_role → app_role mapping in effect`);
  lines.push("");
  lines.push("| staff_role | app_role |");
  lines.push("|---|---|");
  for (const [k, v] of Object.entries(STAFF_ROLE_TO_APP_ROLE)) lines.push(`| ${k} | ${v} |`);
  lines.push("");
  lines.push(`## Per-staff detail`);
  lines.push("");
  lines.push("| Name | Email (redacted) | staff_role | app_role | Action | Detail |");
  lines.push("|---|---|---|---|---|---|");
  for (const r of results) {
    lines.push(`| ${r.name} | ${redactEmail(r.email)} | ${r.staff_role} | ${r.app_role} | ${r.action} | ${(r.reason ?? "").replace(/\|/g, "\\|")} |`);
  }
  lines.push("");
  lines.push(`## Notes`);
  lines.push("");
  lines.push(`- Emails in the Per-staff detail table are redacted (first 2 chars + domain). Full addresses live in \`staff.email\` and \`auth.users.email\`, never in git.`);
  lines.push(`- Passwords are never stored or transmitted by this script. Each employee sets their own password when they click the invite link.`);
  lines.push(`- Re-running the script is safe — staff rows with \`user_id\` already set are skipped. Re-invited emails are linked to their existing \`auth.users\` row instead of creating duplicates.`);
  lines.push(`- Each user is granted \`user_facility_access\` for the Homewood facility. Without this grant, sign-in works but the user sees an empty workspace.`);
  lines.push("");

  mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  writeFileSync(LOG_PATH, `${lines.join("\n")}\n`);

  console.log(`[homewood:provision-staff] log: ${path.relative(ROOT, LOG_PATH)}`);
  console.log(`[homewood:provision-staff] tally: ${JSON.stringify(tally)}`);

  const fatal = (tally.FAILED ?? 0) + (tally["PARTIAL-NO-ACCESS"] ?? 0);
  process.exit(fatal > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[homewood:provision-staff] FATAL:", safeMessage(err));
  process.exit(1);
});
