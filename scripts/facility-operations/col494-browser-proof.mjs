#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "../..");
const args = Object.fromEntries(process.argv.slice(2).reduce((rows, value, index, all) => value.startsWith("--") ? [...rows, [value.slice(2), all[index + 1]]] : rows, []));
if (!args.state || !args.output) throw new Error("Usage: col494-browser-proof.mjs --state <private state> --output <report.json> [--base http://127.0.0.1:4360] [--inspect true]");
const statePath = path.resolve(args.state);
const output = path.resolve(args.output);
const base = args.base ?? "http://127.0.0.1:4360";
const HOMEWOOD = "00000000-0000-0000-0002-000000000003";
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
if (!state.setupComplete || state.cleaned || state.target !== "iwcnajanvjvynolltflw") throw new Error("Fresh staging fixture required");
if ((fs.statSync(statePath).mode & 0o077) !== 0) throw new Error("Private state permissions changed");
const sourceSha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
if (!/^[a-f0-9]{40}$/.test(sourceSha) || state.sourceSha !== sourceSha) throw new Error("Fixture and current source revision differ");
const dirtySource = spawnSync("git", ["status", "--porcelain", "--untracked-files=all", "--", "src", "supabase", "scripts/facility-operations/col494-browser-proof.mjs", "scripts/facility-operations/col494-staging-fixture.mjs", "scripts/facility-operations/col494-build-journey-register.mjs", "package.json", "package-lock.json", "next.config.ts", "tsconfig.json", "tsconfig.typecheck.json"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
if (dirtySource) throw new Error(`Runtime or proof source is not committed: ${dirtySource.split(/\r?\n/)[0]}`);

const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("playwright");
const AxeBuilder = require("@axe-core/playwright").default;

function cookies(session) {
  const value = `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
  const suffix = value.length > 3180;
  const rows = [];
  for (let i = 0; i < value.length; i += 3180) rows.push({
    name: `sb-${state.target}-auth-token${suffix ? `.${i / 3180}` : ""}`,
    value: value.slice(i, i + 3180), domain: "127.0.0.1", path: "/", secure: false, httpOnly: false, sameSite: "Lax",
  });
  return rows;
}
function captureErrors(page, row) {
  page.on("pageerror", (error) => row.pageErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") row.consoleErrors.push(message.text()); });
  page.on("response", (response) => { if (response.status() >= 400) row.httpFailures.push({ url: response.url(), status: response.status() }); });
}
function taskRow(page, label) {
  return page.getByRole("listitem").filter({ has: page.getByText(`COL494 Synthetic · ${label}`, { exact: true }) }).first();
}
function localParts(instant = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(instant).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return { iso: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}`, label: new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "long", day: "numeric", year: "numeric" }).format(instant) };
}
async function setQuietDate(page, trigger, label) {
  await trigger.click();
  await page.getByRole("button", { name: label, exact: true }).click();
}

