import { expect, test } from "@playwright/test";

import {
  FROZEN,
  ORIENTATIONS,
  RESIDENT_NAMES,
  adminClient,
  demo,
  freezeAt,
  installKioskDevice,
  runSeed,
  signIn,
  skipUnlessEnabled,
} from "./_helpers";

/**
 * Spec 40 section 10, item 5: kiosk visitor sign-in completes in under 30
 * seconds; the row shows in the staff visitor log and the AHCA print pack;
 * /kiosk renders no resident name; sign-out shows nothing before 3 letters; an
 * inspector sign-in raises the administrator's Home banner.
 */
skipUnlessEnabled();

const VISITOR = "Nora Bellweather";
const INSPECTOR_AGENCY = "AHCA Field Office (demo)";

for (const orientation of ORIENTATIONS) {
  test.describe(`kiosk visitors (${orientation.name})`, () => {
    test.use({ viewport: orientation.viewport });
    test.describe.configure({ mode: "serial" });
    test.beforeAll(() => runSeed());

    test("/kiosk renders no resident name on any kiosk screen", async ({ page }) => {
      await freezeAt(page, FROZEN.signIn);
      await installKioskDevice(page);
      for (const route of ["/kiosk", "/kiosk/staff", "/kiosk/sign-in/visitor", "/kiosk/sign-in/provider", "/kiosk/sign-in/vendor", "/kiosk/sign-in/inspector", "/kiosk/leaving"]) {
        await page.goto(route);
        const text = await page.locator("body").innerText();
        for (const name of RESIDENT_NAMES) {
          expect(text, `${route} shows ${name}`).not.toContain(name);
          expect(text, `${route} shows ${name.split(" ")[1]}`).not.toContain(name.split(" ")[1]);
        }
      }
    });

    test("a visitor signs in in under 30 seconds and shows in the visitor log and the AHCA print pack", async ({ page, browser }) => {
      const seed = demo();
      await freezeAt(page, FROZEN.signIn);
      await installKioskDevice(page);
      await page.goto("/kiosk");

      const started = Date.now();
      await page.getByRole("link", { name: /visiting a resident/i }).or(page.getByRole("button", { name: /visiting a resident/i })).first().click();
      await page.getByLabel(/your name/i).fill(VISITOR);
      await page.getByLabel(/who are you visiting/i).fill("Walter Brooks");
      await page.getByRole("button", { name: /^no$/i }).click();
      await page.getByRole("button", { name: /^sign in$/i }).click();
      await expect(page.getByRole("status")).toContainText(/signed in/i);
      expect(Date.now() - started).toBeLessThan(30_000);

      const rows = await adminClient()
        .from("visitor_log_entries")
        .select("id, visitor_type, kiosk_device_id, screening_passed")
        .eq("facility_id", seed.facilityId)
        .eq("visitor_name", VISITOR)
        .is("checked_out_at", null);
      expect(rows.error).toBeNull();
      expect(rows.data).toHaveLength(1);
      expect(rows.data?.[0]).toMatchObject({ visitor_type: "family_friend", kiosk_device_id: seed.devices["HL-KIOSK-01"].id, screening_passed: true });

      // Staff side: the administrator's front desk log and the survey print pack.
      const staffContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const staff = await staffContext.newPage();
      await signIn(staff, "admin");
      await staffContext.addCookies([{ name: "haven_selected_facility", value: seed.facilityId, url: staff.url() }]);
      await staff.goto("/admin/front-desk");
      await expect(staff.getByText(VISITOR).first()).toBeVisible();
      await staff.goto(`/print/survey-pack?sections=visitors&from=${seed.captureDate}&to=${seed.captureDate}`);
      await expect(staff.getByText(VISITOR).first()).toBeVisible();
      await staffContext.close();
    });

    test("sign-out lists nothing before 3 letters, then signs Carol P. out", async ({ page }) => {
      await freezeAt(page, FROZEN.leaving);
      await installKioskDevice(page);
      await page.goto("/kiosk/leaving");
      const search = page.getByLabel(/first 3 letters/i);
      await search.fill("Ca");
      await expect(page.getByRole("button", { name: /sign out/i })).toHaveCount(0);
      await search.fill("Car");
      await expect(page.getByText("Carol P.")).toBeVisible();
      await expect(page.getByText("Carlos M.")).toBeVisible();
      await page.getByRole("button", { name: /sign out.*carol p\./i }).click();
      await expect(page.getByRole("status")).toContainText(/signed out/i);
    });

    test("an inspector signing in raises the administrator's Home banner", async ({ page, browser }) => {
      const seed = demo();
      await freezeAt(page, FROZEN.signIn);
      await installKioskDevice(page);
      await page.goto("/kiosk/sign-in/inspector");
      await page.getByLabel(/your name/i).fill("Quentin Marlowe");
      await page.getByLabel(/agency/i).fill(INSPECTOR_AGENCY);
      await page.getByRole("button", { name: /^sign in$/i }).click();
      await expect(page.getByRole("status")).toContainText(/signed in/i);

      const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const home = await adminContext.newPage();
      await signIn(home, "admin");
      await adminContext.addCookies([{ name: "haven_selected_facility", value: seed.facilityId, url: home.url() }]);
      await home.goto("/admin");
      await expect(home.getByText(/inspector/i).first()).toBeVisible();
      await expect(home.getByText(INSPECTOR_AGENCY).first()).toBeVisible();
      await adminContext.close();
    });
  });
}
