import { expect, test } from "@playwright/test";

import { FROZEN, ORIENTATIONS, adminClient, demo, freezeAt, installFloorDevice, runSeed, skipUnlessEnabled, unlockFloor } from "./_helpers";

/**
 * Spec 40 section 10, item 4: an offline check charted by A replays after B
 * unlocks the same tablet and is attributed to A.
 */
skipUnlessEnabled();

for (const orientation of ORIENTATIONS) {
  test.describe(`offline replay (${orientation.name})`, () => {
    test.use({ viewport: orientation.viewport });
    test.beforeAll(() => runSeed());

    test("Ashley charts Mae's 9:45 check offline; after Dana unlocks, it replays as Ashley's", async ({ page, context }) => {
      const seed = demo();
      await freezeAt(page, FROZEN.floor);
      await installFloorDevice(page, "HL-FLOOR-03");
      await page.goto("/floor/lock");
      await unlockFloor(page, "ashley");
      // The service worker holds the offline queue. A production build registers
      // it itself (src/components/pwa/service-worker-register.tsx); a dev server
      // does not, so the test registers the same /sw.js with the same options.
      // Registering an already registered worker is a no-op.
      await page.evaluate(async () => {
        await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
        await navigator.serviceWorker.ready;
      });

      const chartMae = page.getByRole("link", { name: "Chart safety check for Mae Johnson" }).or(page.getByRole("button", { name: "Chart safety check for Mae Johnson" })).first();
      await chartMae.click();
      await expect(page).toHaveURL(/\/floor\/check\//);
      // The screen has loaded (places come from the server) before the network drops.
      const places = page.getByRole("group", { name: /where (is she|are they)/i }).getByRole("button");
      await expect(places.first()).toBeVisible();
      await context.setOffline(true);
      await page.getByRole("button", { name: /^calm$/i }).click();
      await places.first().click();
      await page.getByRole("button", { name: /save check/i }).click();
      // The top bar's sync state (useFloorSyncState): the check is queued on this tablet.
      await expect(page.getByRole("banner").getByRole("status")).toContainText("Offline, 1 waiting");

      // Ashley leaves the tablet while it is still fully offline: Switch locks it
      // in place (no network needed), and her check waits under her name.
      await page.getByRole("button", { name: /^switch$/i }).click();
      // The lock screen, in place and offline: Ashley's session is gone (no top
      // bar with her name) and the roster, which only the server knows, waits
      // for the network. Her check is still queued on the tablet.
      await expect(page.getByRole("heading", { name: "Who's on shift?" })).toBeVisible();
      await expect(page.getByRole("banner").getByRole("status")).toContainText("Offline");
      await expect(page.getByRole("banner").getByText("Ashley W.")).toHaveCount(0);
      const queued = await page.evaluate(
        async () =>
          await new Promise<number>((resolve, reject) => {
            const open = indexedDB.open("haven-offline");
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const db = open.result;
              if (!db.objectStoreNames.contains("roundingQueue")) return resolve(0);
              const count = db.transaction("roundingQueue", "readonly").objectStore("roundingQueue").count();
              count.onsuccess = () => resolve(count.result);
              count.onerror = () => reject(count.error);
            };
          }),
      );
      expect(queued).toBe(1);

      // The network returns; Dana unlocks the same tablet; the device replay
      // writes Ashley's check as Ashley.
      await context.setOffline(false);
      await expect(page).toHaveURL(/\/floor\/lock/, { timeout: 30_000 });
      const retry = page.getByRole("button", { name: "Try again" });
      if (await retry.isVisible().catch(() => false)) await retry.click();
      await unlockFloor(page, "dana");

      const admin = adminClient();
      await expect
        .poll(
          async () => {
            const logs = await admin
              .from("resident_observation_logs")
              .select("staff_id, entry_mode")
              .eq("facility_id", seed.facilityId)
              .eq("resident_id", seed.residents.mae.id)
              .order("created_at", { ascending: false })
              .limit(1);
            return logs.data?.[0]?.staff_id ?? null;
          },
          { timeout: 60_000 },
        )
        .toBe(seed.people.ashley.staffId);
    });
  });
}
