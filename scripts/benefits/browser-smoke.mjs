#!/usr/bin/env node
/** Real production UI/CSS, synthetic API transport only. All external traffic is denied. */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const here = path.dirname(fileURLToPath(import.meta.url)),
  root = path.resolve(here, "../..");
const output = path.join(root, "test-results/benefits");
const scratch = path.join(
  process.env.HOME,
  ".hermes/tmp/agent-runs",
  `benefits-browser-${Date.now()}`,
);
await fs.mkdir(scratch, { recursive: true, mode: 0o700 });
await fs.mkdir(output, { recursive: true });
const manifestPath = path.join(scratch, "manifest.json");
await fs.writeFile(
  manifestPath,
  JSON.stringify({
    schema_version: 1,
    run_id: path.basename(scratch),
    created_by: "codex",
    artifacts: [],
  }),
  { mode: 0o600 },
);
const server = await createServer({
  root: here,
  cacheDir: path.join(scratch, "vite-cache"),
  configFile: false,
  plugins: [react()],
  define: { "process.env": {} },
  resolve: {
    alias: [
      {
        find: "next/link",
        replacement: path.join(
          root,
          "scripts/employee-lifecycle/fixture-link.tsx",
        ),
      },
      {
        find: "next/navigation",
        replacement: path.join(here, "fixture-navigation.ts"),
      },
      {
        find: "@/hooks/useFacilityStore",
        replacement: path.join(here, "fixture-facility.ts"),
      },
      {
        find: "@/lib/supabase/client",
        replacement: path.join(here, "fixture-supabase.ts"),
      },
      { find: "@", replacement: path.join(root, "src") },
    ],
  },
  css: { postcss: path.join(root, "postcss.config.mjs") },
  server: { host: "127.0.0.1", port: 0, fs: { allow: [root] } },
  logLevel: "error",
});
const report = {
  evidence:
    "Real production React/CSS in Chromium with synthetic APIs. No hosted authentication, RLS, storage transport or provider submission proof.",
  states: [],
  unexpected: [],
};
const resident = "11111111-1111-4111-8111-111111111111",
  facility = "22222222-2222-4222-8222-222222222222",
  caseId = "33333333-3333-4333-8333-333333333333",
  staff = "44444444-4444-4444-8444-444444444444",
  doc = "55555555-5555-4555-8555-555555555555";
