import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Helpers for the `floor-kiosk` Playwright project (spec 40 section 10, items
 * 1, 3, 4, 5 and 7; DESIGN.md section 6).
 *
 *   FLOOR_KIOSK_E2E unset   every spec skips and says which variable to set
 *   FLOOR_KIOSK_E2E=1       nothing skips: a missing seed file, credential or
 *                           staging key is a thrown error and a red run
 *
 * Everything runs against the fidelity demo on Haven HFO Staging, seeded by
 * scripts/floor/seed-prototype-demo.mjs (the project's setup step re-runs it
 * before every run). Tokens, PINs and passwords come from the gitignored
 * test-results/floor-kiosk/devices.json and are never logged.
 */

const REPO_ROOT = path.resolve(__dirname, "../..");
const DEVICES_FILE = path.join(REPO_ROOT, "test-results/floor-kiosk/devices.json");
const STAGING_REF = "iwcnajanvjvynolltflw";
export const TZ = "America/New_York";

function flag(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export const FLOOR_KIOSK_ENABLED = flag("FLOOR_KIOSK_E2E");

export function skipUnlessEnabled(): void {
  test.skip(
    !FLOOR_KIOSK_ENABLED,
    "FLOOR_KIOSK_E2E is not set, so the floor-kiosk project did not run. Set FLOOR_KIOSK_E2E=1 with .env.staging.local present and the dev server on staging.",
  );
}

// ---------------------------------------------------------------------------
// The seeded demo
// ---------------------------------------------------------------------------
export type DemoPersonKey = "admin" | "ashley" | "dana" | "jordan";
export type DemoDeviceLabel = "HL-KIOSK-01" | "HL-FLOOR-01" | "HL-FLOOR-02" | "HL-FLOOR-03";
export type DemoResidentKey = "evelyn" | "harold" | "ruth" | "walter" | "mae" | "frank" | "lorraine" | "george" | "curtis";

export type DemoPerson = {
  userId: string;
  staffId: string;
  email: string;
  password: string;
  employeeNumber: string;
  pin: string;
  name: string;
};

export type DemoDevice = { id: string; kind: "kiosk" | "floor"; token: string };

export type DemoSeed = {
  supabaseRef: string;
  captureDate: string;
  ashleyOff: boolean;
  organizationId: string;
  facilityId: string;
  facilityName: string;
  devices: Record<DemoDeviceLabel, DemoDevice>;
  people: Record<DemoPersonKey, DemoPerson>;
  residents: Record<DemoResidentKey, { id: string; room: string }>;
};

export function demo(): DemoSeed {
  if (!existsSync(DEVICES_FILE)) {
    throw new Error(`${path.relative(REPO_ROOT, DEVICES_FILE)} is missing. The floor-kiosk setup step runs scripts/floor/seed-prototype-demo.mjs; it did not finish.`);
  }
  const parsed = JSON.parse(readFileSync(DEVICES_FILE, "utf8")) as DemoSeed;
  if (parsed.supabaseRef !== STAGING_REF) throw new Error("devices.json was not written for Haven HFO Staging; refusing.");
  return parsed;
}

/** Re-runs the seed (idempotent). `ashleyOff` leaves Ashley off the clock for the kiosk staff states. */
export function runSeed(options: { ashleyOff?: boolean } = {}): void {
  execFileSync(process.execPath, ["scripts/floor/seed-prototype-demo.mjs", ...(options.ashleyOff ? ["--ashley-off"] : [])], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
}

function stagingEnv(): { url: string; serviceRoleKey: string } {
  const file = path.join(REPO_ROOT, ".env.staging.local");
  if (!existsSync(file)) throw new Error(".env.staging.local is required when FLOOR_KIOSK_E2E is set.");
  const env: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes(STAGING_REF)) throw new Error(".env.staging.local does not point at Haven HFO Staging; refusing.");
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) throw new Error(".env.staging.local has no SUPABASE_SERVICE_ROLE_KEY.");
  return { url, serviceRoleKey };
}

