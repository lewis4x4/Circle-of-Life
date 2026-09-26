import { expect, test, type Page } from "@playwright/test";
import axe from "axe-core";

/**
 * Jev accuracy page, rendered from its production client component against
 * intercepted Supabase reads. The "seeded" dataset is synthetic Haven Demo
 * Workspace data: ids and codes only, no names, no document text.
 */
const DEMO_ORG = "00000000-0000-4000-8000-00000000de40";
const SUPABASE = "https://dummy.supabase.co";
const EM_DASH = String.fromCharCode(0x2014);

type Json = Record<string, unknown>;

function outcome(i: number, over: Json = {}): Json {
  return {
    filing_id: `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    item_id: `20000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    organization_id: DEMO_ORG,
    approved_at: new Date(Date.now() - (i + 1) * 3_600_000).toISOString(),
    proposed_code: "vendor_coi",
    filed_code: "vendor_coi",
    type_correct: true,
    jev_state: "ran",
    questions_version: "intake-v2/vendor_coi.1",
    jev_choice: "c0",
    jev_margin: 0.5,
    margin_at_run: 0.2,
    jev_top_correct: true,
    ...over,
  };
}

const SEEDED = {
  outcomes: [
    ...Array.from({ length: 3 }, (_, i) => outcome(i, { jev_margin: 0.25, jev_top_correct: false, jev_choice: "c1" })),
    ...Array.from({ length: 7 }, (_, i) => outcome(10 + i, { jev_margin: 0.25 })),
    ...Array.from({ length: 25 }, (_, i) => outcome(20 + i)),
    ...Array.from({ length: 4 }, (_, i) => outcome(60 + i, { filed_code: "facility_license", proposed_code: "facility_license", questions_version: "intake-v2/facility_license.1" })),
    outcome(70, { filed_code: "facility_license", proposed_code: "vendor_coi", type_correct: false, jev_state: "not_applicable", questions_version: null, jev_choice: null, jev_margin: null, jev_top_correct: null }),
  ],
  checks: [
    ...Array.from({ length: 22 }, (_, i) => ({
      filing_id: outcome(20 + (i % 25)).filing_id,
      item_id: outcome(20 + (i % 25)).item_id,
      approved_at: outcome(20 + (i % 25)).approved_at,
      filed_code: "vendor_coi",
      questions_version: "intake-v2/vendor_coi.1",
      check_code: "jev_holder_matches",
      check_label: "Certificate holder is this facility",
      jev_result: "fail",
      verdict: i < 6 ? "wrong" : "right",
    })),
  ],
  catalog: [
    { id: "30000000-0000-4000-8000-000000000001", organization_id: DEMO_ORG, code: "vendor_coi", label: "Vendor certificate of insurance", description: "", document_group: "vendor", destination_kind: "facility_document", destination_category: "insurance", subject_kind: "facility", contains_phi: false, reviewer_roles: [], reader_enabled: true, jev_enabled: true, reader_hint: "", active: true, sort_order: 1, revision: 1 },
    { id: "30000000-0000-4000-8000-000000000002", organization_id: DEMO_ORG, code: "facility_license", label: "Facility license", description: "", document_group: "facility", destination_kind: "facility_document", destination_category: "license", subject_kind: "facility", contains_phi: false, reviewer_roles: [], reader_enabled: true, jev_enabled: true, reader_hint: "", active: true, sort_order: 2, revision: 1 },
  ],
};

type Dataset = { outcomes: Json[]; checks: Json[]; catalog: Json[] };
const EMPTY: Dataset = { outcomes: [], checks: [], catalog: [] };

async function serve(page: Page, data: Dataset, seen: string[] = []) {
  // Anything that is not the fixture server or the intercepted Supabase stand-in is refused.
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith("http://127.0.0.1:4417")) return route.continue();
    if (!url.startsWith(SUPABASE)) return route.abort();
    const { pathname, searchParams } = new URL(url);
    seen.push(`${pathname}?${searchParams.toString()}`);
    const table = pathname.replace("/rest/v1/", "");
    const since = searchParams.get("approved_at")?.replace(/^gte\./, "");
    const inWindow = (rows: Json[]) => (since ? rows.filter((r) => String(r.approved_at) >= since) : rows);
    const body =
      table === "document_intake_jev_outcomes" ? inWindow(data.outcomes)
      : table === "document_intake_jev_check_outcomes" ? inWindow(data.checks)
      : table === "document_intake_catalog" ? data.catalog
      : table === "document_intake_filings" ? data.outcomes.map((o) => ({ id: o.filing_id, destination_kind: "facility_document" }))
      : []; // ai_invocation_policies: hidden from this role, so margins come from the last run.
    return route.fulfill({ json: body });
  });
}

async function axeViolations(page: Page) {
  await page.addScriptTag({ content: axe.source });
  return page.evaluate(async () => {
    const result = await (window as unknown as { axe: typeof axe }).axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } });
    return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
  });
}

test("an empty window explains what no activity means", async ({ page }, testInfo) => {
  await serve(page, EMPTY);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Jev accuracy" })).toBeVisible();
  await expect(page.getByText("No filed documents with Jev activity in this window yet")).toBeVisible();
  expect(await page.locator("body").innerText()).not.toContain(EM_DASH);
  expect(await axeViolations(page)).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("jev-accuracy-empty.png"), fullPage: true });
});

test("the seeded demo dataset renders all three tiers", async ({ page }, testInfo) => {
  const seen: string[] = [];
  await serve(page, SEEDED, seen);
  await page.goto("/");

  const tier1 = page.getByRole("table", { name: "Jev accuracy by document type" });
  await expect(tier1).toBeVisible();
  await expect(page.getByText("Reader type agreement:")).toContainText("39 of 40");
  const coiRow = tier1.getByRole("row", { name: /Vendor certificate of insurance/ });
  await expect(coiRow).toContainText("32 of 35");
  await expect(coiRow).toContainText("Tighten to 0.3");
  await expect(coiRow).toContainText("At last run");
  await expect(tier1.getByRole("row", { name: /Facility license/ })).toContainText("Collect 4 of 30");

  await tier1.getByRole("button", { name: "Vendor certificate of insurance" }).click();
  await expect(page).toHaveURL(/\?type=vendor_coi$/);
  await expect(page.getByRole("table", { name: "Margins for Vendor certificate of insurance" })).toBeVisible();
  const checks = page.getByRole("table", { name: "Jev checks for Vendor certificate of insurance" });
  await expect(checks).toContainText("Certificate holder is this facility");
  await expect(checks).toContainText("Reword");
  await expect(page.getByLabel("Setting change statement")).toContainText("jsonb_build_object('vendor_coi', 0.3)");

  const misses = page.getByRole("table", { name: "Documents Jev missed" });
  await expect(misses.getByRole("link")).toHaveCount(3 + 6);
  await expect(misses.getByRole("link").first()).toHaveAttribute("href", /^\/admin\/document-intake\/20000000-/);

  const text = await page.locator("body").innerText();
  expect(text).not.toContain(EM_DASH);
  expect(text.toLowerCase()).not.toMatch(/percent correct/);
  expect(await axeViolations(page)).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("jev-accuracy-seeded.png"), fullPage: true });

  const before = seen.length;
  await page.getByText("90 days", { exact: true }).click();
  await expect(page).toHaveURL(/window=90/);
  await expect(tier1).toBeVisible();
  expect(seen.slice(before).some((u) => u.startsWith("/rest/v1/document_intake_jev_outcomes") && u.includes("approved_at=gte."))).toBe(true);
  await page.getByText("All time", { exact: true }).click();
  await expect(tier1).toBeVisible();
});
