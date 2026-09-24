#!/usr/bin/env node
/**
 * Capture every DESIGN.md section 5 state from the running app and compose it
 * next to its reference render (COL-694, DESIGN.md section 6, items 3 and 5).
 *
 *   built/<ref>.png            1180 x 820 at deviceScaleFactor 2 (2360 x 1640, the reference size)
 *   built/portrait/<ref>.png   820 x 1180 at deviceScaleFactor 2
 *   compare/<ref>.png          reference left, build right, composed by rendering
 *                              both images in a Playwright page (no image dependency)
 *
 * In portrait it also checks that nothing scrolls sideways
 * (document.documentElement.scrollWidth <= clientWidth) and that no button,
 * link or input is clipped: every one sits inside the viewport, or inside a
 * scroll container that actually scrolls in the direction it overflows.
 *
 * Data: the fidelity demo on Haven HFO Staging. The script re-seeds it
 * (scripts/floor/seed-prototype-demo.mjs) with Ashley off the clock for the
 * kiosk staff states, and again with her on the clock for the floor states.
 * Clocks are frozen per DESIGN.md section 6: 9:40 AM for floor states, 6:58 AM
 * for kiosk staff states, 10:12 AM for sign-in and 11:40 AM for leaving, on the
 * seed's capture date; /kiosk home is frozen at 6:58 AM on 2026-10-01 (the
 * reference's time and date line; nothing server side reads the browser date).
 *
 *   BASE_URL=http://127.0.0.1:4310 node scripts/floor/capture-built-screens.mjs [--only 03-floor-now,10-kiosk-home] [--no-seed]
 *
 * Prints a summary table: ref, built, portrait scroll ok, clipped controls.
 * Exits non-zero when a state could not be reproduced or a portrait check fails.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { DEVICES_FILE, easternInstant } from "./seed-prototype-demo.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DESIGN_DIR = path.join(REPO_ROOT, "docs/designs/floor-tablet-kiosk");
const REFERENCE_DIR = path.join(DESIGN_DIR, "reference");
const BUILT_DIR = path.join(DESIGN_DIR, "built");
const PORTRAIT_DIR = path.join(BUILT_DIR, "portrait");
const COMPARE_DIR = path.join(DESIGN_DIR, "compare");
const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:4310";

const LANDSCAPE = { width: 1180, height: 820 };
const PORTRAIT = { width: 820, height: 1180 };
const FROZEN = { floor: "09:40", kioskStaff: "06:58", signIn: "10:12", leaving: "11:40" };
const KIOSK_HOME_DATE = "2026-10-01";

function parseArgs(argv) {
  const args = { only: null, seed: true };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--only") args.only = new Set((argv[++i] ?? "").split(",").filter(Boolean));
    else if (argv[i] === "--no-seed") args.seed = false;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  return args;
}

function seed(extra = []) {
  execFileSync(process.execPath, [path.join(REPO_ROOT, "scripts/floor/seed-prototype-demo.mjs"), ...extra], { cwd: REPO_ROOT, stdio: "inherit" });
}

function demo() {
  if (!existsSync(DEVICES_FILE)) throw new Error("test-results/floor-kiosk/devices.json is missing; run the seed first.");
  return JSON.parse(readFileSync(DEVICES_FILE, "utf8"));
}

// ---------------------------------------------------------------------------
// Tablet plumbing (IndexedDB, keypads), the same as tests/floor-kiosk/_helpers.ts
// ---------------------------------------------------------------------------
async function putIndexedDb(page, dbName, stores, storeName, row) {
  if (!page.url().startsWith("http")) await page.goto(`${BASE_URL}/robots.txt`);
  await page.evaluate(
    async ({ dbName, stores, storeName, row }) =>
      await new Promise((resolve, reject) => {
        const open = indexedDB.open(dbName, 1);
        open.onupgradeneeded = () => {
          for (const [name, keyPath] of stores) if (!open.result.objectStoreNames.contains(name)) open.result.createObjectStore(name, { keyPath });
        };
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction(storeName, "readwrite");
          tx.objectStore(storeName).put(row);
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    { dbName, stores, storeName, row },
  );
}

async function installFloorDevice(page, data, label) {
  const device = data.devices[label];
  await putIndexedDb(page, "haven-floor", [["device", "key"]], "device", {
    key: "device",
    deviceId: device.id,
    token: device.token,
    facilityId: data.facilityId,
    facilityName: data.facilityName,
    deviceLabel: label,
    enrolledAt: new Date().toISOString(),
  });
}

async function installKioskDevice(page, data) {
  await putIndexedDb(page, "haven-timeclock", [["device", "key"], ["punchQueue", "clientPunchId"]], "device", {
    key: "device",
    token: data.devices["HL-KIOSK-01"].token,
    facilityId: data.facilityId,
    facilityName: data.facilityName,
    enrolledAt: new Date().toISOString(),
  });
}

/**
 * The "2 unsent" pill: two checks waiting in this tablet's offline rounding
 * queue (haven-offline, v2), owned by the person, captured under no unlock so
 * nothing replays them. They exist only in this capture's browser context.
 */
