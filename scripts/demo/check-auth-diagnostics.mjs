#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, ".env.local");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }
    const [key, ...rest] = trimmed.split("=");
    if (!(key in process.env)) {
      process.env[key] = rest.join("=");
    }
  }
}

loadEnvFile(ENV_PATH);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;
const password = process.env.PHASE1_DEMO_PASSWORD ?? "HavenDemo2026!";

if (!url || !anonKey) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: "Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY/SUPABASE_ANON_KEY",
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

const pilotEmails = [
  "milton@circleoflifealf.com",
  "jessica@circleoflifealf.com",
  "maria.garcia@circleoflifealf.com",
  "robert.sullivan@circleoflifealf.com",
];

const legacyEmails = [
  "milton@circleoflife.demo",
  "jessica@circleoflife.demo",
  "maria.garcia@circleoflife.demo",
  "robert.sullivan@family.demo",
];

async function fetchJson(requestUrl, init) {
  const response = await fetch(requestUrl, init);
  const text = await response.text();

  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }

  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}

async function checkSettings() {
  return fetchJson(`${url}/auth/v1/settings`, {
    headers: {
      apikey: anonKey,
    },
  });
}

async function checkPasswordLogin(email) {
  return fetchJson(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      password,
    }),
  });
}

async function checkAdminUsers() {
  if (!serviceRoleKey) {
    return {
      enabled: false,
      users: [],
    };
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data, error } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });

  if (error) {
    return {
      enabled: true,
      error: error.message,
      users: [],
    };
  }

  const wanted = new Set([...pilotEmails, ...legacyEmails]);
  return {
    enabled: true,
    users:
      data?.users
        ?.filter((user) => wanted.has(user.email ?? ""))
        .map((user) => ({
          id: user.id,
          email: user.email,
          aud: user.aud,
          role: user.role,
          confirmed_at: user.confirmed_at,
          last_sign_in_at: user.last_sign_in_at,
        })) ?? [],
    total_users_scanned: data?.users?.length ?? 0,
  };
}

function summarizeLogin(email, result) {
  return {
    email,
    ok: result.ok,
    status: result.status,
    user_email: result.body?.user?.email ?? null,
    has_access_token: Boolean(result.body?.access_token),
    error_code: result.body?.error_code ?? null,
    msg: result.body?.msg ?? null,
  };
}

const settings = await checkSettings();
const pilotLoginResults = await Promise.all(
  pilotEmails.map(async (email) => summarizeLogin(email, await checkPasswordLogin(email))),
);
const legacyLoginResults = await Promise.all(
  legacyEmails.map(async (email) => summarizeLogin(email, await checkPasswordLogin(email))),
);
const adminUsers = await checkAdminUsers();

const output = {
  checked_at: new Date().toISOString(),
  project_url: url,
  settings: {
    ok: settings.ok,
    status: settings.status,
    email_provider_enabled: settings.body?.external?.email ?? null,
    disable_signup: settings.body?.disable_signup ?? null,
    mailer_autoconfirm: settings.body?.mailer_autoconfirm ?? null,
  },
  pilot_logins: pilotLoginResults,
  legacy_logins: legacyLoginResults,
  admin_users: adminUsers,
  verdict: {
    pilot_login_ok: pilotLoginResults.some((entry) => entry.has_access_token),
    common_error:
      pilotLoginResults.find((entry) => entry.msg)?.msg ??
      legacyLoginResults.find((entry) => entry.msg)?.msg ??
      null,
  },
};

console.log(JSON.stringify(output, null, 2));
