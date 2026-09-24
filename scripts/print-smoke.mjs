#!/usr/bin/env node
/**
 * Print smoke: render the print sheets to PDF through headless Chromium and
 * check each is a real, paginated document — not a render test.
 *
 * COL-794 added the resident face sheet, the sheet Homewood actually prints.
 * Use a demo resident: opening a face sheet writes an audit row and the PDF on
 * disk contains PHI for a real one.
 *
 * Env:
 *   BASE_URL                 default http://127.0.0.1:3000
 *   NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY   (same as a11y-authenticated)
 *   PRINT_SMOKE_PLAN_ID      the care_plans.id to print
 *   PRINT_SMOKE_RESIDENT_ID  the residents.id whose face sheet to print (demo resident only)
 *                            at least one of the two is required
 *   PRINT_SMOKE_EXPECT       optional text that must appear in every sheet (e.g. the resident's name)
 *   PRINT_SMOKE_OUT          default test-results/print-smoke/care-plan.pdf
 *   PRINT_SMOKE_FACE_SHEET_OUT  default test-results/print-smoke/face-sheet.pdf
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
const residentId = process.env.PRINT_SMOKE_RESIDENT_ID;
const expectText = process.env.PRINT_SMOKE_EXPECT;
const outPath = process.env.PRINT_SMOKE_OUT ?? path.join("test-results", "print-smoke", "care-plan.pdf");
const faceSheetOutPath = process.env.PRINT_SMOKE_FACE_SHEET_OUT ?? path.join("test-results", "print-smoke", "face-sheet.pdf");

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("[print-smoke] Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  process.exit(2);
}
if (!planId && !residentId) {
  console.error("[print-smoke] Set PRINT_SMOKE_PLAN_ID to a care_plans.id, PRINT_SMOKE_RESIDENT_ID to a demo residents.id, or both.");
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

/**
 * Render one sheet and assert the paper copy is usable: the app shell stayed
 * out, the sheet has text, and the PDF is a real paginated document rather
 * than a blank page — the failure Homewood reported.
 */
async function smokeSheet(page, { label, url, selector, out, expectHeadings = [] }) {
  console.log(`[print-smoke] ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector(selector, { timeout: 20000 });

  const navCount = await page.locator("nav").count();
  if (navCount > 0) throw new Error(`${label}: rendered with ${navCount} nav landmark(s); the shell leaked into the print route.`);

  // Fonts and the resident photo must be settled before the page is captured,
  // for the same reason the route waits before opening the print dialog.
  await page.evaluate(async (sel) => {
    await document.fonts?.ready;
    const root = document.querySelector(sel);
    await Promise.all(
      Array.from(root?.querySelectorAll("img") ?? []).map((img) =>
        img.complete && img.naturalWidth > 0 ? null : img.decode?.().catch(() => undefined),
      ),
    );
  }, selector);

  await page.emulateMedia({ media: "print" });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const pdf = await page.pdf({ path: out, format: "Letter", printBackground: true });
  const pageCount = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  if (pageCount < 1) throw new Error(`${label}: PDF has no pages`);

  const bodyText = await page.locator(selector).innerText();
  if (bodyText.trim().length < 80) throw new Error(`${label}: sheet rendered blank (${bodyText.trim().length} chars)`);
  for (const heading of expectHeadings) {
    if (!bodyText.includes(heading)) throw new Error(`${label}: sheet is missing "${heading}" — incomplete print`);
  }
  if (expectText && !bodyText.includes(expectText)) {
    throw new Error(`${label}: sheet text does not contain "${expectText}"`);
  }

  console.log(`[print-smoke] PASS ${label} — ${pageCount} page(s) written to ${out}`);
}

async function run() {
  console.log(`[print-smoke] signing in as ${email}`);
  const session = await signInGetSession();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await setSessionCookie(context, session);
  const page = await context.newPage();
  try {
    if (planId) {
      await smokeSheet(page, {
        label: "care-plan",
        url: `${baseUrl}/print/care-plans/${planId}?auto=0`,
        selector: "article#care-plan-print",
        out: outPath,
      });
    }
    if (residentId) {
      await smokeSheet(page, {
        label: "face-sheet",
        url: `${baseUrl}/print/residents/${residentId}/face-sheet?auto=0`,
        selector: "article#resident-face-sheet",
        out: faceSheetOutPath,
        // Every section a transport or a surveyor reads must survive to paper.
        expectHeadings: ["Resident face sheet", "Code status", "Allergies", "Clinical", "Contacts and physician", "Coverage"],
      });
    }
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error(`[print-smoke] FAIL — ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