async function queueUnsentChecks(page, data, who, count) {
  const owner = data.people[who].userId;
  await page.evaluate(
    async ({ owner, count, organizationId, facilityId, residentId }) =>
      await new Promise((resolve, reject) => {
        const open = indexedDB.open("haven-offline", 2);
        open.onupgradeneeded = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("roundingQueue")) db.createObjectStore("roundingQueue", { keyPath: "id" }).createIndex("taskId", "taskId", { unique: false });
          if (!db.objectStoreNames.contains("careEventQueue")) db.createObjectStore("careEventQueue", { keyPath: "clientEventId" });
        };
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction("roundingQueue", "readwrite");
          for (let i = 0; i < count; i += 1) {
            tx.objectStore("roundingQueue").put({
              id: crypto.randomUUID(), taskId: crypto.randomUUID(), residentId, ownerUserId: owner, organizationId, facilityId,
              payload: {}, queuedAt: new Date().toISOString(), retryCount: 0, lastError: null, unlockId: null,
            });
          }
          tx.oncomplete = () => { open.result.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
      }),
    { owner, count, organizationId: data.organizationId, facilityId: data.facilityId, residentId: data.residents.walter.id },
  );
}

/** Answers a Something happened report with the first option each time and sends it. */
async function completeReport(page) {
  const send = page.getByRole("button", { name: /^(Save to log|Save and alert the Administrator|Send urgent alert|Send emergency alert)$/ });
  const startOver = page.getByRole("button", { name: /^start over$/i }).first();
  for (let step = 0; step < 20; step += 1) {
    if (await startOver.isVisible().catch(() => false)) return;
    const radio = page.getByRole("radio").first();
    if (await radio.isVisible().catch(() => false)) {
      await radio.click();
    } else if (await page.getByRole("button", { name: "Next", exact: true }).isVisible().catch(() => false)) {
      await page.getByRole("button", { name: "Next", exact: true }).click();
    } else if (await send.isVisible().catch(() => false)) {
      await send.click();
    }
    await page.waitForTimeout(250);
  }
  await startOver.waitFor();
}

/** Who: Harold via "Someone else" (the render's chips: the pick first, then who is due). */
async function pickResident(page, name) {
  await page.getByRole("button", { name: "Someone else" }).click();
  await page.getByLabel(/find a resident/i).fill(name.split(" ")[0]);
  await page.getByRole("button", { name: new RegExp(name, "i") }).last().click();
}

async function tapDigits(page, digits) {
  for (const digit of digits) await page.getByRole("button", { name: `Digit ${digit}`, exact: true }).click();
}

async function freeze(page, data, hhmm, date = data.captureDate) {
  await page.clock.setFixedTime(easternInstant(date, hhmm));
}

async function settle(page, quick = false) {
  // A kiosk confirmation clears itself after 5 seconds: capture it at once.
  if (!quick) await page.waitForLoadState("networkidle").catch(() => {});
  // The Next.js dev-tools badge exists only on the dev server; it is not the product.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }).catch(() => {});
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(quick ? 100 : 300);
}

async function unlock(page, data, who) {
  const person = data.people[who];
  const [first, last] = person.name.split(" ");
  await page.getByRole("button", { name: new RegExp(`^${first} ${last.charAt(0)}\\.,`) }).click();
  await tapDigits(page, person.pin);
  await page.getByRole("button", { name: /^unlock$/i }).click();
  await page.waitForURL((url) => url.pathname === "/floor", { timeout: 30_000 });
}

