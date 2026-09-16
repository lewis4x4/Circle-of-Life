#!/usr/bin/env node
/**
 * Print smoke: render one care-plan print sheet to PDF through headless Chromium
 * and check it is a real, multi-page-safe document — not a render test.
 *
 * Env:
 *   BASE_URL                 default http://127.0.0.1:3000
 *   NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY   (same as a11y-authenticated)
 *   PRINT_SMOKE_PLAN_ID      required — the care_plans.id to print
 *   PRINT_SMOKE_EXPECT       optional text that must appear in the PDF (e.g. the resident's name)
 *   PRINT_SMOKE_OUT          default test-results/print-smoke/care-plan.pdf
 *   SCREENSHOT_USER_EMAIL / PHASE1_DEMO_PASSWORD   login, same as a11y-authenticated
 *
 * Needs a running app against a Supabase project the login can reach. Not a CI gate.
 */
import fs from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const password = process.env.PHASE1_DEMO_PASSWORD ?? "HavenDemo2026!";
const email = process.env.SCREENSHOT_USER_EMAIL;
if (!email) {
  console.error("[print-smoke] SCREENSHOT_USER_EMAIL is required.");
  console.error("[print-smoke] The old default (jessica.murphy@circleoflifealf.com) was a fictitious persona retired 2026-09-16; there is no account behind it any more.");
  process.exit(2);
}
const planId = process.env.PRINT_SMOKE_PLAN_ID;
const expectText = process.env.PRINT_SMOKE_EXPECT;
const outPath = process.env.PRINT_SMOKE_OUT ?? path.join("test-results", "print-smoke", "care-plan.pdf");

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("[print-smoke] Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  process.exit(2);
}
if (!planId) {
  console.error("[print-smoke] Set PRINT_SMOKE_PLAN_ID to a care_plans.id.");
  process.exit(2);
}

function projectRefFromUrl(url) {
  return new URL(url).hostname.split(".")[0];
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

async function run() {
  console.log(`[print-smoke] signing in as ${email}`);
  const session = await signInGetSession();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await setSessionCookie(context, session);
  const page = await context.newPage();
  try {
    const url = `${baseUrl}/print/care-plans/${planId}?auto=0`;
    console.log(`[print-smoke] ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector("article#care-plan-print", { timeout: 20000 });

    const navCount = await page.locator("nav").count();
    if (navCount > 0) throw new Error(`Sheet rendered with ${navCount} nav landmark(s); the shell leaked into the print route.`);

    await page.emulateMedia({ media: "print" });
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const pdf = await page.pdf({ path: outPath, format: "Letter", printBackground: true });
    const pageCount = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    if (pageCount < 1) throw new Error("PDF has no pages");

    const bodyText = await page.locator("article#care-plan-print").innerText();
    if (expectText && !bodyText.includes(expectText)) {
      throw new Error(`Sheet text does not contain "${expectText}"`);
    }
    console.log(`[print-smoke] PASS — ${pageCount} page(s) written to ${outPath}`);
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error(`[print-smoke] FAIL — ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
