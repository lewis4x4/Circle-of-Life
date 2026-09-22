import { type Page, type APIRequestContext, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const HOMEWOOD_FACILITY_ID =
  process.env.HOMEWOOD_FACILITY_ID ?? "00000000-0000-0000-0002-000000000003";

const PASSWORD =
  process.env.HOMEWOOD_LAUNCH_PASSWORD ?? process.env.PHASE1_DEMO_PASSWORD ?? "HavenDemo2026!";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/**
 * Homewood test accounts, one per role we need to exercise.
 *
 * These used to be the fictitious `@circleoflifealf.com` personas from
 * `canonical-roster.mjs`. Every one of them was retired from the pilot project
 * on 2026-09-16, so there is no default any more: supply real accounts via
 * `HOMEWOOD_LAUNCH_ACCOUNTS`, a JSON object keyed by role. Tests that need an
 * account skip with a clear message when it is absent rather than signing in as
 * somebody unexpected.
 */
// Account-map keys, not app roles: since COL-615 (2026-09-22) the "caregiver" and
// "nurse" accounts hold med_tech and "dietary" holds cook (see auth-verify.mjs).
export type Role = "owner" | "facility_admin" | "caregiver" | "med_tech" | "family" | "nurse" | "dietary";

function readHomewoodAccounts(): Partial<Record<Role, string>> {
  const raw = process.env.HOMEWOOD_LAUNCH_ACCOUNTS;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Partial<Record<Role, string>>;
  } catch {
    throw new Error("HOMEWOOD_LAUNCH_ACCOUNTS is not valid JSON — expected an object keyed by role.");
  }
}

export const HOMEWOOD_ACCOUNTS: Partial<Record<Role, string>> = readHomewoodAccounts();

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
  if (!email) {
    test.skip(
      true,
      `No account configured for role '${role}'. Set HOMEWOOD_LAUNCH_ACCOUNTS — the old @circleoflifealf.com personas were retired 2026-09-16.`,
    );
    return;
  }
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