const endpoint = `/api/admin/benefits/cases/${caseId}`;
function fixture() {
  return {
    case: {
      id: caseId,
      organization_id: resident,
      resident_id: resident,
      facility_id: facility,
      admission_case_id: null,
      program: "smmc_ltc",
      status: "open",
      revision: 1,
      next_action: "Collect complete bank statement",
      assigned_to: staff,
      due_date: "2026-09-25",
      closure_reason: null,
      screening: { married: "unknown" },
      funding: {},
      created_at: "2026-09-21T12:00:00Z",
      updated_at: "2026-09-21T12:00:00Z",
      created_by: staff,
      resident_name: "Jordan Example",
      facility_name: "Example Facility",
      assignee_name: "Case Coordinator",
    },
    permissions: { can_write: true, can_review: true, can_manage_access: true },
    requirements: [
      {
        id: resident,
        case_id: caseId,
        title: "Signed medical certification",
        stage: "application",
        status: "accepted",
        assigned_to: staff,
        due_date: null,
        notes: null,
        document_id: doc,
        review_reason: "Actual form reviewed",
        signature_status: "verified",
        reviewed_by: staff,
        reviewed_at: "2026-09-21T12:00:00Z",
        updated_at: "2026-09-21T12:00:00Z",
      },
    ],
    documents: [
      {
        id: doc,
        case_id: caseId,
        filename: "signed-3008.pdf",
        mime_type: "application/pdf",
        size_bytes: 25,
        sha256: "a".repeat(64),
        storage_path: "fixture/private",
        status: "ready",
        document_type: "Actual signed AHCA 3008",
        template_version: "Current source form",
        created_at: "2026-09-21T12:00:00Z",
        created_by: staff,
      },
    ],
    events: [],
    submissions: [],
    receipts: [],
    history: [],
  };
}
let browser;
try {
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
  for (const width of [1440, 390]) {
    let data = fixture(),
      failNext = false,
      denyQueue = false,
      calls = [];
    const context = await browser.newContext({
        viewport: { width, height: 1000 },
      }),
      page = await context.newPage();
    page.on("pageerror", (e) => report.unexpected.push(e.message));
    await page.route("**/*", async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (url.origin !== base) {
        report.unexpected.push(`External: ${url.origin}`);
        return route.abort();
      }
      if (!url.pathname.startsWith("/api/")) return route.continue();
      if (url.pathname === "/api/admin/benefits/options")
        return route.fulfill({
          json: {
            facilities: [{ id: facility, name: "Example Facility" }],
            residents: [
              { id: resident, name: "Jordan Example", facility_id: facility },
            ],
            assignees: [
              { id: staff, name: "Case Coordinator", facility_id: facility },
            ],
            can_manage_access: true,
          },
        });
      if (url.pathname === "/api/admin/benefits/access")
        return route.fulfill({
          json: {
            grants: [],
            users: [
              { id: staff, name: "Case Coordinator", facility_id: facility },
            ],
            can_manage: true,
          },
        });
      if (url.pathname === "/api/admin/benefits/cases")
        return route.fulfill(
          denyQueue
            ? { status: 403, json: { error: "Restricted" } }
            : { json: { cases: [data.case], next_cursor: null } },
        );
      if (url.pathname === endpoint) return route.fulfill({ json: data });
      if (url.pathname === `${endpoint}/collection`)
        return route.fulfill({
          json: {
            requests: [],
            eligible_family: [],
            users: [],
            can_manage: true,
          },
        });
      if (url.pathname === `${endpoint}/commands`) {
        const body = request.postDataJSON();
        calls.push(body);
        if (failNext) {
          failNext = false;
          return route.fulfill({
            status: 409,
            json: { error: "Synthetic conflict" },
          });
        }
        data.case.revision++;
        if (body.action === "update_case")
          Object.assign(data.case, body.payload);
        if (body.action === "record_event")
          data.events.push({
            ...body.payload,
            id: resident,
            case_id: caseId,
            created_at: "2026-09-21T13:00:00Z",
            created_by: staff,
          });
        return route.fulfill({
          json: { case_id: caseId, revision: data.case.revision },
        });
      }
      report.unexpected.push(
        `Unexpected API: ${request.method()} ${url.pathname}`,
      );
      return route.fulfill({
        status: 500,
        json: { error: "Unexpected fixture API" },
      });
    });
    const inspect = async (name) => {
      await page.mouse.move(0, 0);
      await page.evaluate(async () => {
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        await Promise.allSettled(
          document
            .getAnimations()
            .filter((a) => a.effect?.getTiming().iterations !== Infinity)
            .map((a) => a.finished),
        );
      });
      const scroll = await page.evaluate(
        () => document.documentElement.scrollWidth,
      );
      expect(scroll).toBeLessThanOrEqual(width + 1);
      const axe = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      report.states.push({
        width,
        name,
        overflow: scroll,
        violations: axe.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.map((n) => n.target),
        })),
      });
      await page.screenshot({
        path: path.join(output, `${width}-${name}.png`),
        fullPage: true,
      });
    };
    await page.goto(base);
    await expect(
      page.getByRole("heading", { name: "Jordan Example · Benefits" }),
    ).toBeVisible();
    await inspect("overview");
    await page.getByLabel("Monthly income ($)", { exact: true }).fill("0");
    await page.getByRole("button", { name: "Save screening facts" }).click();
    await expect(page.getByRole("status")).toContainText("Saved successfully");
    expect(calls.at(-1).payload.screening.income_cents).toBe(0);
    expect(calls.at(-1).payload.screening.assets_cents).toBe(null);
    await page
      .getByLabel("Screening notes and exceptions")
      .fill("Draft retained after conflict");
    failNext = true;
    await page.getByRole("button", { name: "Save screening facts" }).click();
    await expect(page.getByRole("alert")).toContainText("This case changed");
    await expect(page.getByLabel("Screening notes and exceptions")).toHaveValue(
      "Draft retained after conflict",
    );
    await inspect("conflict");
    await page.getByRole("tab", { name: "Requirements & evidence" }).click();
    await inspect("evidence");
    await page.getByRole("tab", { name: "Agency history" }).click();
    await page.getByRole("combobox", { name: /^Agency \*/ }).selectOption("dcf");
    await page.getByLabel(/^Event/).selectOption("eligibility");
    await page.getByLabel(/^Outcome/).selectOption("approved");
    await page.getByLabel("Source event date").fill("2026-09-20");
    await page.getByLabel("Source evidence", { exact: true }).selectOption(doc);
    await page.getByLabel("Type of record").selectOption("true");
    await page.getByRole("button", { name: "Record agency event" }).click();
    await expect(page.getByText("DCF · Eligibility · approved")).toBeVisible();
    expect(calls.at(-1).payload.formal_decision).toBe(true);
    await inspect("agency");
    await page.getByRole("tab", { name: "Submissions" }).click();
    await expect(
      page.getByRole("button", { name: "Download reviewed packet (0 files)" }),
    ).toBeDisabled();
    await page.getByRole("checkbox").check();
    await expect(
      page.getByRole("button", { name: "Download reviewed packet (1 files)" }),
    ).toBeEnabled();
    await inspect("submissions");
    await page.getByRole("tab", { name: "Funding & renewal" }).click();
    await inspect("funding");
    await page.goto(`${base}/?view=queue`);
    await expect(
      page.getByRole("link", { name: "Jordan Example", exact: true }),
    ).toBeVisible();
    await inspect("queue");
    denyQueue = true;
    await page.getByRole("button", { name: "Refresh queue" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Benefits access is restricted",
    );
    await expect(
      page.getByText("No benefits cases match", { exact: false }),
    ).toHaveCount(0);
    await inspect("access-denied");
    await context.close();
  }
  expect(report.unexpected).toEqual([]);
  expect(
    report.states.flatMap((s) =>
      s.violations.map((v) => ({ width: s.width, state: s.name, ...v })),
    ),
  ).toEqual([]);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error.stack;
  throw error;
} finally {
  await browser?.close();
  await server.close();
  const files = [],
    dirs = [];
  async function owned(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const item = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await owned(item);
        dirs.push(item);
      } else if (entry.isFile()) files.push(item);
      else throw new Error(`Unrecognized cache entry: ${item}`);
    }
  }
  const cache = path.join(scratch, "vite-cache");
  try {
    await owned(cache);
    await fs.writeFile(
      manifestPath,
      JSON.stringify(
        {
          schema_version: 1,
          run_id: path.basename(scratch),
          created_by: "codex",
          artifacts: files,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    const checked = spawnSync(
      "jarvis-storage-steward",
      ["cleanup-run", "--manifest", manifestPath],
      { encoding: "utf8" },
    );
    if (checked.status === 0) {
      for (const file of files) await fs.unlink(file);
      for (const dir of dirs) await fs.rmdir(dir);
      await fs.rmdir(cache);
      report.cleanup = {
        validated: true,
        removed: files.length,
        manifest: manifestPath,
      };
    } else
      report.cleanup = {
        validated: false,
        retained: scratch,
        error: checked.stderr || checked.error?.message,
      };
  } catch (error) {
    report.cleanup = {
      validated: false,
      retained: scratch,
      error: error.message,
    };
  }
  await fs.writeFile(
    path.join(output, "browser-smoke.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      status: report.status,
      states: report.states.length,
      output,
      cleanup: report.cleanup,
    }),
  );
}
