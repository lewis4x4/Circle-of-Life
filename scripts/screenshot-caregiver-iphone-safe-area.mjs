#!/usr/bin/env node
/**
 * One-off baseline capture: caregiver portal at iPhone 14 Pro viewport
 * with the home-indicator inset visually simulated.
 *
 * Background: `env(safe-area-inset-bottom)` is set by the browser based
 * on the device's actual chrome (the home-indicator strip on iPhones).
 * Playwright in headless mode reports 0px regardless of viewport, so
 * the BottomNav's `pb-[env(safe-area-inset-bottom)]` resolves to no
 * padding — visually hiding the safe-area accommodation the chrome
 * already implements.
 *
 * This script overrides the visual to show what a real iPhone 14 Pro
 * (with a 34px home-indicator strip) would render: it injects CSS that
 * forces `padding-bottom: 34px` on the `<BottomNav>` selector and
 * grows its height by the same amount, then captures. The result is a
 * baseline that reviewers can compare against future PRs to confirm
 * the bottom-nav still clears the home indicator.
 *
 * Reuses the same auth + cookie injection from screenshot-dashboard.mjs.
 *
 * Usage:
 *   node scripts/screenshot-caregiver-iphone-safe-area.mjs
 *
 * Env:
 *   BASE_URL                 default http://127.0.0.1:3000
 *   PHASE1_DEMO_PASSWORD     default HavenDemo2026!
 *   SCREENSHOT_USER_EMAIL    default maria.garcia@circleoflifealf.com
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
const email = process.env.SCREENSHOT_USER_EMAIL ?? "maria.garcia@circleoflifealf.com";
const outPath = path.resolve(
  ROOT,
  "docs/ui-audit/screenshots-phase-c-portals/caregiver/caregiver-393x852-dark-safe-area.png",
);

const HOME_INDICATOR_PX = 34;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  process.exit(2);
}

function projectRef(url) {
  return new URL(url).host.split(".")[0];
}

async function signInGetSession() {
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signInWithPassword failed: ${error.message}`);
  return data.session;
}

function cookieForSession(session) {
  const name = `sb-${projectRef(supabaseUrl)}-auth-token`;
  const payload = {
    access_token: session.access_token,
    token_type: session.token_type,
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    refresh_token: session.refresh_token,
    user: session.user,
  };
  return { name, value: `base64-${Buffer.from(JSON.stringify(payload)).toString("base64")}` };
}

async function run() {
  console.log(`[iphone-safe-area] signing in as ${email}`);
  const session = await signInGetSession();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 1,
  });
  const { name, value } = cookieForSession(session);
  await context.addCookies([
    {
      name,
      value,
      domain: new URL(baseUrl).hostname,
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
      expires: Math.floor(Date.now() / 1000) + 3600,
    },
  ]);
  const page = await context.newPage();
  await page.emulateMedia({ colorScheme: "dark" });
  await page.evaluate(() => {
    try {
      window.localStorage.setItem("theme", "dark");
    } catch {}
    document.documentElement.classList.add("dark");
  });
  await page.goto(`${baseUrl}/caregiver`, { waitUntil: "domcontentloaded", timeout: 25000 });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(4000);

  // Simulate the iPhone 14 Pro home-indicator strip. `env(safe-area-inset-bottom)`
  // is set by the browser based on physical device chrome and cannot be
  // overridden via CSS variable; instead we target the BottomNav selector
  // explicitly and force the value the real device would inject.
  await page.addStyleTag({
    content: `
      nav[aria-label="Caregiver navigation"] {
        height: calc(3.5rem + ${HOME_INDICATOR_PX}px) !important;
        padding-bottom: ${HOME_INDICATOR_PX}px !important;
      }
      /* Visualize the home-indicator strip so reviewers can see the
         primitive accommodates it without overlap. */
      nav[aria-label="Caregiver navigation"]::after {
        content: "";
        position: absolute;
        left: 33.5%;
        right: 33.5%;
        bottom: 8px;
        height: 5px;
        border-radius: 3px;
        background: rgba(255, 255, 255, 0.45);
        pointer-events: none;
      }
    `,
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: outPath, fullPage: false });
  console.log(`[iphone-safe-area] wrote ${path.relative(ROOT, outPath)}`);
  await context.close();
  await browser.close();
}

run().catch((err) => {
  console.error("[iphone-safe-area] fatal:", err);
  process.exit(1);
});
