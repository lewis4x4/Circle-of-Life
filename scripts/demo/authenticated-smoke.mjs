#!/usr/bin/env node
/**
 * Authenticated smoke test harness.
 *
 * Blocked until Track A (A1) resolves the Supabase Auth blocker.
 * Once pilot users can sign in, this script logs in as each role
 * and verifies the expected shell routes load without redirect.
 *
 * Usage:
 *   BASE_URL=http://127.0.0.1:3000 npm run demo:auth-smoke:real
 *
 * Environment:
 *   BASE_URL           — app origin (default http://127.0.0.1:3000)
 *   PHASE1_DEMO_PASSWORD — pilot user password (default HavenDemo2026!)
 */
import process from "node:process";
import { chromium } from "playwright";

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const password = process.env.PHASE1_DEMO_PASSWORD ?? "HavenDemo2026!";

const PILOT_USERS = [
  {
    email: "jessica@circleoflifealf.com",
    role: "facility_admin",
    shell: "/admin",
    probe: "/admin/residents",
  },
  {
    email: "maria.garcia@circleoflifealf.com",
    role: "caregiver",
    shell: "/caregiver",
    probe: "/caregiver",
  },
  {
    email: "robert.sullivan@circleoflifealf.com",
    role: "family",
    shell: "/family",
    probe: "/family",
  },
];

async function testUser(browser, user) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const result = {
    email: user.email,
    role: user.role,
    login_ok: false,
    shell_route_ok: false,
    shell_url: null,
    error: null,
  };

  try {
    await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
    await page.getByLabel("Work Email").fill(user.email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();

    await page.waitForURL(
      (url) => !url.pathname.startsWith("/login"),
      { timeout: 15000 },
    );

    result.login_ok = true;
    result.shell_url = page.url();

    await page.goto(`${baseUrl}${user.probe}`, { waitUntil: "domcontentloaded" });
    await page.waitForURL(
      (url) => !url.pathname.startsWith("/login"),
      { timeout: 10000 },
    );

    result.shell_route_ok = page.url().includes(user.probe) || page.url().includes(user.shell);
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  } finally {
    await context.close();
  }

  return result;
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const results = [];

  for (const user of PILOT_USERS) {
    results.push(await testUser(browser, user));
  }

  await browser.close();

  const output = {
    checked_at: new Date().toISOString(),
    base_url: baseUrl,
    pilot_users: results,
    verdict: {
      all_login_ok: results.every((r) => r.login_ok),
      all_shell_ok: results.every((r) => r.shell_route_ok),
      pass: results.every((r) => r.login_ok && r.shell_route_ok),
    },
  };

  console.log(JSON.stringify(output, null, 2));
  process.exit(output.verdict.pass ? 0 : 1);
}

run().catch((error) => {
  console.error(
    JSON.stringify({
      checked_at: new Date().toISOString(),
      base_url: baseUrl,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, null, 2),
  );
  process.exit(1);
});
