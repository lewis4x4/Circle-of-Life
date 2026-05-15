#!/usr/bin/env node
/**
 * Authenticated screenshot harness for the UI audit.
 *
 * Uses the Supabase JS client to sign in (same flow the app uses), then
 * injects the resulting session cookies into a Playwright context so the
 * dashboard renders without going through the loading-spinner login UI.
 * Captures /admin and /admin/executive at three viewports in both themes.
 *
 * Output: docs/ui-audit/screenshots/{route}-{viewport}-{theme}.png
 *
 * Usage:
 *   node scripts/screenshot-dashboard.mjs
 *
 * Env:
 *   BASE_URL                 default http://127.0.0.1:3000
 *   PHASE1_DEMO_PASSWORD     default HavenDemo2026!
 *   SCREENSHOT_USER_EMAIL    default milton.smith@circleoflifealf.com
 *   SCREENSHOT_OUT_DIR       default docs/ui-audit/screenshots
 *   ROUTES_JSON              optional override, e.g. '[{"id":"med-tech","path":"/med-tech"}]'
 *   SETTLE_MS                additional settle delay after networkidle (default 600)
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

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
const email = process.env.SCREENSHOT_USER_EMAIL ?? "milton.smith@circleoflifealf.com";
const outDir = path.resolve(ROOT, process.env.SCREENSHOT_OUT_DIR ?? "docs/ui-audit/screenshots");

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. Copy main repo .env.local.");
  process.exit(2);
}

const VIEWPORTS = [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "2560x1440", width: 2560, height: 1440 },
];
const THEMES = ["light", "dark"];
const ROUTES = process.env.ROUTES_JSON
  ? JSON.parse(process.env.ROUTES_JSON)
  : [
      { id: "admin", path: "/admin" },
      { id: "executive", path: "/admin/executive" },
    ];

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

function projectRefFromUrl(url) {
  // https://manfqmasfqppukpobpld.supabase.co → manfqmasfqppukpobpld
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

function cookieForSession(session) {
  /**
   * @supabase/ssr stores the session in a cookie named `sb-<projectRef>-auth-token`
   * with the JSON-stringified session as the value. The middleware's
   * createServerClient reads this exact name to revive the session.
   */
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
  // @supabase/ssr base64-encodes large session cookies. Single-cookie form prefix is "base64-".
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64");
  return { name: cookieName, value: `base64-${encoded}` };
}

async function setSessionCookie(context, session) {
  const { name, value } = cookieForSession(session);
  const baseHost = new URL(baseUrl).hostname;
  await context.addCookies([
    {
      name,
      value,
      domain: baseHost,
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
      expires: Math.floor(Date.now() / 1000) + 3600,
    },
  ]);
}

async function ensureTheme(page, theme) {
  await page.emulateMedia({ colorScheme: theme });
  // next-themes uses a `theme` key under the `theme` localStorage namespace.
  await page.evaluate((t) => {
    try {
      window.localStorage.setItem("theme", t);
    } catch {}
  }, theme);
  // Add/remove the .dark class on <html> immediately so the new viewport
  // doesn't flash the wrong theme during the first paint.
  await page.evaluate((t) => {
    const html = document.documentElement;
    if (t === "dark") html.classList.add("dark");
    else html.classList.remove("dark");
  }, theme);
}

async function capture(page, route, viewport, theme) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await ensureTheme(page, theme);
  await page.goto(`${baseUrl}${route.path}`, { waitUntil: "domcontentloaded", timeout: 25000 });
  // Settle: wait for either the sidebar (logged-in shell) or a known sentinel.
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  const settleMs = Number(process.env.SETTLE_MS ?? 600);
  await page.waitForTimeout(settleMs);
  const target = path.join(outDir, `${route.id}-${viewport.name}-${theme}.png`);
  await page.screenshot({ path: target, fullPage: false });
  return target;
}

async function run() {
  console.log(`[screenshots] signing in as ${email}`);
  const session = await signInGetSession();
  console.log(`[screenshots] got session for user_id=${session.user.id}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  await setSessionCookie(context, session);

  const page = await context.newPage();
  const results = [];

  try {
    for (const route of ROUTES) {
      for (const viewport of VIEWPORTS) {
        for (const theme of THEMES) {
          const label = `${route.id} @ ${viewport.name} / ${theme}`;
          try {
            const out = await capture(page, route, viewport, theme);
            console.log(`  ✓ ${label} → ${path.relative(ROOT, out)}`);
            results.push({ route: route.id, viewport: viewport.name, theme, ok: true });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`  ✗ ${label} — ${msg}`);
            results.push({ route: route.id, viewport: viewport.name, theme, ok: false, error: msg });
          }
        }
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }

  const okCount = results.filter((r) => r.ok).length;
  console.log(`[screenshots] ${okCount}/${results.length} captured to ${path.relative(ROOT, outDir)}`);
  if (okCount === 0) process.exit(1);
}

run().catch((err) => {
  console.error("[screenshots] fatal:", err);
  process.exit(1);
});
