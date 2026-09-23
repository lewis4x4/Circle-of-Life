#!/usr/bin/env node
/**
 * Per-route load budget (COL-660).
 *
 * Signs in once (Supabase session cookie injected into Playwright, the same
 * flow as scripts/a11y-authenticated.mjs), then loads each route in
 * perf-route-budget.json one at a time — never in parallel — and records the
 * time from navigation start until the page is actually usable:
 *   - <main> is visible and has text,
 *   - no [data-testid="admin-route-loading"], [data-slot="skeleton"] or
 *     [aria-busy="true"] remains inside <main>.
 * It also records every Supabase REST request the page made, so a duplicate or
 * unscoped request (the nurse-dashboard finding) shows up in the report.
 *
 * Budgets live in perf-route-budget.json, not here. Exits 1 when any route is
 * over budget or never becomes ready.
 *
 * Env:
 *   BASE_URL                       default http://127.0.0.1:4310
 *   NEXT_PUBLIC_SUPABASE_URL       required
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY  required
 *   SCREENSHOT_USER_EMAIL          required
 *   PHASE1_DEMO_PASSWORD           required
 *   PERF_ROUTE_BUDGET_FILE         default perf-route-budget.json
 *   PERF_REPORT_FILE               optional JSON report path
 *
 * Never point this at the production web host from a workstation (Netlify
 * rate-limits and IP-blocks it). CI runs it against a local `next start`.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

export const READY_TIMEOUT_MS = 45_000;

export function loadBudget(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const defaultMs = Number(raw.defaultContentReadyMs);
  if (!Number.isFinite(defaultMs) || defaultMs <= 0) {
    throw new Error(`${filePath}: defaultContentReadyMs must be a positive number`);
  }
  if (!Array.isArray(raw.routes) || raw.routes.length === 0) {
    throw new Error(`${filePath}: routes must be a non-empty array`);
  }
  const routes = raw.routes.map((entry, index) => {
    const routePath = typeof entry === "string" ? entry : entry?.path;
    if (typeof routePath !== "string" || !routePath.startsWith("/")) {
      throw new Error(`${filePath}: routes[${index}] needs a path starting with /`);
    }
    const budgetMs = entry?.contentReadyMs == null ? defaultMs : Number(entry.contentReadyMs);
    if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
      throw new Error(`${filePath}: routes[${index}].contentReadyMs must be a positive number`);
    }
    return { path: routePath, budgetMs };
  });
  const warmRuns = Math.max(0, Math.floor(Number(raw.warmRuns ?? 1)));
  return { routes, warmRuns };
}

/** Requests that hit the same REST path with the same query more than once in one load. */
export function duplicateRequests(urls) {
  const counts = new Map();
  for (const url of urls) counts.set(url, (counts.get(url) ?? 0) + 1);
  return [...counts].filter(([, n]) => n > 1).map(([url, n]) => ({ url, n }));
}

export function evaluateSamples(samples) {
  return samples.filter((sample) => sample.error != null || sample.contentReadyMs > sample.budgetMs);
}

function projectRefFromUrl(url) {
  return new URL(url).host.split(".")[0];
}

