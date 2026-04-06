#!/usr/bin/env node
import process from "node:process";
import { chromium } from "playwright";

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const invalidEmail = process.env.AUTH_SMOKE_INVALID_EMAIL ?? "nobody@example.com";
const invalidPassword = process.env.AUTH_SMOKE_INVALID_PASSWORD ?? "wrong-password";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const result = {
    checked_at: new Date().toISOString(),
    base_url: baseUrl,
    redirect_check: {
      pass: false,
      final_url: null,
    },
    invalid_credentials_check: {
      pass: false,
      final_url: null,
      error_text: null,
    },
  };

  try {
    await page.goto(`${baseUrl}/admin/residents`, { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/login(\?|$)/, { timeout: 10000 });
    result.redirect_check.final_url = page.url();
    result.redirect_check.pass = page.url().includes("/login?next=%2Fadmin%2Fresidents");

    await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
    await page.getByLabel("Work Email").fill(invalidEmail);
    await page.getByLabel("Password").fill(invalidPassword);
    await page.getByRole("button", { name: /sign in/i }).click();

    const error = page.getByText(
      /Invalid login credentials|Sign-in request failed to complete|Database error querying schema/i,
    );
    await error.first().waitFor({ timeout: 10000 });

    const errorText = (await error.first().textContent())?.trim() ?? null;
    result.invalid_credentials_check.final_url = page.url();
    result.invalid_credentials_check.error_text = errorText;
    result.invalid_credentials_check.pass = errorText === "Invalid login credentials";

    console.log(
      JSON.stringify(
        {
          ...result,
          verdict: {
            pass: result.redirect_check.pass && result.invalid_credentials_check.pass,
          },
        },
        null,
        2,
      ),
    );

    process.exit(result.redirect_check.pass && result.invalid_credentials_check.pass ? 0 : 1);
  } finally {
    await browser.close();
  }
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