/** Service-role client for database assertions only; never used to drive a surface. */
export function adminClient(): SupabaseClient {
  const env = stagingEnv();
  return createClient(env.url, env.serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

// ---------------------------------------------------------------------------
// Clocks (DESIGN.md section 6)
// ---------------------------------------------------------------------------
/** The UTC instant of an Eastern wall-clock time on a date. */
export function easternInstant(isoDate: string, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const guess = Date.UTC(Number(isoDate.slice(0, 4)), Number(isoDate.slice(5, 7)) - 1, Number(isoDate.slice(8, 10)), h, m);
  for (const offsetHours of [4, 5]) {
    const candidate = new Date(guess + offsetHours * 3_600_000);
    const shown = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(candidate);
    if (shown === hhmm) return candidate;
  }
  throw new Error(`cannot place ${isoDate} ${hhmm} in ${TZ}`);
}

export const FROZEN = { floor: "09:40", kioskStaff: "06:58", signIn: "10:12", leaving: "11:40" } as const;

/** Freeze Date at an Eastern time on the capture date; timers keep running. */
export async function freezeAt(page: Page, hhmm: string, isoDate: string = demo().captureDate): Promise<void> {
  await page.clock.setFixedTime(easternInstant(isoDate, hhmm));
}

// ---------------------------------------------------------------------------
// Tablets: the device token goes where the app keeps it (IndexedDB), never
// localStorage. Written from a same-origin page before the app first loads.
// ---------------------------------------------------------------------------
async function onOrigin(page: Page): Promise<void> {
  if (!page.url().startsWith("http")) await page.goto("/robots.txt");
}

export async function installFloorDevice(page: Page, label: Exclude<DemoDeviceLabel, "HL-KIOSK-01">): Promise<void> {
  const seed = demo();
  const device = seed.devices[label];
  await onOrigin(page);
  await page.evaluate(
    async (row) =>
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("haven-floor", 1);
        open.onupgradeneeded = () => {
          if (!open.result.objectStoreNames.contains("device")) open.result.createObjectStore("device", { keyPath: "key" });
        };
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction("device", "readwrite");
          tx.objectStore("device").put(row);
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    {
      key: "device",
      deviceId: device.id,
      token: device.token,
      facilityId: seed.facilityId,
      facilityName: seed.facilityName,
      deviceLabel: label,
      enrolledAt: new Date().toISOString(),
    },
  );
}

export async function installKioskDevice(page: Page): Promise<void> {
  const seed = demo();
  await onOrigin(page);
  await page.evaluate(
    async (row) =>
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("haven-timeclock", 1);
        open.onupgradeneeded = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("device")) db.createObjectStore("device", { keyPath: "key" });
          if (!db.objectStoreNames.contains("punchQueue")) db.createObjectStore("punchQueue", { keyPath: "clientPunchId" });
        };
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction("device", "readwrite");
          tx.objectStore("device").put(row);
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    {
      key: "device",
      token: seed.devices["HL-KIOSK-01"].token,
      facilityId: seed.facilityId,
      facilityName: seed.facilityName,
      enrolledAt: new Date().toISOString(),
    },
  );
}

// ---------------------------------------------------------------------------
// Keypads and the lock screen
// ---------------------------------------------------------------------------
/** Types digits on an on-screen keypad (the system keyboard never opens). */
export async function tapDigits(page: Page, digits: string): Promise<void> {
  for (const digit of digits) {
    // Both keypads (floor PinPad, kiosk KioskKeypad) label their keys "Digit n".
    await page.getByRole("button", { name: `Digit ${digit}`, exact: true }).click();
  }
}

/** Lock screen: tap the person's roster tile, enter the PIN, Unlock; lands on /floor. */
export async function unlockFloor(page: Page, who: DemoPersonKey): Promise<void> {
  const person = demo().people[who];
  const display = displayName(person.name);
  await expect(page).toHaveURL(/\/floor\/lock/);
  // RosterTile's accessible name: "Ashley W., Med tech[, n unsent]".
  await page.getByRole("button", { name: new RegExp(`^${display.replace(".", "\\.")},`) }).click();
  await tapDigits(page, person.pin);
  await page.getByRole("button", { name: /^unlock$/i }).click();
  await page.waitForURL((url) => url.pathname === "/floor", { timeout: 30_000 });
}

