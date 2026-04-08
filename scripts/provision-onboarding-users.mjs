#!/usr/bin/env node
/**
 * Provision onboarding + admin users via Supabase Auth Admin REST API (fetch).
 * Avoids admin.listUsers() which can return 500 on some projects.
 *
 * Usage:
 *   ONBOARDING_BOOTSTRAP_PASSWORD='...' node --env-file=.env.local scripts/provision-onboarding-users.mjs
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local.
 * To look up user ids if needed: supabase db query --linked "select id, email from auth.users where email = '...'"
 */

import { readFileSync } from "fs";

function loadEnvLocal() {
  try {
    const raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    for (const line of raw.split("\n")) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* use process.env only */
  }
}

loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.ONBOARDING_BOOTSTRAP_PASSWORD;

const ONBOARDING_EMAILS = [
  "ed.risingoaksalf@gmail.com",
  "jessicamurphy@circleoflifecommunities.com",
  "ceo.col.gsms@gmail.com",
  "msmith.gsms@gmail.com",
];

async function admin(path, opts = {}) {
  const res = await fetch(`${url}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      "Content-Type": "application/json",
      ...opts.headers,
    },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { ok: res.ok, status: res.status, body };
}

async function createOnboardingUser(email) {
  return admin("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      app_metadata: { app_role: "onboarding", provider: "email", providers: ["email"] },
    }),
  });
}

async function main() {
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }
  if (!password || password.length < 8) {
    console.error("Set ONBOARDING_BOOTSTRAP_PASSWORD (min 8 characters).");
    process.exit(1);
  }

  for (const email of ONBOARDING_EMAILS) {
    const r = await createOnboardingUser(email);
    const ok = r.ok || r.body?.error_code === "email_exists";
    console.log(
      JSON.stringify({
        email,
        status: r.status,
        ok,
        error_code: r.body?.error_code,
        id: r.body?.id,
      }),
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