// ---------------------------------------------------------------------------
// The states (DESIGN.md section 5). Each one takes a fresh page in the given
// viewport and leaves it showing the state. `phase` groups states by seed.
// ---------------------------------------------------------------------------
const STATES = [
  // Kiosk staff states: Ashley off the clock.
  { ref: "11-kiosk-staff-number", phase: "kiosk-staff", run: async (page, data) => {
    await freeze(page, data, FROZEN.kioskStaff);
    await installKioskDevice(page, data);
    await page.goto(`${BASE_URL}/kiosk/staff`);
    await tapDigits(page, data.people.ashley.employeeNumber);
  } },
  { ref: "11b-kiosk-staff-pin-ready", phase: "kiosk-staff", run: async (page, data) => {
    await freeze(page, data, FROZEN.kioskStaff);
    await installKioskDevice(page, data);
    await page.goto(`${BASE_URL}/kiosk/staff`);
    await tapDigits(page, data.people.ashley.employeeNumber);
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await tapDigits(page, data.people.ashley.pin);
  } },
  { ref: "12-kiosk-clock-in", phase: "kiosk-staff", run: async (page, data) => {
    await freeze(page, data, FROZEN.kioskStaff);
    await installKioskDevice(page, data);
    await page.goto(`${BASE_URL}/kiosk/staff`);
    await tapDigits(page, data.people.ashley.employeeNumber);
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await tapDigits(page, data.people.ashley.pin);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("button", { name: /^clock in$/i }).waitFor();
  } },
  { ref: "13-kiosk-clocked-in", phase: "kiosk-staff", punches: true, quick: true, run: async (page, data, context) => {
    await freeze(page, data, FROZEN.kioskStaff);
    await installKioskDevice(page, data);
    await page.goto(`${BASE_URL}/kiosk/staff`);
    await tapDigits(page, data.people.ashley.employeeNumber);
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await tapDigits(page, data.people.ashley.pin);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    // Online, as rendered. The confirmation shows the server's punch time (real
    // now, a data difference); offline the kiosk shows its "saved on this
    // tablet" state instead, which is not 13. The floor phase re-seed sets
    // Ashley's ledger back to the rendered 6:58 AM punch.
    await page.getByRole("button", { name: /^clock in$/i }).click();
    await page.getByText(/^Clocked in at/).waitFor();
  } },

  // Floor states: both on the clock.
  { ref: "01-floor-lock", phase: "floor", run: async (page, data) => {
    await freeze(page, data, FROZEN.floor);
    await installFloorDevice(page, data, "HL-FLOOR-02");
    await queueUnsentChecks(page, data, "dana", 2);
    await page.goto(`${BASE_URL}/floor/lock`);
    await page.getByRole("button", { name: /^Ashley W\.,/ }).waitFor();
  } },
  { ref: "02-floor-pin", phase: "floor", run: async (page, data) => {
    await freeze(page, data, FROZEN.floor);
    await installFloorDevice(page, data, "HL-FLOOR-02");
    await page.goto(`${BASE_URL}/floor/lock`);
    await page.getByRole("button", { name: /^Ashley W\.,/ }).click();
    await tapDigits(page, data.people.ashley.pin.slice(0, 4));
  } },
  { ref: "02b-floor-pin-ready", phase: "floor", run: async (page, data) => {
    await freeze(page, data, FROZEN.floor);
    await installFloorDevice(page, data, "HL-FLOOR-02");
    await page.goto(`${BASE_URL}/floor/lock`);
    await page.getByRole("button", { name: /^Ashley W\.,/ }).click();
    await tapDigits(page, data.people.ashley.pin);
  } },
  { ref: "03-floor-now", phase: "floor", reseed: true, run: async (page, data) => {
    await freeze(page, data, FROZEN.floor);
    await installFloorDevice(page, data, "HL-FLOOR-02");
    await page.goto(`${BASE_URL}/floor/lock`);
    await unlock(page, data, "ashley");
    // Loaded, not loading: all six check rows and both task rows are on screen.
    const rows = page.getByRole("link", { name: /(chart safety check for|answer the witness statement)/i })
      .or(page.getByRole("button", { name: /(chart safety check for|answer the witness statement)/i }));
    await page.waitForFunction(() => !document.body.innerText.includes("Loading the checks"), null, { timeout: 30_000 });
    for (let i = 0; i < 60 && (await rows.count()) < 8; i += 1) await page.waitForTimeout(500);
    if ((await rows.count()) < 8) throw new Error(`Now shows ${await rows.count()} rows, expected 8`);
    await page.getByText(/Rounds:/).first().waitFor();
  } },
  { ref: "04-floor-resident", phase: "floor", run: async (page, data) => {
    await freeze(page, data, FROZEN.floor);
    await installFloorDevice(page, data, "HL-FLOOR-02");
    await page.goto(`${BASE_URL}/floor/lock`);
    await unlock(page, data, "ashley");
    // Client-side only: a page load locks an unlocked floor tablet (pagehide lock).
    await page.getByRole("link", { name: /Evelyn Carter/ }).first().click();
    await page.waitForURL(new RegExp(`/floor/residents/${data.residents.evelyn.id}$`));
    await page.getByText(/know before you go in/i).first().waitFor();
  } },
  { ref: "05-floor-check", phase: "floor", run: async (page, data) => {
    await freeze(page, data, FROZEN.floor);
    await installFloorDevice(page, data, "HL-FLOOR-02");
    await page.goto(`${BASE_URL}/floor/lock`);
    await unlock(page, data, "ashley");
    await page.getByRole("link", { name: /chart safety check for Evelyn Carter/i }).or(page.getByRole("button", { name: /chart safety check for Evelyn Carter/i })).first().click();
    await page.waitForURL(/\/floor\/check\//);
    // The render's selections: Awake, a location, Offered fluids.
    await page.getByRole("button", { name: /^awake$/i }).click();
    await page.getByRole("group", { name: /where is/i }).getByRole("button", { name: "In chair", exact: true }).click();
    await page.getByRole("button", { name: /^offered fluids$/i }).click();
  } },
  { ref: "06-floor-something-happened", phase: "floor", run: async (page, data) => {
    await freeze(page, data, FROZEN.floor);
    await installFloorDevice(page, data, "HL-FLOOR-02");
    await page.goto(`${BASE_URL}/floor/lock`);
    await unlock(page, data, "ashley");
    await page.getByRole("navigation").getByRole("link", { name: "Report", exact: true }).click();
    await page.waitForURL(/\/floor\/report$/);
    await pickResident(page, "Harold Nguyen");
  } },
  { ref: "07-floor-fall-question", phase: "floor", run: async (page, data) => {
    await freeze(page, data, FROZEN.floor);
    await installFloorDevice(page, data, "HL-FLOOR-02");
    await page.goto(`${BASE_URL}/floor/lock`);
    await unlock(page, data, "ashley");
    await page.getByRole("navigation").getByRole("link", { name: "Report", exact: true }).click();
    await page.waitForURL(/\/floor\/report$/);
    await pickResident(page, "Harold Nguyen");
    await page.getByRole("button", { name: /^fall/i }).click();
  } },
  { ref: "07b-floor-fall-sent", phase: "floor", files: true, run: async (page, data) => {
    await freeze(page, data, FROZEN.floor);
    await installFloorDevice(page, data, "HL-FLOOR-02");
    await page.goto(`${BASE_URL}/floor/lock`);
    await unlock(page, data, "ashley");
    await page.getByRole("navigation").getByRole("link", { name: "Report", exact: true }).click();
    await page.waitForURL(/\/floor\/report$/);
    await pickResident(page, "Harold Nguyen");
    await page.getByRole("button", { name: /^fall/i }).click();
    await completeReport(page);
  } },

  // Kiosk visitor states.
  { ref: "10-kiosk-home", phase: "floor", run: async (page, data) => {
    await freeze(page, data, FROZEN.kioskStaff, KIOSK_HOME_DATE);
    await installKioskDevice(page, data);
    await page.goto(`${BASE_URL}/kiosk`);
  } },
  { ref: "14-kiosk-visitor", phase: "floor", run: async (page, data) => {
    await freeze(page, data, FROZEN.signIn);
    await installKioskDevice(page, data);
    await page.goto(`${BASE_URL}/kiosk/sign-in/visitor`);
    // Fields empty as rendered; the sick question starts unselected (constitution), the render shows No.
    await page.getByRole("button", { name: /^no$/i }).click();
  } },
  { ref: "14b-kiosk-visitor-sick-yes", phase: "floor", run: async (page, data) => {
    await freeze(page, data, FROZEN.signIn);
    await installKioskDevice(page, data);
    await page.goto(`${BASE_URL}/kiosk/sign-in/visitor`);
    await page.getByRole("button", { name: /^yes$/i }).click();
  } },
  { ref: "15-kiosk-provider", phase: "floor", run: async (page, data) => {
    await freeze(page, data, FROZEN.signIn);
    await installKioskDevice(page, data);
    await page.goto(`${BASE_URL}/kiosk/sign-in/provider`);
    await page.getByRole("button", { name: /^no$/i }).click();
  } },
  { ref: "16-kiosk-signed-in", phase: "floor", files: true, quick: true, run: async (page, data) => {
    await freeze(page, data, FROZEN.signIn);
    await installKioskDevice(page, data);
    await page.goto(`${BASE_URL}/kiosk/sign-in/visitor`);
    await page.getByLabel(/your name/i).fill("Carol Price");
    await page.getByLabel(/who are you visiting/i).fill("Ruth Simmons");
    await page.getByRole("button", { name: /^no$/i }).click();
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.getByText(/You're signed in/).waitFor();
  } },
  { ref: "17-kiosk-leaving", phase: "floor", run: async (page, data) => {
    await freeze(page, data, FROZEN.leaving);
    await installKioskDevice(page, data);
    await page.goto(`${BASE_URL}/kiosk/leaving`);
    await page.getByLabel(/first 3 letters/i).fill("Car");
    await page.getByText("Carol P.").waitFor();
  } },
  { ref: "17b-kiosk-signed-out", phase: "floor", files: true, quick: true, run: async (page, data) => {
    await freeze(page, data, FROZEN.leaving);
    await installKioskDevice(page, data);
    await page.goto(`${BASE_URL}/kiosk/leaving`);
    await page.getByLabel(/first 3 letters/i).fill("Car");
    await page.getByRole("button", { name: /sign out.*carol p\./i }).click();
    await page.getByRole("heading", { name: /signed out/i }).waitFor();
  } },
];

// ---------------------------------------------------------------------------
// Portrait checks
// ---------------------------------------------------------------------------
async function portraitChecks(page) {
  return await page.evaluate(() => {
    const root = document.documentElement;
    const scrollOk = root.scrollWidth <= root.clientWidth;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const docScrollsY = root.scrollHeight > root.clientHeight;
    function scrollableAncestor(el, axis) {
      for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
        const style = getComputedStyle(node);
        const overflow = axis === "x" ? style.overflowX : style.overflowY;
        const scrolls = axis === "x" ? node.scrollWidth > node.clientWidth : node.scrollHeight > node.clientHeight;
        if ((overflow === "auto" || overflow === "scroll") && scrolls) return node;
      }
      return null;
    }
    const clipped = [];
    for (const el of document.querySelectorAll("button, a[href], input, select, textarea, [role='button']")) {
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") continue;
      const r = el.getBoundingClientRect();
      if (r.width * r.height <= 4) continue;
      // Visually hidden until focused (sr-only, skip links): not a clipped control.
      if (style.clipPath !== "none" || (style.clip && style.clip !== "auto")) continue;
      if (el.matches("a[href^='#']") && (r.bottom <= 0 || r.right <= 0)) continue;
      const outX = r.left < -0.5 || r.right > vw + 0.5;
      const outY = r.top < -0.5 || r.bottom > vh + 0.5;
      const okX = !outX || scrollableAncestor(el, "x");
      const okY = !outY || docScrollsY || scrollableAncestor(el, "y");
      if (!okX || !okY) {
        const name = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("name") || el.tagName).trim().replace(/\s+/g, " ").slice(0, 40);
        clipped.push(name);
      }
    }
    return { scrollOk, clipped };
  });
}