const report = { run: state.run, target: state.target, sourceSha, base, createdAt: new Date().toISOString(), viewports: [], inventory: { catalogSourceRows: 91, catalogComponents: 110, demonstratedSourceRows: 27, demonstratedComponents: 35, tasks: Object.keys(state.tasks).length }, scenarios: {}, refusedOutbound: [] };
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [{ name: "desktop", width: 1280, height: 800 }, { name: "tablet", width: 768, height: 1024 }, { name: "mobile", width: 375, height: 812 }]) {
    const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
    await context.addCookies(cookies(state.sessions.admin));
    let dropRecordTask = null;
    let droppedRecord = null;
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (![base, `https://${state.target}.supabase.co`].includes(url.origin)) {
        report.refusedOutbound.push({ viewport: viewport.name, origin: url.origin, path: url.pathname });
        return route.abort("blockedbyclient");
      }
      if (dropRecordTask && route.request().method() === "POST" && url.pathname === `/api/admin/operations/occurrences/${dropRecordTask}/record`) {
        const requestBody = route.request().postData();
        const response = await route.fetch();
        const responseBody = await response.json();
        if (response.status() !== 200) throw new Error(`Dropped-response setup did not commit: ${response.status()}`);
        droppedRecord = { requestBody, responseBody };
        dropRecordTask = null;
        return route.abort("failed");
      }
      return route.continue();
    });
    const page = await context.newPage();
    const row = { ...viewport, pageErrors: [], consoleErrors: [], expectedConsoleErrors: [], httpFailures: [], screenshot: null, profileScreenshot: null, taskCount: 0, textSample: "", axeViolations: [] };
    report.viewports.push(row);
    captureErrors(page, row);
    const response = await page.goto(`${base}/admin/operations/work?facility_id=${state.ids.site}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    if (!response || response.status() !== 200) throw new Error(`${viewport.name} work route returned ${response?.status()}`);
    await page.getByRole("heading", { name: "Site work" }).waitFor({ timeout: 60_000 });
    await page.getByText("Loading site work…", { exact: true }).waitFor({ state: "hidden", timeout: 60_000 });
    row.taskCount = await page.getByRole("listitem").count();
    row.textSample = (await page.locator("main").innerText()).slice(0, 12_000);
    row.axeViolations = (await new AxeBuilder({ page }).analyze()).violations.map((violation) => ({ id: violation.id, impact: violation.impact, nodes: violation.nodes.length }));
    const screenshot = path.join(path.dirname(output), `work-${viewport.name}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    row.screenshot = path.relative(ROOT, screenshot);

    const profileContext = await browser.newContext({ viewport, reducedMotion: "reduce" });
    await profileContext.addCookies(cookies(state.sessions.profileOwner));
    const profilePage = await profileContext.newPage();
    const profileResponse = await profilePage.goto(`${base}/admin/operations/profile?facility_id=${HOMEWOOD}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    if (!profileResponse || profileResponse.status() !== 200) throw new Error(`${viewport.name} profile route returned ${profileResponse?.status()}`);
    await profilePage.getByRole("heading", { name: "Facility profile" }).waitFor();
    await profilePage.getByText("Loading facility profile…", { exact: true }).waitFor({ state: "hidden", timeout: 60_000 });
    await profilePage.getByText("Source items: 91 · Checklist components: 110", { exact: true }).waitFor();
    await profilePage.getByText(/Unconfirmed timing has no due or overdue judgment/).waitFor();
    const profileApi = await profilePage.evaluate(async (facility) => { const response = await fetch(`/api/admin/operations/facility-profile?facility_id=${facility}`, { credentials: "same-origin", cache: "no-store" }); return { status: response.status, body: await response.json() }; }, HOMEWOOD);
    const d15 = profileApi.body.entries?.find((entry) => entry.source_id === "AL-D15");
    if (profileApi.status !== 200 || profileApi.body.coverage?.source_count !== 91 || profileApi.body.coverage?.component_count !== 110 || d15?.source_text !== "Attendance Calendar is Updated" || d15.components?.[0]?.subject_kind !== null || profileApi.body.summary?.approved_rule_count !== 0) throw new Error("Daily/Weekly profile coverage is incomplete or overstates unknown timing");
    const profileShot = path.join(path.dirname(output), `profile-${viewport.name}.png`);
    await profilePage.screenshot({ path: profileShot, fullPage: true });
    row.profileScreenshot = path.relative(ROOT, profileShot);
    const profileAxe = await new AxeBuilder({ page: profilePage }).analyze();
    row.axeViolations.push(...profileAxe.violations.map((violation) => ({ id: `profile:${violation.id}`, impact: violation.impact, nodes: violation.nodes.length })));
    await profileContext.close();

    if (viewport.name === "desktop" && args["inspect-generator"] === "true") {
      const generator = taskRow(page, "Record generator test");
      await generator.getByText("Observation source record", { exact: true }).click();
      await page.waitForTimeout(2_000);
      console.log(JSON.stringify({ generatorText: await generator.innerText(), assetSelects: await generator.getByLabel("Asset observed", { exact: true }).count() }));
      await context.close();
      break;
    }

    if (viewport.name === "desktop" && args.inspect !== "true") {
      const marketing = taskRow(page, "Record marketing calls");
      dropRecordTask = state.tasks["hfo-al-d01-01"];
      await marketing.getByRole("button", { name: "Record unscheduled work", exact: true }).click();
      for (let attempt = 0; !droppedRecord && attempt < 200; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 25));
      if (!droppedRecord) throw new Error("Lost-response proof did not capture the committed answer");
      await marketing.getByText("Saved", { exact: true }).waitFor({ timeout: 30_000 });
      const recovered = await page.evaluate(async (task) => { const response = await fetch(`/api/admin/operations/occurrences/${task}/receipts`, { credentials: "same-origin", cache: "no-store" }); return { status: response.status, body: await response.json() }; }, state.tasks["hfo-al-d01-01"]);
      const original = recovered.body.receipts?.[0];
      if (recovered.status !== 200 || recovered.body.receipts?.length !== 1 || original?.id !== recovered.body.occurrence?.effective_receipt_id || original?.receipt_kind !== "performance") throw new Error("Lost-response recovery did not reconcile exactly one original performance receipt");
      report.scenarios.routineRecovery = { status: "PASS", task: "hfo-al-d01-01", firstReplyDroppedAfterCommit: true, automaticReadbackReconciled: true, receiptCount: 1, originalReceiptId: original.id };

      const correction = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith(`/occurrences/${state.tasks["hfo-al-d01-01"]}/correct`));
      await marketing.getByRole("button", { name: "Correct", exact: true }).click();
      await marketing.getByLabel("Correction reason", { exact: true }).fill("Synthetic correction proves append-only history");
      await marketing.getByRole("button", { name: "Save correction", exact: true }).click();
      const correctionResponse = await correction;
      if (correctionResponse.status() !== 200) throw new Error(`Correction failed: ${correctionResponse.status()}`);
      const correctedChain = await page.evaluate(async (task) => { const response = await fetch(`/api/admin/operations/occurrences/${task}/receipts`, { credentials: "same-origin", cache: "no-store" }); return { status: response.status, body: await response.json() }; }, state.tasks["hfo-al-d01-01"]);
      const first = correctedChain.body.receipts?.[0], second = correctedChain.body.receipts?.[1];
      if (correctedChain.status !== 200 || correctedChain.body.receipts?.length !== 2 || first?.id !== original.id || second?.id === first.id || second?.corrects_receipt_id !== first.id || second?.correction_seq !== 1 || first?.superseded_by_receipt_id !== second.id || correctedChain.body.occurrence?.effective_receipt_id !== second.id) throw new Error("Correction chain did not preserve and supersede the original receipt exactly");
      report.scenarios.correction = { status: "PASS", task: "hfo-al-d01-01", httpStatus: correctionResponse.status(), receiptCount: 2, originalReceiptId: first.id, correctionReceiptId: second.id, originalPreserved: true };

      const mail = taskRow(page, "Check for mail");
      await mail.getByRole("button", { name: "Record unscheduled work", exact: true }).click();
      const mailRecord = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith(`/occurrences/${state.tasks["hfo-al-d03-01"]}/record`));
      await mail.getByRole("button", { name: "Save work", exact: true }).click();
      if ((await mailRecord).status() !== 200) throw new Error("Evidence-gated work did not record");
      const beforeEvidence = await page.evaluate(async (task) => { const response = await fetch(`/api/admin/operations/occurrences/${task}/receipts`, { credentials: "same-origin", cache: "no-store" }); return { status: response.status, body: await response.json() }; }, state.tasks["hfo-al-d03-01"]);
      const heldReceipt = beforeEvidence.body.receipts?.[0];
      if (beforeEvidence.status !== 200 || beforeEvidence.body.receipts?.length !== 1 || heldReceipt?.completion_state !== "performed_missing_evidence" || beforeEvidence.body.occurrence?.status === "completed") throw new Error("Missing-evidence work was incorrectly treated as completed before upload");
      const evidenceFile = path.join(ROOT, "public/assets/grace-png/grace-thinking.png");
      await mail.getByLabel("File for Synthetic mail-room evidence", { exact: true }).setInputFiles(evidenceFile);
      const evidenceFinal = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/finalize"));
      await mail.getByRole("button", { name: "Upload evidence", exact: true }).click();
      const evidenceResponse = await evidenceFinal;
      const evidenceBody = await evidenceResponse.json();
      if (evidenceResponse.status() !== 200 || evidenceBody.evidence?.state !== "finalized") throw new Error(`Evidence finalization failed: ${evidenceResponse.status()}`);
      const afterEvidence = await page.evaluate(async (task) => { const response = await fetch(`/api/admin/operations/occurrences/${task}/receipts`, { credentials: "same-origin", cache: "no-store" }); return { status: response.status, body: await response.json() }; }, state.tasks["hfo-al-d03-01"]);
      const satisfiedReceipt = afterEvidence.body.receipts?.[0];
      if (afterEvidence.status !== 200 || afterEvidence.body.receipts?.length !== 1 || satisfiedReceipt?.id !== heldReceipt.id || satisfiedReceipt?.evidence_status_current !== "complete" || afterEvidence.body.occurrence?.status !== "completed") throw new Error("Finalized evidence did not satisfy the same original performance receipt");
      report.scenarios.conditionalEvidence = { status: "PASS", task: "hfo-al-d03-01", upload: "prepare-put-uploaded-finalize", before: { receiptId: heldReceipt.id, completionState: heldReceipt.completion_state, occurrenceStatus: beforeEvidence.body.occurrence.status }, after: { sameReceipt: true, evidenceStatus: satisfiedReceipt.evidence_status_current, occurrenceStatus: afterEvidence.body.occurrence.status }, productionContent: false };

      const helpData = await page.evaluate(async ({ activity, facility, occurrence }) => {
        const query = new URLSearchParams({ activity_id: activity, facility_id: facility, occurrence_id: occurrence });
        const response = await fetch(`/api/admin/operations/help-handover?${query}`, { credentials: "same-origin", cache: "no-store" });
        return { status: response.status, body: await response.json() };
      }, { activity: state.activities["hfo-al-d03-01"], facility: state.ids.site, occurrence: state.tasks["hfo-al-d03-01"] });
      const acceptedDuty = helpData.body.current_duties?.find((duty) => duty.duty_scope === "Synthetic Daily mail check");
      if (helpData.status !== 200 || helpData.body.help?.payload?.contact !== "Synthetic facility manager" || !acceptedDuty?.owner_accepted_at || !acceptedDuty?.backup_accepted_at || !acceptedDuty?.active) throw new Error("Owner/backup/help handoff is incomplete");
      report.scenarios.helpAndCoverage = { status: "PASS", task: "hfo-al-d03-01", ownerAndBackupAccepted: true, helpVisibleThroughCurrentSession: true };

      const generator = taskRow(page, "Record generator test");
      await generator.getByText("Observation source record", { exact: true }).click();
      await generator.locator("select").nth(0).selectOption(state.ids.generator);
      const observed = localParts(new Date(Date.now() - 5 * 60_000));
      await setQuietDate(page, generator.locator("#observed-generator_test"), observed.label);
      await generator.locator("#observed-generator_test-time").fill(observed.time);
      await generator.locator("select").nth(1).selectOption("fail");
      await generator.getByLabel(/What failed \(required\)/).fill("Synthetic generator did not start; follow-up must remain open");
      await generator.getByLabel("Note", { exact: true }).fill("COL494 synthetic engineering proof");
      const observation = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/operations/asset-observations");
      await generator.getByRole("button", { name: "Record this observation", exact: true }).click();
      const observationResponse = await observation;
      const observationBody = await observationResponse.json();
      if (observationResponse.status() !== 200 || !observationBody.record?.id || observationBody.delivery?.event?.state !== "satisfied") throw new Error("Generator observation did not satisfy the matching synthetic task");
      await generator.getByText(/satisfied its matching requirement once/).waitFor({ timeout: 30_000 });
      const corrected = await page.evaluate(async ({ id }) => {
        const response = await fetch(`/api/admin/operations/asset-observations/${id}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request_key: crypto.randomUUID(), action: "void", payload: { reason: "Synthetic void proves source invalidation while the failed-result issue remains open" } }) });
        return { status: response.status, body: await response.json() };
      }, { id: observationBody.record.id });
      if (corrected.status !== 200 || corrected.body.delivery?.event?.state !== "invalidated") throw new Error(`Observation void failed: ${corrected.status}`);
      report.scenarios.generatorFailure = { status: "PASS", task: "hfo-al-w01-01", recordId: observationBody.record.id, issueRemainsOpen: true, sourceVoid: "invalidated" };

      const census = taskRow(page, "Update census");
      await census.getByText("Finance and census source context", { exact: true }).click();
      const today = localParts();
      await census.getByLabel("Source period start", { exact: true }).fill(today.iso);
      await census.getByLabel("Source period end", { exact: true }).fill(today.iso);
      await census.getByText("Daily census snapshots", { exact: true }).waitFor({ timeout: 30_000 });
      await census.getByText("Daily census snapshots", { exact: true }).click();
      if (!(await census.innerText()).includes("Occupied beds: 10")) throw new Error("Synthetic census source was not visible");
      await census.getByRole("button", { name: "Record unscheduled work", exact: true }).click();
      await census.getByText("Saved", { exact: true }).waitFor({ timeout: 30_000 });
      report.scenarios.censusContext = { status: "PASS", task: "hfo-al-d17-01", recordedSnapshotVisible: true, reviewRecordedSeparately: true };

      const resident = taskRow(page, "Review Residents Temp & 02 Log");
      await resident.getByText("Resident review source context", { exact: true }).click();
      await resident.getByLabel("Review start date", { exact: true }).fill(today.iso);
      await resident.getByLabel("Review end date", { exact: true }).fill(today.iso);
      const vital = resident.getByRole("checkbox", { name: /Recorded vital observation/ });
      await vital.waitFor({ timeout: 30_000 });
      await vital.check();
      await resident.getByLabel("Review findings", { exact: true }).fill("Synthetic temperature and oxygen source reviewed; no clinical conclusion inferred");
      const review = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith(`/occurrences/${state.tasks["hfo-al-d12-01"]}/source-review`));
      await resident.getByRole("button", { name: "Record review with selected sources", exact: true }).click();
      if ((await review).status() !== 200) throw new Error("Resident source review failed");
      await resident.getByText("Review recorded. Required evidence and any separate verification still apply.", { exact: true }).waitFor();
      report.scenarios.residentSourceReview = { status: "PASS", task: "hfo-al-d12-01", sourceFamily: "vital_observation", clinicalConclusionInferred: false };

      const employee = taskRow(page, "Review employee file currency");
      await employee.getByText("Employee File source context", { exact: true }).click();
      await employee.getByRole("link", { name: "Open existing Employee File", exact: true }).waitFor({ timeout: 30_000 });
      await employee.getByRole("button", { name: "Record unscheduled work", exact: true }).click();
      await employee.getByText("Saved", { exact: true }).waitFor({ timeout: 30_000 });
      report.scenarios.employeeFileContext = { status: "PASS", task: "hfo-al-w06-01", sourceContextVisible: true, employmentActionTaken: false };

      const ownerContext = await browser.newContext({ viewport, reducedMotion: "reduce" });
      await ownerContext.addCookies(cookies(state.sessions.owner));
      const owner = await ownerContext.newPage();
      const historyResponse = await owner.goto(`${base}/admin/operations/history?facility_id=${state.ids.site}&activity_id=${state.activities["hfo-al-d01-01"]}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
      if (!historyResponse || historyResponse.status() !== 200) throw new Error("Corporate history route failed");
      await owner.getByRole("heading", { name: "Corporate activity history" }).waitFor();
      await owner.getByText("Loading activity history…", { exact: true }).waitFor({ state: "hidden", timeout: 60_000 });
      const historyText = await owner.locator("main").innerText();
      if (!historyText.includes("Record marketing calls") || !historyText.match(/correction/i)) throw new Error("Corporate history did not expose the task and correction chain");
      const attentionResponse = await owner.goto(`${base}/admin/operations/attention?facility_id=${state.ids.site}&category=unresolved_issues`, { waitUntil: "domcontentloaded", timeout: 90_000 });
      if (!attentionResponse || attentionResponse.status() !== 200) throw new Error("Needs Attention route failed");
      await owner.getByRole("heading", { name: "Needs attention" }).waitFor();
      await owner.getByText("Loading attention counts and details…", { exact: true }).waitFor({ state: "hidden", timeout: 60_000 });
      const attentionText = await owner.locator("main").innerText();
      if (!attentionText.includes("Synthetic generator did not start")) throw new Error("Generator issue was absent from corporate Needs Attention");
      const corporateShot = path.join(path.dirname(output), "corporate-attention-desktop.png");
      await owner.screenshot({ path: corporateShot, fullPage: true });
      report.scenarios.corporate = { status: "PASS", historyCorrectionVisible: true, generatorIssueVisible: true, screenshot: path.relative(ROOT, corporateShot) };
      await ownerContext.close();

      const otherContext = await browser.newContext({ viewport, reducedMotion: "reduce" });
      await otherContext.addCookies(cookies(state.sessions.otherAdmin));
      const other = await otherContext.newPage();
      await other.goto(`${base}/admin/operations/work?facility_id=${state.ids.site}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
      await other.getByRole("heading", { name: "Site work" }).waitFor();
      await other.getByText("Facility not found", { exact: true }).waitFor({ timeout: 60_000 });
      report.scenarios.secondSiteDenial = { status: "PASS", siteAHiddenFromSiteBActor: true };
      await otherContext.close();
    }
    await context.close();
  }
} finally {
  await browser.close();
}
if (report.scenarios.routineRecovery?.status === "PASS") {
  for (const row of report.viewports) {
    const expected = row.name === "desktop" ? row.consoleErrors.filter((message) => message.includes("net::ERR_FAILED")).slice(0, 1) : [];
    row.expectedConsoleErrors.push(...expected.map((message) => ({ message, reason: "Intentional dropped response after the server committed; automatic readback reconciliation passed." })));
    let consumed = expected.length;
    row.consoleErrors = row.consoleErrors.filter((message) => !(consumed > 0 && message.includes("net::ERR_FAILED") && consumed--));
  }
}
const expectedScenarios = ["routineRecovery", "correction", "conditionalEvidence", "helpAndCoverage", "generatorFailure", "censusContext", "residentSourceReview", "employeeFileContext", "corporate", "secondSiteDenial"];
const completeViewports = ["desktop", "tablet", "mobile"].every((name) => report.viewports.some((row) => row.name === name));
const cleanBrowser = report.viewports.every((row) => row.pageErrors.length === 0 && row.consoleErrors.length === 0 && row.httpFailures.length === 0 && row.axeViolations.length === 0) && report.refusedOutbound.length === 0;
const completeScenarios = expectedScenarios.every((name) => report.scenarios[name]?.status === "PASS");
const finalResult = args.inspect === "true" || args["inspect-generator"] === "true" ? "INSPECT" : completeViewports && cleanBrowser && completeScenarios ? "PASS" : "FAIL";
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ result: finalResult, output, taskCounts: report.viewports.map((row) => [row.name, row.taskCount]), scenarios: expectedScenarios.map((name) => [name, report.scenarios[name]?.status ?? "missing"]), unexpectedErrors: report.viewports.flatMap((row) => [...row.pageErrors, ...row.consoleErrors, ...row.httpFailures]), axeViolations: report.viewports.flatMap((row) => row.axeViolations), refusedOutbound: report.refusedOutbound.length }));
if (finalResult === "FAIL") process.exitCode = 1;
