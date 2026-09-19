import { expect, test } from "@playwright/test";
import axe from "axe-core";

const summary = (satisfied: number) => ({
  from: "2026-09-01", to: "2026-09-07",
  totals: { expected: 10, satisfied, unconfigured: 2, absorbed: 0, withTask: 10, onTime: satisfied, late: 0 },
  byShift: [], byHall: [], byStaff: [],
});
test("a delayed previous-facility response cannot replace the selected building", async ({ page }, testInfo) => {
  let finishA!: () => void;
  const deferredA = new Promise<void>(resolve => { finishA = resolve; });
  let receivedA!: () => void;
  const requestedA = new Promise<void>(resolve => { receivedA = resolve; });
  await page.route("**/api/rounding/compliance?**", async route => {
    if (new URL(route.request().url()).searchParams.get("facilityId") === "fixture-a") {
      receivedA(); await deferredA;
      await route.fulfill({ json: summary(1) });
    } else await route.fulfill({ json: summary(9) });
  });
  await page.goto("/");
  await requestedA;
  await page.getByRole("button", { name: "Switch to Fixture B" }).click();
  await expect(page.getByText("9 of 10 expected windows recorded")).toBeVisible();
  const oldResponse = page.waitForResponse(response => response.url().includes("facilityId=fixture-a"));
  finishA(); await oldResponse;
  await expect(page.getByText("9 of 10 expected windows recorded")).toBeVisible();
  await expect(page.getByText("1 of 10 expected windows recorded")).toHaveCount(0);
  for (const region of await page.getByRole("region", { name: /^By / }).all()) {
    expect(await region.evaluate(element => getComputedStyle(element).overflowX)).toBe("auto");
  }
  await page.screenshot({ path: testInfo.outputPath("compliance-fixture-b.png"), fullPage: true });
});

test("phone chip capture requires clinical details and sends the selected sentence inputs", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/rounding/vocabulary?**", route => route.fulfill({ json: {
    location: [{ code: "dining_room", label: "Dining room" }], position: [],
    state: [{ code: "eating_meal", label: "Eating meal" }],
    meal_intake: [{ code: "ate_well", label: "Ate well" }],
    mood_state: [{ code: "pleasant", label: "Pleasant" }],
    med_response: [{ code: "no_concern", label: "No concern" }],
  } }));
  await page.goto("/?screen=capture");
  const record = page.getByRole("button", { name: "Record check" });
  await expect(record).toBeDisabled();
  for (const name of ["Awake", "Dining room", "Eating meal"]) await page.getByRole("radio", { name, exact: true }).click();
  await page.getByRole("checkbox", { name: "Ate well", exact: true }).click();
  await expect(record).toBeEnabled();
  await expect(page.getByTestId("observation-preview")).toContainText("Ate well");
  await record.click();
  const saved = page.getByLabel("Saved synthetic observation");
  await expect(saved).toContainText('"chipSelections":{"meal_intake":["ate_well"]}');
  await expect(saved).toContainText('"residentLocation":"dining_room"');
  await expect(saved).toContainText('"note":null');
  // The assertion output is a test aid, not part of the production capture UI.
  await saved.evaluate(element => element.remove());
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("capture-phone.png"), fullPage: true });
  await page.addScriptTag({ content: axe.source });
  const results = await page.evaluate(async () => (window as unknown as { axe: typeof axe }).axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } }));
  expect(results.violations).toEqual([]);
});
