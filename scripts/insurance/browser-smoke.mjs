#!/usr/bin/env node
/** Chromium component smoke. Auth/navigation/API fixtures are mocked; PDF rendering and source UI/CSS are real. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const run =
  process.env.INSURANCE_BROWSER_RUN_DIR ||
  "/Users/brianlewis/.hermes/tmp/agent-runs/haven-insurance-20260909";
const harness = path.join(run, "browser-harness");
const evidence = path.join(repo, "test-results/insurance/browser");
const manifestPath = path.join(run, "manifest.json");
const documentId = "33333333-3333-4333-8333-333333333333";
const entityId = "11111111-1111-4111-8111-111111111111";
const facilityId = "22222222-2222-4222-8222-222222222222";
const policyId = "44444444-4444-4444-8444-444444444444";
const pdfPath = path.join(
  repo,
  "tests/fixtures/insurance/synthetic-policy.pdf",
);
const result = {
  pdf_csp_mode: process.env.INSURANCE_BROWSER_PDF_CSP || "sandbox",
  fixture_only: true,
  scope:
    "Real Chromium; unchanged Haven components and CSS; mocked auth, Next navigation and insurance API. No production access, provider extraction or database authorization claim.",
  checks: [],
  screenshots: [],
  axe: [],
  errors: [],
  api_commands: [],
};

async function recordArtifact(file) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!manifest.artifacts.includes(file)) manifest.artifacts.push(file);
  assert(manifest.artifacts.length <= 1000, "Run manifest artifact bound");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  });
}
async function harnessFile(name, content) {
  const file = path.join(harness, name);
  await recordArtifact(file);
  await writeFile(file, content);
}
function syntheticPdf() {
  const lines = [
    [
      "SYNTHETIC INSURANCE DECLARATIONS",
      "TEST FIXTURE - NO ACTUAL COVERAGE",
      "Named insured: Example ALF LLC",
      "Carrier: Example carrier",
      "Policy: GL-123",
      "Term: September 1, 2026 to September 1, 2027",
      "Shared aggregate: USD 2,000,000",
      "Page 1 of 2",
    ],
    [
      "SYNTHETIC LOCATION SCHEDULE",
      "TEST FIXTURE - NO ACTUAL COVERAGE",
      "Policy number: GL-123",
      "Scheduled location: Example ALF",
      "Primary named insured: Example ALF LLC",
      "Source evidence example for page two",
      "Page 2 of 2",
    ],
  ];
  const streams = lines.map(
    (page) =>
      "BT /F1 18 Tf 54 735 Td " +
      page.map((s, i) => `${i ? "0 -38 Td " : ""}(${s}) Tj`).join("\n") +
      "\nET",
  );
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(streams[0])} >>\nstream\n${streams[0]}\nendstream`,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
    `<< /Length ${Buffer.byteLength(streams[1])} >>\nstream\n${streams[1]}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
    .join(
      "",
    )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
await mkdir(harness, { recursive: true });
await mkdir(evidence, { recursive: true });
await recordArtifact(harness);
for (const folder of ["vite-cache", "chromium-profile", "browser-tmp"]) {
  await mkdir(path.join(harness, folder), { recursive: true });
  await recordArtifact(path.join(harness, folder));
}
await writeFile(pdfPath, syntheticPdf());
await harnessFile(
  "index.html",
  '<!doctype html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Haven insurance synthetic browser verification</title></head><body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>',
);
await harnessFile(
  "navigation.tsx",
  `import {useSyncExternalStore} from 'react';
const subscribe=(f:()=>void)=>{window.addEventListener('harness-route',f);return()=>window.removeEventListener('harness-route',f)};
const snapshot=()=>location.pathname+location.search;
export function go(href:string){history.pushState({},'',href);window.dispatchEvent(new Event('harness-route'));window.scrollTo(0,0)}
export function usePathname(){return useSyncExternalStore(subscribe,snapshot).split('?')[0]}
export function useSearchParams(){useSyncExternalStore(subscribe,snapshot);return new URLSearchParams(location.search)}
export function useParams(){const p=usePathname().split('/');return {id:p.at(-1)}}
export function useRouter(){return {push:go,replace:go,refresh:()=>window.dispatchEvent(new Event('harness-route'))}}`,
);
await harnessFile(
  "link.tsx",
  `import React from 'react';import {go} from './navigation';export default function Link({href,children,...props}:any){return <a {...props} href={href} onClick={e=>{if(!e.ctrlKey&&!e.metaKey){e.preventDefault();go(String(href))}}}>{children}</a>}`,
);
await harnessFile(
  "auth.tsx",
  `export function useHavenAuth(){return {loading:false,organizationId:'${entityId}',appRole:'owner',user:{id:'${entityId}'}}}`,
);
await harnessFile(
  "facility.ts",
  "export function useFacilityStore(selector:any){return selector({selectedFacilityId:null})}",
);
await harnessFile(
  "entry.tsx",
  `import React from 'react';import {createRoot} from 'react-dom/client';import '@/app/globals.css';import {usePathname} from './navigation';import {InsuranceOverviewPage,InsurancePoliciesPage,InsuranceDocumentsPage,InsuranceDocumentPage,InsuranceNewPolicyPage,InsuranceDraftReviewPage,InsurancePolicyPage,InsuranceRenewalsPage,InsuranceCertificatesPage} from '@/components/insurance/workspace-pages';
function Harness(){const route=usePathname();const Page=route.endsWith('/policies/new')?InsuranceNewPolicyPage:route.includes('/review/')?InsuranceDraftReviewPage:route.includes('/documents/')?InsuranceDocumentPage:route.endsWith('/documents')?InsuranceDocumentsPage:route.includes('/policies/')?InsurancePolicyPage:route.endsWith('/policies')?InsurancePoliciesPage:route.endsWith('/renewals')?InsuranceRenewalsPage:route.endsWith('/coi')?InsuranceCertificatesPage:InsuranceOverviewPage;return <><div role="note" className="border-b border-border bg-muted px-5 py-3 text-sm font-medium">Synthetic browser verification · API/auth/navigation mocked · No real insurance data</div><main className="mx-auto max-w-[1600px] p-4 md:p-8"><Page key={route}/></main></>};createRoot(document.getElementById('root')!).render(<Harness/>);`,
);

const aliases = [
  ["@/contexts/haven-auth-context", path.join(harness, "auth.tsx")],
  ["@/hooks/useFacilityStore", path.join(harness, "facility.ts")],
  ["next/navigation", path.join(harness, "navigation.tsx")],
  ["next/link", path.join(harness, "link.tsx")],
  ["@", path.join(repo, "src")],
  ["react-dom", path.join(repo, "node_modules/react-dom")],
  ["react", path.join(repo, "node_modules/react")],
].map(([find, replacement]) => ({ find, replacement }));
const server = await createServer({
  configFile: false,
  root: harness,
  cacheDir: path.join(harness, "vite-cache"),
  plugins: [react()],
  resolve: { alias: aliases, dedupe: ["react", "react-dom"] },
  css: { postcss: repo },
  optimizeDeps: { include: ["react", "react-dom/client", "react/jsx-runtime"] },
  server: {
    host: "127.0.0.1",
    port: 0,
    headers: { "Content-Security-Policy": "frame-src 'self'" },
    fs: { allow: [repo, harness] },
    watch: { ignored: ["**/chromium-profile/**", "**/browser-tmp/**"] },
  },
});
let context;
try {
  await server.listen();
  const base = server.resolvedUrls.local[0];
  context = await chromium.launchPersistentContext(
    path.join(harness, "chromium-profile"),
    {
      headless: true,
      channel: "chromium",
      viewport: { width: 1512, height: 1100 },
      env: { ...process.env, TMPDIR: path.join(harness, "browser-tmp") },
      args: ["--disable-crash-reporter"],
    },
  );
  const page = await context.newPage();
  const requests = [];
  page.on("pageerror", (error) => result.errors.push(String(error)));
  page.on("request", (request) => {
    if (request.url().includes("/api/insurance/"))
      requests.push({
        method: request.method(),
        path: new URL(request.url()).pathname,
      });
  });
  const workspace = {
    can_manage: true,
    owners: [{ id: entityId, name: "Insurance owner" }],
    entities: [{ id: entityId, name: "Example ALF LLC" }],
    facilities: [{ id: facilityId, name: "Example ALF", entity_id: entityId }],
    policies: [],
    documents: [],
    drafts: [],
    work_items: [],
    certificate_requests: [],
    versions: [],
    claims: [],
    premium_allocations: [],
  };
  let uploads = 0;
  let extractions = 0;
  let lastSaved;
  const doc = {
    id: documentId,
    organization_id: entityId,
    filename: "synthetic-policy.pdf",
    family: "policy",
    mime_type: "application/pdf",
    byte_size: syntheticPdf().length,
    sha256: "synthetic-fixture-hash",
    storage_path: `${entityId}/${documentId}`,
    facility_id: null,
    status: "ready",
    scan_status: "not_configured",
    extraction_status: "failed",
    error: "Synthetic provider unavailable",
    run_id: null,
    created_at: "2026-09-09T01:00:00Z",
  };
  await context.route("**/api/insurance/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const json = (body) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (
      url.pathname === `/api/insurance/documents/${documentId}` &&
      method === "GET"
    ) {
      await route.fulfill({
        status: 200,
        contentType: "application/pdf",
        headers: {
          "Content-Disposition": 'inline; filename="synthetic-policy.pdf"',
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy":
            process.env.INSURANCE_BROWSER_PDF_CSP === "pdf"
              ? "default-src 'none'; frame-ancestors 'self'"
              : "sandbox; default-src 'none'; frame-ancestors 'self'",
        },
        body: await readFile(pdfPath),
      });
      return;
    }
    if (url.pathname === "/api/insurance/documents" && method === "POST") {
      uploads++;
      if (uploads === 1) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            error: "Synthetic upload failure. Retry your retained file.",
          }),
        });
        return;
      }
      workspace.documents = [doc];
      await json({ document: doc });
      return;
    }
    if (url.pathname.endsWith("/extract")) {
      extractions++;
      if (extractions === 1) {
        await route.fulfill({
          status: 504,
          contentType: "application/json",
          body: JSON.stringify({
            error: "Synthetic extraction timeout. Manual review is available.",
          }),
        });
        return;
      }
      doc.extraction_status = "manual_review";
      doc.error = null;
      await json({ document: doc });
      return;
    }
    if (method === "GET") {
      await json(workspace);
      return;
    }
    const command = request.postDataJSON();
    result.api_commands.push(command); // Only synthetic data.
    if (command.action === "save_draft") {
      lastSaved = {
        ...command.payload,
        revision: (command.payload.revision || 0) + 1,
        status: "draft",
        created_at: "2026-09-09T01:00:00Z",
      };
      workspace.drafts = [lastSaved];
      await json(lastSaved);
      return;
    }
    if (command.action === "approve_draft") {
      assert(command.payload.confirm_evidence === true);
      assert.equal(command.payload.revision, lastSaved.revision);
      workspace.policies = [
        {
          ...lastSaved.payload,
          id: policyId,
          verification_status: "verified",
          version: 1,
          status: "active",
        },
      ];
      workspace.drafts = [{ ...lastSaved, status: "approved" }];
      await json({ policy_id: policyId, version: 1 });
      return;
    }
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        error: `Unexpected synthetic command ${command.action}`,
      }),
    });
  });
  const check = (name, detail) =>
    result.checks.push({ name, passed: true, detail });
  async function shot(name, fullPage = false) {
    const output = path.join(evidence, `${name}.png`);
    await page.screenshot({ path: output, fullPage });
    result.screenshots.push(output);
  }
  async function axe(name) {
    const audit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    result.axe.push({
      name,
      violations: audit.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        description: v.description,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          failureSummary: n.failureSummary,
        })),
      })),
      incomplete: audit.incomplete.map((v) => ({
        id: v.id,
        nodes: v.nodes.length,
      })),
    });
  }
  await page.goto(`${base}admin/insurance/documents`);
  await page
    .getByLabel("Insurance file", { exact: true })
    .setInputFiles(pdfPath);
  await page
    .getByRole("button", { name: "Upload for review", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Synthetic upload failure" })
    .waitFor();
  await page.getByRole("button", { name: "Retry upload", exact: true }).click();
  await page
    .getByRole("heading", { name: "synthetic-policy.pdf", exact: true })
    .waitFor();
  check("upload failure and retained-file retry", { attempts: uploads });
  await page
    .getByRole("button", { name: "Retry extraction", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Synthetic extraction timeout" })
    .waitFor();
  await page
    .getByRole("button", { name: "Retry extraction", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Manual review is required" })
    .waitFor();
  check("extraction failure and manual-review fallback", {
    attempts: extractions,
  });
  await page.locator('iframe[title="Insurance source document"]').waitFor();
  await page.waitForTimeout(1500);
  await shot("document-desktop");
  check("same-origin PDF transport to browser frame", {
    pdf_requests: requests.filter(
      (r) => r.path === `/api/insurance/documents/${documentId}`,
    ),
    frames: page.frames().map((f) => ({ url: f.url(), name: f.name() })),
  });
  await page
    .getByRole("link", { name: "Start manual draft", exact: true })
    .click();
  await page
    .getByLabel("Primary named insured", { exact: true })
    .selectOption(entityId);
  await page.getByLabel("Carrier", { exact: true }).fill("Example carrier");
  await page.getByLabel("Policy number", { exact: true }).fill("GL-123");
  await page.getByLabel("Effective date", { exact: true }).fill("2026-09-01");
  await page.getByLabel("Expiration date", { exact: true }).fill("2027-09-01");
  await page
    .getByLabel("Limit sharing", { exact: true })
    .selectOption("shared");
  await page
    .getByRole("button", { name: "Add insured party", exact: true })
    .click();
  await page.getByRole("button", { name: "Add facility", exact: true }).click();
  const labels = [
    "Primary named insured",
    "Coverage type",
    "Carrier",
    "Effective date",
    "Expiration date",
    "Limit sharing",
    "Party 1 relationship",
    "Location 1 relationship",
  ];
  for (const label of labels) {
    await page
      .locator("summary")
      .filter({ hasText: `Evidence for ${label} ·` })
      .click();
    await page
      .getByLabel(`${label} verification reason`, { exact: true })
      .fill(
        "Synthetic reviewer checked the sample declarations and dated schedule.",
      );
  }
  await page
    .locator("summary")
    .filter({ hasText: "Evidence for Policy number ·" })
    .click();
  await page
    .getByLabel("Policy number evidence source", { exact: true })
    .selectOption("document");
  await page
    .getByLabel("Policy number source document", { exact: true })
    .selectOption(documentId);
  await page.getByLabel("Policy number source page", { exact: true }).fill("2");
  await page
    .getByLabel("Policy number source excerpt", { exact: true })
    .fill("Policy number: GL-123");
  await page.getByLabel("Preview page", { exact: true }).fill("2");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1000);
  assert(
    (
      await page
        .locator('iframe[title="Insurance source document"]')
        .getAttribute("src")
    ).endsWith("#page=2"),
  );
  result.native_pdf_inputs = [];
  for (const frame of page
    .frames()
    .filter((f) => f.url().startsWith("chrome-extension://"))) {
    result.native_pdf_inputs.push(
      await frame
        .locator("input")
        .evaluateAll((nodes) =>
          nodes.map((n) => ({
            type: n.type,
            value: n.value,
            label: n.getAttribute("aria-label"),
            title: n.title,
          })),
        ),
    );
  }
  assert(
    result.native_pdf_inputs
      .flat()
      .some((input) => input.label === "Page number" && input.value === "2"),
    "Native PDF viewer must display requested source page 2",
  );
  check("native PDF viewer displays requested page", {
    page: 2,
    inputs: result.native_pdf_inputs,
    original_csp:
      process.env.INSURANCE_BROWSER_PDF_CSP === "pdf"
        ? "default-src 'none'; frame-ancestors 'self'"
        : "sandbox; default-src 'none'; frame-ancestors 'self'",
    outer_frame_src: "'self'",
  });
  await shot("draft-desktop");
  await axe("draft-desktop");
  check("source page and per-field evidence controls", {
    source_page: 2,
    manual_fields: labels.length,
    document_fields: 1,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot("draft-mobile");
  await page
    .locator("legend")
    .filter({ hasText: "Policy facts" })
    .scrollIntoViewIfNeeded();
  await shot("draft-mobile-facts");
  await axe("draft-mobile");
  const overflow = await page.evaluate(() => ({
    viewport: innerWidth,
    width: document.documentElement.scrollWidth,
  }));
  assert(
    overflow.width <= overflow.viewport + 1,
    "No mobile horizontal overflow",
  );
  check("responsive mobile width", overflow);
  await page.setViewportSize({ width: 1512, height: 1100 });
  assert(
    await page
      .getByRole("button", { name: "Approve and publish", exact: true })
      .isDisabled(),
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Draft saved" }).waitFor();
  assert.equal(workspace.policies.length, 0);
  await page
    .getByRole("checkbox", { name: /I reviewed the critical facts/ })
    .check();
  await page
    .getByRole("button", { name: "Approve and publish", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Example carrier · GL-123", exact: true })
    .waitFor();
  await shot("policy-desktop");
  await axe("policy-desktop");
  assert.equal(workspace.policies.length, 1);
  assert.equal(lastSaved.payload.premium_cents, null);
  check(
    "manual draft save and explicit approval navigate to one verified policy",
    {
      save_calls: result.api_commands.filter((c) => c.action === "save_draft")
        .length,
      approvals: result.api_commands.filter((c) => c.action === "approve_draft")
        .length,
      premium_cents: lastSaved.payload.premium_cents,
    },
  );
  result.browser =
    context.browser()?.version() || "Chromium persistent context";
  result.requests = requests;
  result.passed =
    result.errors.length === 0 &&
    result.axe.every((a) => a.violations.length === 0);
  await writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      {
        passed: result.passed,
        checks: result.checks.length,
        axe: result.axe.map((a) => ({
          name: a.name,
          violations: a.violations.length,
        })),
        errors: result.errors,
        evidence,
      },
      null,
      2,
    ),
  );
  if (!result.passed) process.exitCode = 1;
} catch (error) {
  result.passed = false;
  result.failure = String(error);
  await writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.error(error);
  process.exitCode = 1;
} finally {
  await context?.close();
  await server.close();
}
