#!/usr/bin/env node
/**
 * Measures authenticated client-side admin navigations with Playwright.
 *
 * Unlike the old full-page/network-idle probe, this harness measures the two
 * moments an operator actually experiences:
 *   1. click → immediate shell/transition feedback
 *   2. click → destination content ready
 *
 * Usage:
 *   PERF_USER_EMAIL=... PHASE1_DEMO_PASSWORD=... \
 *   BASE_URL=https://circleoflifealf.netlify.app \
 *   node scripts/perf/admin-navigation-latency.mjs
 *
 * Optional:
 *   ROUTES=/admin/staff,/admin/schedules,/admin/finance,/admin/residents
 *   WARM_RUNS=2
 *   PERF_SHELL_BUDGET_MS=250
 *   PERF_CONTENT_BUDGET_MS=2500
 *   PERF_ENFORCE_BUDGETS=1
 */
import process from "node:process";
import { chromium } from "playwright";

const baseUrl = (process.env.BASE_URL ?? "https://circleoflifealf.netlify.app").replace(/\/$/, "");
const email = process.env.PERF_USER_EMAIL?.trim();
const password = process.env.PHASE1_DEMO_PASSWORD;
const warmRuns = Math.max(1, Number(process.env.WARM_RUNS ?? "2"));
const shellBudgetMs = Number(process.env.PERF_SHELL_BUDGET_MS ?? "250");
const contentBudgetMs = Number(process.env.PERF_CONTENT_BUDGET_MS ?? "2500");
const enforceBudgets = process.env.PERF_ENFORCE_BUDGETS === "1";
const routes = (
  process.env.ROUTES ??
  "/admin/staff,/admin/schedules,/admin/finance,/admin/residents,/admin"
)
  .split(",")
  .map((route) => route.trim())
  .filter(Boolean);

if (!email || !password) {
  throw new Error(
    "PERF_USER_EMAIL and PHASE1_DEMO_PASSWORD are required; credentials are never embedded in the probe.",
  );
}

function percentile(sortedValues, pct) {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(
    sortedValues.length - 1,
    Math.ceil(sortedValues.length * pct) - 1,
  );
  return sortedValues[index];
}

function rounded(value) {
  return Math.round(value * 10) / 10;
}

async function signIn(page) {
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Work Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 45_000,
  });
  await page.locator("main").waitFor({ state: "visible", timeout: 30_000 });
  await page
    .locator('[data-testid="admin-route-loading"]')
    .waitFor({ state: "detached", timeout: 30_000 })
    .catch(() => {});
}

async function openNavigationTarget(page, route) {
  const escapedRoute = route.replaceAll('"', '\\"');
  const visibleLink = page.locator(`a[href="${escapedRoute}"]:visible`).first();

  if ((await visibleLink.count()) > 0) {
    return visibleLink;
  }

  await page.getByRole("button", { name: /open search/i }).first().click();
  await page
    .getByRole("dialog", { name: "Command palette" })
    .waitFor({ state: "visible", timeout: 5_000 });
  const commandItem = page.locator("[cmdk-item]");

  const directValueItem = page
    .locator(`[cmdk-item][data-value*="${escapedRoute}"]`)
    .first();

  await directValueItem.waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
  if ((await directValueItem.count()) > 0 && (await directValueItem.isVisible())) {
    return directValueItem;
  }

  // cmdk currently puts the configured value on data-value. Keep the fallback
  // diagnostic explicit if its DOM contract changes.
  const availableValues = await commandItem
    .evaluateAll((items) => items.map((item) => item.getAttribute("data-value")))
    .catch(() => []);
  throw new Error(
    `No visible link or command-palette item for ${route}. Available palette values: ${JSON.stringify(availableValues)}`,
  );
}