async function signInGetSession({ supabaseUrl, supabaseAnonKey, email, password }) {
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signInWithPassword failed: ${error.message}`);
  if (!data.session) throw new Error("signInWithPassword returned no session");
  return data.session;
}

async function setSessionCookie(context, session, supabaseUrl, baseUrl) {
  const cookieName = `sb-${projectRefFromUrl(supabaseUrl)}-auth-token`;
  const payload = {
    access_token: session.access_token,
    token_type: session.token_type,
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    refresh_token: session.refresh_token,
    user: session.user,
  };
  await context.addCookies([
    {
      name: cookieName,
      value: `base64-${Buffer.from(JSON.stringify(payload)).toString("base64")}`,
      domain: new URL(baseUrl).hostname,
      path: "/",
      sameSite: "Lax",
      expires: Math.floor(Date.now() / 1000) + 3600,
    },
  ]);
}

async function measure(page, baseUrl, supabaseHost, route, phase) {
  const restUrls = [];
  const onRequest = (request) => {
    const url = new URL(request.url());
    if (url.host === supabaseHost && url.pathname.startsWith("/rest/v1/")) {
      restUrls.push(`${request.method()} ${url.pathname}${url.search}`);
    }
  };
  page.on("request", onRequest);
  const started = Date.now();
  let error = null;
  try {
    await page.goto(`${baseUrl}${route.path}`, { waitUntil: "domcontentloaded", timeout: READY_TIMEOUT_MS });
    await page.waitForFunction(
      () => {
        const main = document.querySelector("main");
        if (!main || (main.textContent?.trim().length ?? 0) === 0) return false;
        return !main.querySelector('[data-testid="admin-route-loading"], [data-slot="skeleton"], [aria-busy="true"]');
      },
      undefined,
      { timeout: READY_TIMEOUT_MS, polling: 100 },
    );
  } catch (err) {
    error = err instanceof Error ? err.message.split("\n")[0] : String(err);
  }
  const contentReadyMs = Date.now() - started;
  // Let trailing requests land so duplicates are counted, without timing them.
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
  page.off("request", onRequest);
  return {
    route: route.path,
    phase,
    budgetMs: route.budgetMs,
    contentReadyMs,
    finalPath: new URL(page.url()).pathname,
    restRequests: restUrls.length,
    duplicateRequests: duplicateRequests(restUrls),
    error,
  };
}

async function main() {
  const baseUrl = (process.env.BASE_URL ?? "http://127.0.0.1:4310").replace(/\/$/, "");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const email = process.env.SCREENSHOT_USER_EMAIL;
  const password = process.env.PHASE1_DEMO_PASSWORD;
  const missing = Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseAnonKey,
    SCREENSHOT_USER_EMAIL: email,
    PHASE1_DEMO_PASSWORD: password,
  }).filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) {
    console.error(`[perf:routes] missing or empty: ${missing.join(", ")}`);
    process.exit(2);
  }
  const budgetFile = path.resolve(process.env.PERF_ROUTE_BUDGET_FILE ?? "perf-route-budget.json");
  const { routes, warmRuns } = loadBudget(budgetFile);

  const session = await signInGetSession({ supabaseUrl, supabaseAnonKey, email, password });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await setSessionCookie(context, session, supabaseUrl, baseUrl);
  const page = await context.newPage();
  const supabaseHost = new URL(supabaseUrl).host;

  const samples = [];
  try {
    for (const route of routes) samples.push(await measure(page, baseUrl, supabaseHost, route, "cold"));
    for (let run = 0; run < warmRuns; run += 1) {
      for (const route of routes) samples.push(await measure(page, baseUrl, supabaseHost, route, "warm"));
    }
  } finally {
    await context.close();
    await browser.close();
  }

  const failures = evaluateSamples(samples);
  const report = { checkedAt: new Date().toISOString(), baseUrl, budgetFile: path.basename(budgetFile), samples, failures };
  if (process.env.PERF_REPORT_FILE) fs.writeFileSync(process.env.PERF_REPORT_FILE, JSON.stringify(report, null, 2));

  for (const s of samples) {
    const flag = s.error ? "ERR " : s.contentReadyMs > s.budgetMs ? "OVER" : "ok  ";
    const dupes = s.duplicateRequests.length ? ` dup=${s.duplicateRequests.map((d) => `${d.n}x ${d.url}`).join("; ")}` : "";
    console.log(`[perf:routes] ${flag} ${s.phase.padEnd(4)} ${String(s.contentReadyMs).padStart(6)} ms / ${s.budgetMs} ${s.route} (${s.restRequests} REST)${s.error ? ` ${s.error}` : ""}${dupes}`);
  }
  if (failures.length > 0) {
    console.error(`[perf:routes] FAIL: ${failures.length} sample(s) over budget or not ready`);
    process.exit(1);
  }
  console.log(`[perf:routes] PASS: ${samples.length} samples within budget`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
}
