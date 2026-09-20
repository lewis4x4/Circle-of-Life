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

test("actual admin drawer on a phone requires chips and passes accessibility checks", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let writes = 0;
  await page.route("**/api/rounding/tasks/*/complete", route => { writes++; return route.abort(); });
  await page.route("**/api/rounding/vocabulary?**", route => route.fulfill({ json: {
    location: [{ code: "dining_room", label: "Dining room" }], position: [],
    state: [{ code: "eating_meal", label: "Eating meal" }],
    meal_intake: [{ code: "ate_well", label: "Ate well" }],
    mood_state: [{ code: "pleasant", label: "Pleasant" }],
    med_response: [{ code: "no_concern", label: "No concern" }],
  } }));
  await page.goto("/?screen=drawer");
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  const record = drawer.getByRole("button", { name: "Record check" });
  await expect(record).toBeDisabled();
  for (const name of ["Awake", "Dining room", "Eating meal"]) await drawer.getByRole("radio", { name, exact: true }).click();
  await expect(record).toBeDisabled();
  await drawer.getByRole("checkbox", { name: "Ate well", exact: true }).click();
  await expect(record).toBeEnabled();
  await expect(drawer.getByTestId("observation-preview")).toContainText("Ate well");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("admin-drawer-phone.png"), fullPage: true });
  await page.addScriptTag({ content: axe.source });
  const results = await page.evaluate(async () => (window as unknown as { axe: typeof axe }).axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } }));
  expect(results.violations).toEqual([]);
  await record.click();
  await expect(drawer.getByText("Preview complete — not saved")).toBeVisible();
  await expect(page.getByText("Synthetic admin capture completed")).toBeAttached();
  expect(writes).toBe(0);
});

test("settings preserve protocol and apply a reviewed template with individual results", async ({ page }, testInfo) => {
  const windows = [{ window_key: "morning", label: "Morning check", due_at_local: "09:00", grace_before_minutes: 0, grace_after_minutes: 30, shift_key: "day", sort_order: 0, enabled: true }];
  const calls: Record<string, unknown>[] = [];
  await page.route("https://dummy.supabase.co/**", async route => {
    const url = route.request().url();
    if (url.includes("observation_config_templates")) return route.fulfill({ json: { cadence_templates: [{ id: "template", name: "Fixture standard", template_key: "fixture", version_id: "revision-2", version_number: 2, windows }], escalation_templates: [] } });
    if (url.includes("v_facility_config_template_drift")) return route.fulfill({ json: ["a", "b"].map((key) => ({ facility_id: `fixture-${key}`, facility_name: `Fixture ${key.toUpperCase()}`, cadence_template_name: null, escalation_template_name: null, cadence_drift_count: 0, escalation_drift_count: 0 })) });
    if (url.includes("observation_config_overview")) return route.fulfill({ json: { current: { day_shape: { windows: [{ ...windows[0], due_minute: 480 }] }, ladder: [] } } });
    if (url.includes("apply_template_to_facilities")) {
      const body = route.request().postDataJSON(); calls.push(body);
      const id = body.p_facility_ids[0];
      return route.fulfill({ json: { facilities: [{ facility_id: id, ok: id === "fixture-a", effective_from: "2026-09-22T10:00:00Z", reason: id === "fixture-b" ? "Fixture refusal" : undefined }] } });
    }
    return route.abort();
  });
  await page.goto("/?screen=settings");
  await page.getByText("Shift, Monitoring Order and Watchlist policy", { exact: true }).click();
  await page.getByLabel("Monitoring intervals (minutes, separated by commas)").fill("30, 60, 90");
  await expect(page.getByLabel("Monitoring intervals (minutes, separated by commas)")).toHaveValue("30, 60, 90");
  await expect(page.getByLabel("Instructions for this step")).toHaveValue("Call the on-call lead");
  await page.getByText("Organization templates and portfolio drift", { exact: true }).click();
  await page.getByRole("button", { name: "Load portfolio" }).click();
  await page.getByRole("combobox", { name: "Template", exact: true }).click();
  await page.getByRole("option", { name: "Fixture standard · version 2" }).click();
  for (const name of ["Fixture A", "Fixture B"]) await page.getByRole("row").filter({ hasText: name }).getByRole("button").click();
  await expect(page.getByText("Proposed: 09:00")).toHaveCount(2);
  await page.getByLabel("Reason for this change").fill("Synthetic configuration proof");
  await page.getByLabel("Template acknowledgment").fill("Fixture standard");
  await page.getByRole("button", { name: "Apply to 2 selected facilities" }).click();
  await expect(page.getByLabel("Per-facility application results")).toContainText("Fixture B: Failed — Fixture refusal");
  expect(calls).toHaveLength(2);
  expect(calls.every((call) => call.p_expected_cadence_template_version_id === "revision-2")).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("settings-template-portfolio.png"), fullPage: true });
  await page.addScriptTag({ content: axe.source });
  const result = await page.evaluate(async () => (window as unknown as { axe: typeof axe }).axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } }));
  expect(result.violations).toEqual([]);
});