// ---------------------------------------------------------------------------
// Compare: reference left, build right, rendered in a page
// ---------------------------------------------------------------------------
async function compose(browser, ref) {
  const refPath = path.join(REFERENCE_DIR, `${ref}.png`);
  const builtPath = path.join(BUILT_DIR, `${ref}.png`);
  if (!existsSync(refPath) || !existsSync(builtPath)) return false;
  const toData = (file) => `data:image/png;base64,${readFileSync(file).toString("base64")}`;
  const page = await browser.newPage({ viewport: { width: 2360 * 2 + 60, height: 1640 + 80 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#6b7280;font:600 28px system-ui;color:#fff">
    <div style="display:flex;gap:20px;padding:20px">
      <figure style="margin:0"><figcaption style="height:40px">Reference ${ref}</figcaption><img src="${toData(refPath)}" width="2360" height="1640"></figure>
      <figure style="margin:0"><figcaption style="height:40px">Built ${ref}</figcaption><img src="${toData(builtPath)}" width="2360" height="1640"></figure>
    </div></body></html>`);
  await page.evaluate(() => Promise.all([...document.images].map((img) => img.decode())));
  await page.screenshot({ path: path.join(COMPARE_DIR, `${ref}.png`), fullPage: true });
  await page.close();
  return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function captureOne(browser, state, viewport, file) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: true, locale: "en-US", timezoneId: "America/New_York", reducedMotion: "reduce" });
  const page = await context.newPage();
  try {
    await state.run(page, demo(), context);
    await settle(page, Boolean(state.quick));
    await page.screenshot({ path: file });
    return { ok: true, page, context };
  } catch (error) {
    await page.screenshot({ path: path.join(REPO_ROOT, "test-results/floor-kiosk", `debug-${state.ref}.png`) }).catch(() => {});
    await context.close();
    return { ok: false, error: error instanceof Error ? error.message.split("\n")[0] : String(error) };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const dir of [BUILT_DIR, PORTRAIT_DIR, COMPARE_DIR]) mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch();
  const rows = [];
  const selected = STATES.filter((state) => !args.only || args.only.has(state.ref));

  for (const phase of ["kiosk-staff", "floor"]) {
    const states = selected.filter((state) => state.phase === phase);
    if (states.length === 0) continue;
    // Seed at the start of each phase, and again after any state that writes (a
    // punch, a report, a visit), so every capture starts from the seeded data.
    let dirty = true;
    for (const state of states) {
      for (const orientation of ["landscape", "portrait"]) {
        if (args.seed && (dirty || state.reseed)) seed(phase === "kiosk-staff" ? ["--ashley-off"] : []);
        dirty = Boolean(state.files || state.punches);
        const viewport = orientation === "landscape" ? LANDSCAPE : PORTRAIT;
        const file = path.join(orientation === "landscape" ? BUILT_DIR : PORTRAIT_DIR, `${state.ref}.png`);
        const shot = await captureOne(browser, state, viewport, file);
        let row = rows.find((r) => r.ref === state.ref);
        if (!row) {
          row = { ref: state.ref, built: "no", portrait: "no", scrollOk: "n/a", clipped: "n/a", error: "" };
          rows.push(row);
        }
        if (!shot.ok) {
          row.error = `${orientation}: ${shot.error}`;
          continue;
        }
        if (orientation === "landscape") row.built = "yes";
        else {
          row.portrait = "yes";
          const checks = await portraitChecks(shot.page);
          row.scrollOk = checks.scrollOk ? "yes" : "NO";
          row.clipped = checks.clipped.length === 0 ? "none" : checks.clipped.join("; ");
        }
        await shot.context.close();
        // A closed floor tablet sends its lock on the way out; let it land before
        // the next capture unlocks the same device.
        if (state.phase === "floor") await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      if (rows.find((r) => r.ref === state.ref)?.built === "yes") await compose(browser, state.ref);
    }
  }
  await browser.close();

  const header = ["ref", "built", "portrait", "portrait scroll ok", "clipped controls", "error"];
  const table = rows.map((r) => [r.ref, r.built, r.portrait, r.scrollOk, r.clipped, r.error]);
  const widths = header.map((h, i) => Math.min(60, Math.max(h.length, ...table.map((row) => String(row[i]).length))));
  const line = (cells) => `| ${cells.map((c, i) => String(c).slice(0, 60).padEnd(widths[i])).join(" | ")} |`;
  console.log(line(header));
  console.log(`|${widths.map((w) => "-".repeat(w + 2)).join("|")}|`);
  for (const row of table) console.log(line(row));

  const failed = rows.filter((r) => r.built !== "yes" || r.portrait !== "yes" || r.scrollOk !== "yes" || r.clipped !== "none");
  if (failed.length > 0) {
    console.error(`\n${failed.length} state(s) not reproduced or failing the portrait checks.`);
    process.exit(1);
  }
}

main().catch((cause) => {
  console.error(`[capture-built-screens] FATAL: ${cause instanceof Error ? cause.message : String(cause)}`);
  process.exit(1);
});