async function installClickProbe(page) {
  await page.evaluate(() => {
    const state = {
      start: null,
      shell: null,
      shellKind: null,
    };

    const identifyShell = (node) => {
      if (!(node instanceof Element)) return null;
      if (node.matches('[data-testid="admin-navigation-feedback"]')) {
        return "navigation-feedback";
      }
      if (node.matches('[data-testid="admin-route-loading"]')) {
        return "route-loading";
      }
      if (node.querySelector('[data-testid="admin-navigation-feedback"]')) {
        return "navigation-feedback";
      }
      if (node.querySelector('[data-testid="admin-route-loading"]')) {
        return "route-loading";
      }
      return null;
    };

    const observer = new MutationObserver((records) => {
      if (state.start == null || state.shell != null) return;
      for (const record of records) {
        for (const node of record.addedNodes) {
          const kind = identifyShell(node);
          if (kind) {
            state.shell = performance.now();
            state.shellKind = kind;
            return;
          }
        }
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    document.addEventListener(
      "click",
      () => {
        state.start = performance.now();
        const existing =
          document.querySelector('[data-testid="admin-navigation-feedback"]') ??
          document.querySelector('[data-testid="admin-route-loading"]');
        if (existing) {
          state.shell = performance.now();
          state.shellKind = existing.getAttribute("data-testid");
        }
      },
      { capture: true, once: true },
    );

    window.__havenAdminNavigationProbe = { state, observer };
  });
}

async function measureNavigation(page, route, phase, run) {
  const destination = new URL(route, baseUrl);
  if (
    page.url().startsWith(baseUrl) &&
    new URL(page.url()).pathname === destination.pathname &&
    new URL(page.url()).search === destination.search
  ) {
    const sourceRoute =
      destination.pathname === "/admin"
        ? (routes.find((candidate) => candidate !== route) ?? "/admin/staff")
        : "/admin";
    await page.goto(`${baseUrl}${sourceRoute}`, { waitUntil: "domcontentloaded" });
    await page.locator("main").waitFor({ state: "visible" });
  }

  const target = await openNavigationTarget(page, route);
  await installClickProbe(page);
  await target.click();

  await page.waitForFunction(
    () => window.__havenAdminNavigationProbe?.state.shell != null,
    undefined,
    { timeout: 5_000 },
  );

  await page.waitForURL(
    (url) =>
      url.pathname === destination.pathname && url.search === destination.search,
    { timeout: 45_000 },
  );
  await page.waitForFunction(
    ({ pathname, search }) => {
      const main = document.querySelector("main");
      return (
        window.location.pathname === pathname &&
        window.location.search === search &&
        main != null &&
        !main.querySelector('[data-testid="admin-route-loading"]') &&
        (main.textContent?.trim().length ?? 0) > 0
      );
    },
    { pathname: destination.pathname, search: destination.search },
    { timeout: 45_000 },
  );

  const timing = await page.evaluate(() => {
    const probe = window.__havenAdminNavigationProbe;
    if (!probe || probe.state.start == null || probe.state.shell == null) {
      throw new Error("Navigation probe timing was lost.");
    }
    const result = {
      shellMs: probe.state.shell - probe.state.start,
      contentMs: performance.now() - probe.state.start,
      shellKind: probe.state.shellKind,
    };
    probe.observer.disconnect();
    delete window.__havenAdminNavigationProbe;
    return result;
  });

  return {
    phase,
    run,
    route,
    shellMs: rounded(timing.shellMs),
    contentMs: rounded(timing.contentMs),
    shellKind: timing.shellKind,
  };
}

function summarize(samples, metric) {
  const values = samples.map((sample) => sample[metric]).sort((a, b) => a - b);
  return {
    median: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    samples: values,
  };
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);

  try {
    await signIn(page);

    const samples = [];
    for (const route of routes) {
      samples.push(await measureNavigation(page, route, "cold", 1));
    }
    for (let runNumber = 1; runNumber <= warmRuns; runNumber += 1) {
      for (const route of routes) {
        samples.push(await measureNavigation(page, route, "warm", runNumber));
      }
    }

    const byPhase = Object.fromEntries(
      ["cold", "warm"].map((phase) => {
        const phaseSamples = samples.filter((sample) => sample.phase === phase);
        return [
          phase,
          {
            shell: summarize(phaseSamples, "shellMs"),
            content: summarize(phaseSamples, "contentMs"),
          },
        ];
      }),
    );
    const byRoute = Object.fromEntries(
      routes.map((route) => {
        const routeSamples = samples.filter((sample) => sample.route === route);
        return [
          route,
          {
            cold: {
              shell: summarize(
                routeSamples.filter((sample) => sample.phase === "cold"),
                "shellMs",
              ),
              content: summarize(
                routeSamples.filter((sample) => sample.phase === "cold"),
                "contentMs",
              ),
            },
            warm: {
              shell: summarize(
                routeSamples.filter((sample) => sample.phase === "warm"),
                "shellMs",
              ),
              content: summarize(
                routeSamples.filter((sample) => sample.phase === "warm"),
                "contentMs",
              ),
            },
          },
        ];
      }),
    );

    const budgetFailures = samples.filter(
      (sample) =>
        sample.shellMs > shellBudgetMs || sample.contentMs > contentBudgetMs,
    );

    console.log(
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          baseUrl,
          routes,
          warmRuns,
          budgets: {
            shellMs: shellBudgetMs,
            contentMs: contentBudgetMs,
            enforced: enforceBudgets,
          },
          byPhase,
          byRoute,
          budgetFailures,
          samples,
        },
        null,
        2,
      ),
    );

    if (enforceBudgets && budgetFailures.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
