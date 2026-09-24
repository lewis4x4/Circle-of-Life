import { expect, test } from "@playwright/test";

import {
  ORIENTATIONS,
  adminClient,
  dbRows,
  demo,
  installFloorDevice,
  installKioskDevice,
  runSeed,
  signIn,
  skipUnlessEnabled,
  tapDigits,
  unlockFloor,
} from "./_helpers";

/**
 * Spec 40 section 10, item 1: a synthetic med tech punched in on a kiosk-kind
 * device appears on a floor-kind device's roster, unlocks with PIN, lands on
 * /floor, and is locked on the next heartbeat after punching out.
 * Item 7: med_tech lands on /floor; /caregiver/clock writes nothing where the
 * timeclock is on.
 *
 * Jordan Kemp is the synthetic med tech: the seed leaves him off the clock.
 */
skipUnlessEnabled();

for (const orientation of ORIENTATIONS) {
  test.describe(`roster, unlock, heartbeat (${orientation.name})`, () => {
    test.use({ viewport: orientation.viewport });
    test.describe.configure({ mode: "serial" });
    test.beforeAll(() => runSeed());

    test("a kiosk punch puts Jordan on the floor roster; the PIN unlocks; punching out locks on the next heartbeat", async ({ browser }) => {
      const seed = demo();
      const jordan = seed.people.jordan;

      // Kiosk (its own tablet, its own browser storage): Jordan clocks in.
      const kioskContext = await browser.newContext({ viewport: orientation.viewport, hasTouch: true });
      const kiosk = await kioskContext.newPage();
      await installKioskDevice(kiosk);
      const clockIn = async (action: RegExp) => {
        await kiosk.goto("/kiosk/staff");
        await tapDigits(kiosk, jordan.employeeNumber);
        await kiosk.getByRole("button", { name: "Next", exact: true }).click();
        await tapDigits(kiosk, jordan.pin);
        await kiosk.getByRole("button", { name: "Continue", exact: true }).click();
        await kiosk.getByRole("button", { name: action }).click();
        await expect(kiosk.getByRole("status")).toBeVisible();
      };
      await clockIn(/^clock in$/i);

      // Floor tablet: the real clock, so the heartbeat can be fast-forwarded.
      const floorContext = await browser.newContext({ viewport: orientation.viewport, hasTouch: true });
      const floor = await floorContext.newPage();
      await floor.clock.install();
      await installFloorDevice(floor, "HL-FLOOR-01");
      await floor.goto("/floor/lock");
      await expect(floor.getByRole("button", { name: /^Jordan K\.,/ })).toBeVisible();
      await unlockFloor(floor, "jordan");
      await expect(floor).toHaveURL(/\/floor$/);

      type UnlockRow = { id: string; method: string; on_clock: boolean; ended_at: string | null; end_reason: string | null };
      const latestUnlock = () =>
        dbRows<UnlockRow>(
          `select id, method, on_clock, ended_at, end_reason from public.floor_unlocks where device_id = '${seed.devices["HL-FLOOR-01"].id}' and staff_id = '${jordan.staffId}' order by started_at desc limit 1`,
        )[0];
      expect(latestUnlock()).toMatchObject({ method: "roster", on_clock: true, ended_at: null });

      // Jordan clocks out at the kiosk; the next heartbeat (60 s) locks the tablet.
      await clockIn(/^clock out$/i);
      await floor.clock.runFor(65_000);
      await floor.waitForURL(/\/floor\/lock/, { timeout: 30_000 });
      await expect(floor.getByRole("button", { name: /^Jordan K\.,/ })).toHaveCount(0);
      expect(latestUnlock()?.end_reason).toBe("clocked_out");

      await kioskContext.close();
      await floorContext.close();
    });

    test("a med tech signing in lands on /floor, and /caregiver/clock writes nothing where the timeclock is on", async ({ page }) => {
      const seed = demo();
      const admin = adminClient();
      const before = await admin.from("time_records").select("id", { count: "exact", head: true }).eq("staff_id", seed.people.dana.staffId);
      expect(before.error).toBeNull();

      await signIn(page, "dana");
      await expect(page).toHaveURL(/\/floor(\/lock)?$/);

      await page.goto("/caregiver/clock");
      // Whatever the page offers, pressing it must write nothing where the kiosk timeclock is on.
      const clockIn = page.getByRole("button", { name: /^clock in$/i });
      if (await clockIn.isVisible().catch(() => false) && (await clockIn.isEnabled())) {
        await clockIn.click();
        await page.waitForTimeout(3_000);
      }
      const after = await admin.from("time_records").select("id", { count: "exact", head: true }).eq("staff_id", seed.people.dana.staffId);
      expect(after.count).toBe(before.count);
      // Spec 40 section 1 "One clock": the page says where to clock in.
      await expect(page.getByText(/clock in at the front door/i).first()).toBeVisible();
    });
  });
}
