#!/usr/bin/env node
/**
 * Authenticated smoke test for Executive Standup PDF generation.
 *
 * Usage:
 *   BASE_URL=http://127.0.0.1:3000 \
 *   STANDUP_TEST_EMAIL=msmith.gsms@gmail.com \
 *   PHASE1_DEMO_PASSWORD='...' \
 *   npm run demo:standup-pdf-smoke
 */
import process from "node:process";
import { chromium } from "playwright";

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const email = process.env.STANDUP_TEST_EMAIL ?? "msmith.gsms@gmail.com";
const password = process.env.PHASE1_DEMO_PASSWORD ?? "HavenDemo2026!";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const output = {
    checked_at: new Date().toISOString(),
    base_url: baseUrl,
    email,
    login_ok: false,
    history_ok: false,
    board_ok: false,
    pdf_ok: false,
    pdf_status: null,
    pdf_content_type: null,
    pdf_size_bytes: null,
    week: null,
    error: null,
  };

  try {
    await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
    await page.getByLabel("Work Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15000 });
    output.login_ok = true;

    await page.goto(`${baseUrl}/admin/executive/standup/history`, { waitUntil: "domcontentloaded" });
    await page.waitForURL((url) => url.pathname.startsWith("/admin/executive/standup/history"), { timeout: 15000 });
    output.history_ok = true;

    const firstWeekHref = await page.locator('a[href^="/admin/executive/standup/"]').filter({ hasText: "Open week" }).first().getAttribute("href");
    if (!firstWeekHref) {
      throw new Error("No standup week found in history.");
    }

    const week = firstWeekHref.split("/").pop();
    if (!week) throw new Error("Could not parse standup week.");
    output.week = week;

    await page.goto(`${baseUrl}/admin/executive/standup/${week}/board`, { waitUntil: "domcontentloaded" });
    await page.waitForURL((url) => url.pathname === `/admin/executive/standup/${week}/board`, { timeout: 15000 });
    output.board_ok = await page.getByRole("button", { name: /download pdf/i }).isVisible().catch(() => false);

    const pdfResult = await page.evaluate(async (pdfUrl) => {
      const response = await fetch(pdfUrl, { credentials: "include" });
      const buffer = await response.arrayBuffer();
      return {
        status: response.status,
        contentType: response.headers.get("content-type"),
        size: buffer.byteLength,
      };
    }, `${baseUrl}/api/executive/standup/${week}/pdf`);

    output.pdf_status = pdfResult.status;
    output.pdf_content_type = pdfResult.contentType;
    output.pdf_size_bytes = pdfResult.size;
    output.pdf_ok = pdfResult.status === 200 && pdfResult.contentType?.includes("application/pdf") && pdfResult.size > 1024;
  } catch (error) {
    output.error = error instanceof Error ? error.message : String(error);
  } finally {
    await context.close();
    await browser.close();
  }

  console.log(JSON.stringify(output, null, 2));
  process.exit(output.login_ok && output.history_ok && output.board_ok && output.pdf_ok ? 0 : 1);
}

run().catch((error) => {
  console.error(
    JSON.stringify(
      {
        checked_at: new Date().toISOString(),
        base_url: baseUrl,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
