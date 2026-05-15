#!/usr/bin/env node
/**
 * Authenticated a11y audit.
 *
 * Same auth flow as screenshot-dashboard.mjs (Supabase session cookie
 * injected into Playwright), then runs @axe-core/playwright against
 * /admin and /admin/executive. Fails CI on any serious/critical violation.
 *
 * Env:
 *   BASE_URL                 default http://127.0.0.1:3000
 *   SCREENSHOT_USER_EMAIL    default jessica.murphy@circleoflifealf.com
 *   AXE_AUTH_ROUTES          comma-separated paths (default /admin,/admin/executive)
 *   AXE_FAIL_LEVELS          comma-separated impact (default serious,critical)
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import AxeBuilder from "@axe-core/playwright";

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

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const password = process.env.PHASE1_DEMO_PASSWORD ?? "HavenDemo2026!";
const email = process.env.SCREENSHOT_USER_EMAIL ?? "jessica.murphy@circleoflifealf.com";
const routes = (process.env.AXE_AUTH_ROUTES ?? "/admin,/admin/executive")
  .split(",").map((s) => s.trim()).filter(Boolean);
const failLevels = new Set(
  (process.env.AXE_FAIL_LEVELS ?? "serious,critical").split(",").map((s) => s.trim()),
);

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  process.exit(2);
}

function projectRefFromUrl(url) {
  return new URL(url).host.split(".")[0];
}

async function signInGetSession() {
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signInWithPassword failed: ${error.message}`);
  if (!data.session) throw new Error("signInWithPassword returned no session");
  return data.session;
}

async function setSessionCookie(context, session) {
  const projectRef = projectRefFromUrl(supabaseUrl);
  const cookieName = `sb-${projectRef}-auth-token`;
  const payload = {
    access_token: session.access_token,
    token_type: session.token_type,
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    refresh_token: session.refresh_token,
    user: session.user,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64");
  await context.addCookies([
    {
      name: cookieName,
      value: `base64-${encoded}`,
      domain: new URL(baseUrl).hostname,
      path: "/",
      sameSite: "Lax",
      expires: Math.floor(Date.now() / 1000) + 3600,
    },
  ]);
}

async function run() {
  console.log(`[a11y-authenticated] signing in as ${email}`);
  const session = await signInGetSession();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await setSessionCookie(context, session);
  const page = await context.newPage();

  const failures = [];
  try {
    for (const route of routes) {
      console.log(`\n[a11y-authenticated] route ${route}`);
      await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded", timeout: 25000 });
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(800);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      const offenders = results.violations.filter((v) => failLevels.has(v.impact));
      console.log(`  ${results.violations.length} total violations; ${offenders.length} ${[...failLevels].join("/")}`);
      for (const v of results.violations) {
        const tag = offenders.includes(v) ? "✗" : "·";
        console.log(`  ${tag} [${v.impact}] ${v.id} — ${v.help}`);
        if (offenders.includes(v)) {
          for (const node of v.nodes.slice(0, 3)) {
            console.log(`      ${node.target?.join(" ") || "<unknown>"}`);
          }
        }
      }
      if (offenders.length > 0) failures.push({ route, count: offenders.length });
    }
  } finally {
    await context.close();
    await browser.close();
  }

  if (failures.length > 0) {
    console.error(`\n[a11y-authenticated] FAIL — ${failures.length} routes have ${[...failLevels].join("/")} violations`);
    for (const f of failures) console.error(`  ${f.route}: ${f.count} blocking violations`);
    process.exit(1);
  }
  console.log(`\n[a11y-authenticated] OK — no ${[...failLevels].join("/")} violations across ${routes.length} routes`);
}

run().catch((err) => {
  console.error("[a11y-authenticated] fatal:", err);
  process.exit(1);
});