/** "Ashley Warren" -> "Ashley W." (haven.floor_display_name). */
export function displayName(fullName: string): string {
  const [first, ...rest] = fullName.split(" ");
  const last = rest.join(" ");
  return last ? `${first} ${last.charAt(0).toUpperCase()}.` : first;
}

/** Sign in through the app's own form, so the surfaces see a real session. */
export async function signIn(page: Page, who: DemoPersonKey): Promise<void> {
  const person = demo().people[who];
  await page.goto("/login");
  await page.getByLabel(/work email|email/i).fill(person.email);
  await page.getByLabel(/^password/i).fill(person.password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60_000 });
}

/** Who on the report: a resident found through "Someone else". */
export async function pickResident(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "Someone else" }).click();
  await page.getByLabel(/find a resident/i).fill(name.split(" ")[0]);
  await page.getByRole("button", { name: new RegExp(name, "i") }).last().click();
}

/** Answers a Something happened report with the first option each time and sends it. */
export async function completeReport(page: Page): Promise<void> {
  const send = page.getByRole("button", { name: /^(Save to log|Save and alert the Administrator|Send urgent alert|Send emergency alert)$/ });
  const startOver = page.getByRole("button", { name: /^start over$/i }).first();
  for (let step = 0; step < 20; step += 1) {
    if (await startOver.isVisible().catch(() => false)) return;
    const radio = page.getByRole("radio").first();
    const next = page.getByRole("button", { name: "Next", exact: true });
    if (await radio.isVisible().catch(() => false)) await radio.click();
    else if (await next.isVisible().catch(() => false)) await next.click();
    else if (await send.isVisible().catch(() => false)) await send.click();
    await page.waitForTimeout(250);
  }
  await expect(startOver).toBeVisible();
}

/**
 * Rows the service role cannot read (floor_unlocks grants SELECT to
 * authenticated only), read as the database owner through the linked CLI.
 * Staging only: the link is asserted first.
 */
export function dbRows<T>(sql: string): T[] {
  const ref = readFileSync(path.join(REPO_ROOT, "supabase/.temp/project-ref"), "utf8").trim();
  if (ref !== STAGING_REF) throw new Error(`supabase/.temp/project-ref is ${ref}, not Haven HFO Staging; refusing.`);
  let out = "";
  for (let attempt = 1; ; attempt += 1) {
    try {
      out = execFileSync("supabase", ["db", "query", "--linked", "-o", "json", sql], { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      break;
    } catch (cause) {
      // The pooler briefly refuses CLI logins when several sessions log in at once; nothing ran yet.
      const stderr = cause && typeof cause === "object" && "stderr" in cause ? String((cause as { stderr: unknown }).stderr) : "";
      if (attempt >= 4 || !/ECIRCUITBREAKER|failed to connect as temp role|SASL auth/.test(stderr)) throw cause;
      execFileSync("sleep", [String(attempt * 20)]);
    }
  }
  const start = out.indexOf("{");
  const parsed = JSON.parse(out.slice(start)) as { rows?: T[] };
  return parsed.rows ?? [];
}

/** Zero axe violations on the page as it stands. */
export async function expectNoAxeViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).exclude("nextjs-portal").analyze();
  const summary = results.violations.map(
    (v) => `${v.id} (${v.impact ?? "n/a"}): ${v.nodes.length} node(s) - ${v.help} [${v.nodes.slice(0, 4).map((n) => n.target.join(" ")).join(" | ")}]`,
  );
  expect(summary, `axe violations on ${label}`).toEqual([]);
}

export const RESIDENT_NAMES = [
  "Evelyn Carter",
  "Harold Nguyen",
  "Ruth Simmons",
  "Walter Brooks",
  "Mae Johnson",
  "Frank Delgado",
  "Lorraine Pitts",
  "George Adams",
  "Curtis Hale",
] as const;

export const ORIENTATIONS = [
  { name: "landscape", viewport: { width: 1180, height: 820 } },
  { name: "portrait", viewport: { width: 820, height: 1180 } },
] as const;
