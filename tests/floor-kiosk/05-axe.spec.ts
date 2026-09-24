import { expect, test } from "@playwright/test";

import {
  FROZEN,
  ORIENTATIONS,
  demo,
  expectNoAxeViolations,
  freezeAt,
  installFloorDevice,
  installKioskDevice,
  runSeed,
  skipUnlessEnabled,
  unlockFloor,
} from "./_helpers";

/**
 * DESIGN.md sections 6 and 7: axe reports zero violations on every floor and
 * kiosk route, in both orientations.
 */
skipUnlessEnabled();

for (const orientation of ORIENTATIONS) {
  test.describe(`axe (${orientation.name})`, () => {
    test.use({ viewport: orientation.viewport });
    test.beforeAll(() => runSeed());

    test("every kiosk route", async ({ page }) => {
      await freezeAt(page, FROZEN.signIn);
      await installKioskDevice(page);
      for (const route of ["/kiosk", "/kiosk/staff", "/kiosk/sign-in/visitor", "/kiosk/sign-in/provider", "/kiosk/sign-in/vendor", "/kiosk/sign-in/inspector", "/kiosk/leaving"]) {
        await page.goto(route);
        await page.waitForLoadState("networkidle");
        await expectNoAxeViolations(page, route);
      }
    });

    test("/kiosk/setup and /floor/setup before enrollment", async ({ page }) => {
      for (const route of ["/kiosk/setup", "/floor/setup"]) {
        await page.goto(route);
        await page.waitForLoadState("networkidle");
        await expectNoAxeViolations(page, route);
      }
    });

    test("every floor route", async ({ page }) => {
      const seed = demo();
      await freezeAt(page, FROZEN.floor);
      await installFloorDevice(page, "HL-FLOOR-01");
      await page.goto("/floor/lock");
      await page.waitForLoadState("networkidle");
      await expectNoAxeViolations(page, "/floor/lock");
      await unlockFloor(page, "ashley");

      // In-app navigation only: a page load is a hidden screen and locks the tablet.
      const tab = (name: string) => page.getByRole("navigation").getByRole("link", { name, exact: true });
      await expect(page.getByRole("link", { name: "Chart safety check for Evelyn Carter" })).toBeVisible();
      await expectNoAxeViolations(page, "/floor");
      await page.getByRole("link", { name: "Chart safety check for Evelyn Carter" }).click();
      await expect(page).toHaveURL(/\/floor\/check\//);
      await expect(page.getByRole("button", { name: /save check/i })).toBeVisible();
      await expectNoAxeViolations(page, "/floor/check/[taskId]");
      for (const [name, route] of [["Rounds", "/floor/rounds"], ["Residents", "/floor/residents"], ["Report", "/floor/report"], ["Handoff", "/floor/handoff"]] as const) {
        await tab(name).click();
        await expect(page).toHaveURL(new RegExp(`${route}$`));
        await page.waitForLoadState("networkidle");
        await expectNoAxeViolations(page, route);
      }
      await tab("Residents").click();
      await page.getByRole("link", { name: /Evelyn Carter/ }).first().click();
      await expect(page).toHaveURL(new RegExp(`/floor/residents/${seed.residents.evelyn.id}$`));
      await page.waitForLoadState("networkidle");
      await expectNoAxeViolations(page, "/floor/residents/[id]");
      await page.getByRole("link", { name: /full record and history/i }).click();
      await expect(page).toHaveURL(/\/record$/);
      await page.waitForLoadState("networkidle");
      await expectNoAxeViolations(page, "/floor/residents/[id]/record");
    });
  });
}
