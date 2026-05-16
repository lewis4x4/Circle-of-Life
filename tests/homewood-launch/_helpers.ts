import { type Page, type APIRequestContext, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const HOMEWOOD_FACILITY_ID =
  process.env.HOMEWOOD_FACILITY_ID ?? "00000000-0000-0000-0002-000000000003";

const PASSWORD =
  process.env.HOMEWOOD_LAUNCH_PASSWORD ?? process.env.PHASE1_DEMO_PASSWORD ?? "HavenDemo2026!";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/**
 * Canonical Homewood test accounts. One per role we need to exercise.
 * Mirrors the canonical-roster.mjs accounts that authenticate cleanly in
 * Sprint 2's verify run.
 */
export const HOMEWOOD_ACCOUNTS = {
  owner: "milton.smith@circleoflifealf.com",
  facility_admin: "jessica.murphy@circleoflifealf.com",
  caregiver: "maria.garcia@circleoflifealf.com",
  med_tech: "medtech@circleoflifealf.com",
  family: "linda.chen@circleoflifealf.com",
  nurse: "sarah.williams@circleoflifealf.com",
  dietary: "dietary@circleoflifealf.com",
} as const;

export type Role = keyof typeof HOMEWOOD_ACCOUNTS;

export function adminClient(): SupabaseClient {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error("Supabase URL/service-role-key not set — populate .env.local before running Homewood workflow tests.");
  }
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Sign in via the Next.js login form. Designed to work with the Haven
 * `/login` route. Tests skip with a clear message if the server can't be
 * reached or the credentials are rejected — we don't want a workflow test
 * to be the first place a missing dev server is detected.
 */
export async function signIn(page: Page, role: Role): Promise<void> {
  const email = HOMEWOOD_ACCOUNTS[role];
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 }),
    page.getByRole("button", { name: /sign in|log in/i }).click(),
  ]);
}

/**
 * Skip the current test if Homewood has no active residents — the most
 * common precondition failure. Re-runs are idempotent (the count check
 * doesn't mutate).
 */
export async function requireHomewoodResidents(min = 1): Promise<number> {
  const supa = adminClient();
  const { count, error } = await supa
    .from("residents")
    .select("id", { count: "exact", head: true })
    .eq("facility_id", HOMEWOOD_FACILITY_ID)
    .is("deleted_at", null)
    .eq("status", "active");
  if (error) {
    test.skip(true, `Homewood resident query failed: ${error.message}`);
  }
  if ((count ?? 0) < min) {
    test.skip(true, `Homewood has ${count ?? 0} active residents — needs ≥${min} for this workflow.`);
  }
  return count ?? 0;
}

/**
 * Tag for test-only data so cleanup is deterministic. Workflows that
 * mutate data must include this string in a free-text field so the cleanup
 * helper can find and revert.
 */
export const TEST_MARKER = "homewood-launch-test:auto";

/**
 * Best-effort cleanup of test-marked rows for a given table/column. Logs
 * and continues on error — the next run's idempotency check will catch
 * any drift.
 */
export async function cleanupTestRows(table: string, markerColumn: string): Promise<void> {
  const supa = adminClient();
  const { error } = await supa.from(table).delete().like(markerColumn, `%${TEST_MARKER}%`);
  if (error) {
    // eslint-disable-next-line no-console
    console.warn(`[homewood-launch] cleanup ${table}.${markerColumn} failed: ${error.message}`);
  }
}

export const HOMEWOOD = {
  facilityId: HOMEWOOD_FACILITY_ID,
  baseUrl: process.env.BASE_URL ?? "http://127.0.0.1:4310",
};

export { test, expect } from "@playwright/test";

/**
 * Re-exported APIRequestContext type so individual specs can declare
 * helper functions without importing it from Playwright again.
 */
export type { APIRequestContext };
