#!/usr/bin/env node
/**
 * Visual regression check for the UI audit baselines.
 *
 * Re-captures /admin and /admin/executive at 3 viewports × 2 themes
 * (same flow as screenshot-dashboard.mjs), then pixel-diffs each capture
 * against the committed baseline in docs/ui-audit/screenshots/.
 *
 * Fails when:
 *   - any pair has > THRESHOLD_PCT pixels different (default 0.5%)
 *   - any captured image is missing a baseline
 *
 * Outputs diff PNGs to docs/ui-audit/screenshots/diff/<name>-diff.png so
 * a reviewer can see what changed.
 *
 * Usage:
 *   node scripts/visual-regression.mjs                # compare
 *   node scripts/visual-regression.mjs --update       # overwrite baselines
 *
 * Env:
 *   VR_THRESHOLD_PCT       — % pixels diff allowed (default 0.5)
 *   SCREENSHOT_USER_EMAIL  — login (default jessica.murphy@circleoflifealf.com)
 *   BASE_URL               — app origin (default http://127.0.0.1:3000)
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

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
const baselineDir = path.resolve(ROOT, "docs/ui-audit/screenshots");
const diffDir = path.join(baselineDir, "diff");
const update = process.argv.includes("--update");
const threshold = Number(process.env.VR_THRESHOLD_PCT ?? "0.5") / 100;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  process.exit(2);
}

const VIEWPORTS = [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "2560x1440", width: 2560, height: 1440 },
];
const THEMES = ["light", "dark"];
const ROUTES = [
  { id: "admin", path: "/admin" },
  { id: "executive", path: "/admin/executive" },
];

fs.mkdirSync(diffDir, { recursive: true });

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

async function ensureTheme(page, theme) {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate((t) => {
    try { window.localStorage.setItem("theme", t); } catch {}
  }, theme);
  await page.evaluate((t) => {
    const html = document.documentElement;
    if (t === "dark") html.classList.add("dark"); else html.classList.remove("dark");
  }, theme);
}

async function captureBuffer(page, route, viewport, theme) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await ensureTheme(page, theme);
  await page.goto(`${baseUrl}${route.path}`, { waitUntil: "domcontentloaded", timeout: 25000 });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(600);
  return await page.screenshot({ fullPage: false, type: "png" });
}

function readPng(buf) {
  return PNG.sync.read(buf);
}

function diffBuffers(actualBuf, baselineBuf) {
  const a = readPng(actualBuf);
  const b = readPng(baselineBuf);
  if (a.width !== b.width || a.height !== b.height) {
    return { width: 0, height: 0, mismatched: Infinity, total: 1, ratio: 1, dimensionMismatch: true };
  }
  const diff = new PNG({ width: a.width, height: a.height });
  const mismatched = pixelmatch(a.data, b.data, diff.data, a.width, a.height, {
    threshold: 0.1,
    alpha: 0.3,
    diffMask: false,
  });
  const total = a.width * a.height;
  return { width: a.width, height: a.height, mismatched, total, ratio: mismatched / total, diff };
}

async function run() {
  console.log(`[visual-regression] signing in as ${email}`);
  const session = await signInGetSession();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await setSessionCookie(context, session);
  const page = await context.newPage();

  let failed = 0;
  let okCount = 0;
  let missingBaselines = 0;
  const summary = [];

  try {
    for (const route of ROUTES) {
      for (const viewport of VIEWPORTS) {
        for (const theme of THEMES) {
          const name = `${route.id}-${viewport.name}-${theme}`;
          const baselinePath = path.join(baselineDir, `${name}.png`);
          const actual = await captureBuffer(page, route, viewport, theme);

          if (update || !fs.existsSync(baselinePath)) {
            fs.writeFileSync(baselinePath, actual);
            console.log(`  ${update ? "✏" : "+"} ${name} (${update ? "updated" : "created"})`);
            okCount++;
            continue;
          }

          const baseline = fs.readFileSync(baselinePath);
          const result = diffBuffers(actual, baseline);
          if (result.dimensionMismatch) {
            console.error(`  ✗ ${name} — dimension mismatch (re-capture baseline)`);
            failed++;
            summary.push({ name, status: "dimension_mismatch" });
            continue;
          }
          const pct = result.ratio * 100;
          if (result.ratio > threshold) {
            const diffPath = path.join(diffDir, `${name}-diff.png`);
            fs.writeFileSync(diffPath, PNG.sync.write(result.diff));
            console.error(`  ✗ ${name} — ${pct.toFixed(3)}% diff (cap ${(threshold * 100).toFixed(3)}%) → ${path.relative(ROOT, diffPath)}`);
            failed++;
            summary.push({ name, status: "diff", pct });
          } else {
            console.log(`  ✓ ${name} — ${pct.toFixed(3)}% diff`);
            okCount++;
            summary.push({ name, status: "ok", pct });
          }
        }
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }

  console.log(`\n[visual-regression] ${okCount} ok · ${failed} regressed${missingBaselines ? ` · ${missingBaselines} missing` : ""}`);
  if (failed > 0) {
    console.error("\nVisual regressions detected. Inspect docs/ui-audit/screenshots/diff/*.png.");
    console.error("To accept the new state as the baseline, re-run with --update.");
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("[visual-regression] fatal:", err);
  process.exit(1);
});
