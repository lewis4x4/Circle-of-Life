#!/usr/bin/env node
/**
 * Authenticated smoke test harness (Track A — supports PH1-A01 + PH1-A04).
 *
 * Logs in as each pilot role, verifies the probe route loads, then checks
 * cross-shell denial: wrong roles cannot stay on another shell's routes
 * (see admin-shell / caregiver-shell / family-shell).
 * For `/admin` shell users, asserts `data-testid="admin-facility-filter-trigger"` is visible (PH1-P04).
 *
 * Usage:
 *   BASE_URL=http://127.0.0.1:3000 npm run demo:auth-smoke:real
 *
 * Environment:
 *   BASE_URL               — app origin (default http://127.0.0.1:3000)
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
    /** After login, hitting this path must redirect away from caregiver shell. */
    crossShellDenial: [{ from: "/caregiver", expectPathPrefix: "/admin" }],
  },
  {
    email: "maria.garcia@circleoflifealf.com",
    role: "caregiver",
    shell: "/caregiver",
    probe: "/caregiver",
    crossShellDenial: [{ from: "/admin/residents", expectPathPrefix: "/caregiver" }],
  },
  {
    email: "robert.sullivan@circleoflifealf.com",
    role: "family",
    shell: "/family",
    probe: "/family",
    crossShellDenial: [
      { from: "/admin/residents", expectPathPrefix: "/family" },
      { from: "/caregiver", expectPathPrefix: "/family" },
    ],
  },
];

/**
 * @param {{ from: string, expectPathPrefix: string }} probe
 */
function pathMatchesExpectation(pathname, probe) {
  return (
    pathname === probe.expectPathPrefix ||
    pathname.startsWith(`${probe.expectPathPrefix}/`)
  );
}

async function testUser(browser, user) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const result = {
    email: user.email,
    role: user.role,
    login_ok: false,
    shell_route_ok: false,
    /** `true` | `false` when admin shell; `null` for caregiver/family. */
    admin_facility_filter_ok: null,
    cross_shell_ok: null,
    cross_shell_probes: [],
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

    if (user.shell === "/admin") {
      result.admin_facility_filter_ok = await page
        .getByTestId("admin-facility-filter-trigger")
        .isVisible()
        .catch(() => false);
    }

    const probes = user.crossShellDenial ?? [];
    if (probes.length === 0) {
      result.cross_shell_ok = true;
    } else {
      const probeResults = [];
      for (const probe of probes) {
        await page.goto(`${baseUrl}${probe.from}`, { waitUntil: "domcontentloaded" });
        await page.waitForURL(
          (url) => pathMatchesExpectation(url.pathname, probe),
          { timeout: 15000 },
        );
        const pathname = new URL(page.url()).pathname;
        const ok = pathMatchesExpectation(pathname, probe);
        probeResults.push({
          from: probe.from,
          final_pathname: pathname,
          expectPathPrefix: probe.expectPathPrefix,
          ok,
        });
      }
      result.cross_shell_probes = probeResults;
      result.cross_shell_ok = probeResults.every((p) => p.ok);
    }
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
      all_cross_shell_ok: results.every((r) => r.cross_shell_ok !== false),
      all_admin_facility_filter_ok: results.every(
        (r) => r.admin_facility_filter_ok !== false,
      ),
      pass: results.every(
        (r) =>
          r.login_ok &&
          r.shell_route_ok &&
          r.cross_shell_ok !== false &&
          r.admin_facility_filter_ok !== false,
      ),
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
