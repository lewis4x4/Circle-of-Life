import { type Page, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Helpers for the `smart-rounding` Playwright project, spec 25A section 12.
 *
 * The one rule this file exists to enforce: the project is skippable by
 * configuration and is never silently skipped once the configuration says run.
 *
 *   SMART_ROUNDING_E2E unset      every spec skips, with the variable named in
 *                                 the skip reason, which Playwright prints
 *   SMART_ROUNDING_E2E set        every missing credential is a thrown error
 *                                 and a red suite, never a skip
 *
 * The distinction matters because this build has already shipped two silent
 * skips: twenty six Edge Function test files no gate executed, and a fixture
 * that only drove the code path which already worked. A suite that reports
 * "12 skipped, 0 failed" and is read as green is the same defect.
 *
 * Every value that shapes an assertion is read out of a configuration row.
 * There is no observation time, grace value, escalation offset, threshold or
 * shift boundary anywhere in this project. Tests and fixtures are the one place
 * acceptance 19 allows a literal, and this project does not need the allowance.
 */

export type SmartRoundingRole = "owner" | "facility_admin" | "manager" | "nurse" | "caregiver";

const ROLE_KEYS: SmartRoundingRole[] = ["owner", "facility_admin", "manager", "nurse", "caregiver"];

function flag(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

/** True when the operator has asked for this project to run. */
export const SMART_ROUNDING_ENABLED = flag("SMART_ROUNDING_E2E");

const SKIP_REASON =
  "SMART_ROUNDING_E2E is not set, so the Smart Rounding project did not run. " +
  "Set SMART_ROUNDING_E2E=1 together with SMART_ROUNDING_E2E_ACCOUNTS, SMART_ROUNDING_FACILITY_ID, " +
  "NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY to run it.";

/**
 * Call once at the top of every spec file. Skips the file when the project is
 * off, and says why in a form Playwright surfaces in its report.
 */
export function skipUnlessEnabled(): void {
  test.skip(!SMART_ROUNDING_ENABLED, SKIP_REASON);
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    // Deliberately a throw. The project was asked to run, so a missing value is
    // a broken run and not a reason to report success.
    throw new Error(
      `${name} is required when SMART_ROUNDING_E2E is set. The Smart Rounding project does not skip once it has been switched on: a check that cannot sign in has proven nothing, and reporting that as a skip is how an unverified invariant reads green.`,
    );
  }
  return value;
}

export function accounts(): Record<SmartRoundingRole, string> {
  const raw = required("SMART_ROUNDING_E2E_ACCOUNTS");
  let parsed: Partial<Record<SmartRoundingRole, string>>;
  try {
    parsed = JSON.parse(raw) as Partial<Record<SmartRoundingRole, string>>;
  } catch {
    throw new Error("SMART_ROUNDING_E2E_ACCOUNTS is not valid JSON. Expected an object keyed by role.");
  }
  const missing = ROLE_KEYS.filter((role) => !parsed[role]);
  if (missing.length > 0) {
    throw new Error(`SMART_ROUNDING_E2E_ACCOUNTS is missing ${missing.join(", ")}.`);
  }
  return parsed as Record<SmartRoundingRole, string>;
}

export function password(): string {
  return required("SMART_ROUNDING_E2E_PASSWORD");
}

/** The building under test, by id. Never by name: migration 318 renamed two of five. */
export function facilityId(): string {
  return required("SMART_ROUNDING_FACILITY_ID");
}

function supabaseUrl(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? process.env.SUPABASE_URL?.trim();
  if (!value) throw new Error("NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) is required when SMART_ROUNDING_E2E is set.");
  return value;
}

/** Reads configuration rows and asserts database state. Never used to sign in a surface. */
export function adminClient(): SupabaseClient {
  return createClient(supabaseUrl(), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** A client on one account's own authority, so row level security applies. */
export async function roleClient(role: SmartRoundingRole): Promise<{ client: SupabaseClient; userId: string }> {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? process.env.SUPABASE_ANON_KEY?.trim();
  if (!anonKey) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is required when SMART_ROUNDING_E2E is set.");
  const client = createClient(supabaseUrl(), anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: accounts()[role],
    password: password(),
  });
  if (error) throw new Error(`sign-in failed for the ${role} account: ${error.message}`);
  return { client, userId: data.user?.id ?? "" };
}

/** Sign in through the app's own form, so the surfaces see a real session. */
export async function signIn(page: Page, role: SmartRoundingRole): Promise<void> {
  await page.goto("/login");
  await page.getByLabel(/work email|email/i).fill(accounts()[role]);
  await page.getByLabel(/^password/i).fill(password());
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60_000 });
}

/** The facility's own clock. Read, never assumed: facilities.timezone is a column. */
export async function facilityTimezone(admin: SupabaseClient, facility: string): Promise<string> {
  const { data, error } = await admin.from("facilities").select("timezone").eq("id", facility).maybeSingle();
  if (error) throw new Error(`facilities.timezone read failed: ${error.message}`);
  const zone = data?.timezone;
  if (!zone) throw new Error(`facility ${facility} has no timezone. Every time in this project is the building's.`);
  return zone;
}

export type ProjectedWindow = {
  window_key: string;
  label: string;
  shift_key: string;
  cadence_version_id: string;
  due_at_utc: string;
  window_opens_at_utc: string;
  window_closes_at_utc: string;
};

/**
 * The windows the cadence version in force projects for a service date.
 *
 * This is the module's own projector, which is the point: the test asserts
 * against the same rows the board renders and the compliance read scores, so a
 * test that passes cannot disagree with the surface.
 */
export async function projectedWindows(
  admin: SupabaseClient,
  facility: string,
  serviceDate: string,
): Promise<ProjectedWindow[]> {
  const { data, error } = await admin.rpc("facility_observation_windows_for_date", {
    p_facility_id: facility,
    p_service_date: serviceDate,
  });
  if (error) throw new Error(`facility_observation_windows_for_date failed: ${error.message}`);
  const rows = (data ?? []) as ProjectedWindow[];
  if (rows.length === 0) {
    throw new Error(
      `no cadence version is in force at facility ${facility} for ${serviceDate}. That is a configuration gap, not a test to skip.`,
    );
  }
  return rows;
}

/** Today in the building's clock, as a service date. */
export function serviceDateIn(zone: string, at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
  return parts;
}
