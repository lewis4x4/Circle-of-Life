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
export function useParams(){const p=usePathname().split('/');return {id:p.at(-1)==='print'?p.at(-2):p.at(-1)}}
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
  `import React from 'react';import {createRoot} from 'react-dom/client';import '@/app/globals.css';import {usePathname} from './navigation';import {InsuranceOverviewPage,InsurancePoliciesPage,InsuranceDocumentsPage,InsuranceDocumentPage,InsuranceNewPolicyPage,InsuranceDraftReviewPage,InsurancePolicyPage,InsuranceRenewalsPage,InsuranceCertificatesPage} from '@/components/insurance/workspace-pages';import {ServicingListPage,ServicingDetailPage,ServicingPrintPage} from '@/components/insurance/servicing-pages';
function Harness(){const route=usePathname();const Page=route.includes('/servicing/')&&route.endsWith('/print')?ServicingPrintPage:route.includes('/servicing/')?ServicingDetailPage:route.endsWith('/servicing')?ServicingListPage:route.endsWith('/policies/new')?InsuranceNewPolicyPage:route.includes('/review/')?InsuranceDraftReviewPage:route.includes('/documents/')?InsuranceDocumentPage:route.endsWith('/documents')?InsuranceDocumentsPage:route.includes('/policies/')?InsurancePolicyPage:route.endsWith('/policies')?InsurancePoliciesPage:route.endsWith('/renewals')?InsuranceRenewalsPage:route.endsWith('/coi')?InsuranceCertificatesPage:InsuranceOverviewPage;return <><div role="note" className="border-b border-border bg-muted px-5 py-3 text-sm font-medium">Synthetic browser verification · API/auth/navigation mocked · No real insurance data</div><main className="mx-auto max-w-[1600px] p-4 md:p-8"><Page key={route}/></main></>};createRoot(document.getElementById('root')!).render(<Harness/>);`,
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
  const formerOwnerId = "88888888-8888-4888-8888-888888888888";
  const servicingRecords = [];
  let servicingOwners = [
    ...workspace.owners,
    { id: formerOwnerId, name: "Former insurance owner" },
  ];
  const unknownMetric = {
    known_subtotal_cents: 0,
    missing_count: 0,
    total_cents: null,
  };
  const servicingWorkspace = () => ({
    records: servicingRecords,
    entities: workspace.entities,
    facilities: workspace.facilities,
    policies: workspace.policies,
    documents: workspace.documents,
    vendors: [{ id: entityId, name: "Synthetic vendor" }],
    contracts: [],
    owners: servicingOwners,
    incidents: [
      {
        id: policyId,
        facility_id: facilityId,
        incident_type: "fall",
        occurred_at: "2026-09-09T12:30:00Z",
      },
    ],
    loss_totals: {
      paid_cents: unknownMetric,
      reserve_cents: unknownMetric,
      recovery_cents: unknownMetric,
      expense_cents: unknownMetric,
      incurred_cents: unknownMetric,
      claim_count: 0,
      history_complete: false,
    },
  });
  const { parseServicingCommand } = await server.ssrLoadModule(
    path.join(repo, "src/lib/insurance/servicing-schema.ts"),
  );
  const saveServiceVersion = (record, event) => {
    const { versions, ...snapshot } = record;
    record.versions = [
      ...(versions || []),
      {
        id: `${record.id}:${record.version}`,
        record_id: record.id,
        version: record.version,
        snapshot: structuredClone(snapshot),
        event,
        created_at: "2026-09-09T12:00:00Z",
      },
    ];
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
    if (url.pathname.startsWith("/api/insurance/servicing")) {
      if (method === "GET" && url.pathname.endsWith("/export")) {
        const id = url.pathname.split("/").at(-2);
        const record = servicingRecords.find((r) => r.id === id);
        const version = Number(url.searchParams.get("version"));
        const snapshot = record.versions.find(
          (v) => v.version === version,
        ).snapshot;
        await route.fulfill({
          contentType: "application/json",
          headers: {
            "Content-Disposition":
              'attachment; filename="approved-package.json"',
          },
          body: JSON.stringify({ record: snapshot, version }),
        });
        return;
      }
      if (method === "GET") {
        await json(servicingWorkspace());
        return;
      }
      const command = parseServicingCommand(request.postDataJSON());
      result.api_commands.push(command);
      const input = command.payload;
      let record = servicingRecords.find((r) => r.id === input.id);
      if (command.action === "save") {
        const index = servicingRecords.findIndex((r) => r.id === input.id);
        record = {
          ...input,
          organization_id: entityId,
          version: (input.version || 0) + 1,
          status: record?.status || "draft",
          source_record_id: null,
          superseded_by: null,
          event_metadata: {},
          reviewed_by: null,
          reviewed_at: null,
          created_by: entityId,
          created_at: "2026-09-09T12:00:00Z",
          updated_at: "2026-09-09T12:00:00Z",
          display_names: {
            entity:
              workspace.entities.find((e) => e.id === input.entity_id)?.name ||
              "Unknown",
            facility: input.facility_id ? "Example ALF" : null,
            owner:
              servicingOwners.find((o) => o.id === input.owner_id)?.name ||
              null,
          },
          versions: record?.versions || [],
        };
        if (input.kind === "renewal_package")
          record.payload = {
            ...input.payload,
            policy_snapshot: {
              ...workspace.policies[0],
              entity_name: "Example ALF LLC",
              parties: workspace.policies[0].parties.map((p) => ({
                ...p,
                entity_name:
                  workspace.entities.find((e) => e.id === p.entity_id)?.name ||
                  "Unknown",
              })),
              facilities: workspace.policies[0].facilities.map((f) => ({
                ...f,
                facility_name: "Example ALF",
              })),
            },
          };
        if (index < 0) servicingRecords.push(record);
        else servicingRecords[index] = record;
        saveServiceVersion(record, { action: "save", actor: entityId });
        await json({ record });
        return;
      }
      assert(record, "Synthetic servicing record exists");
      assert.equal(
        input.version,
        record.version,
        "Servicing command uses current version",
      );
      if (command.action === "transition") {
        record.version++;
        record.status = input.status;
        record.event_metadata = {
          ...input,
          action: "transition",
          actor: entityId,
        };
        saveServiceVersion(record, record.event_metadata);
        if (input.status === "approved")
          servicingOwners = servicingOwners.filter(
            (o) => o.id !== formerOwnerId,
          );
        await json({ record });
        return;
      }
      if (command.action === "reassign") {
        record.version++;
        record.owner_id = input.owner_id;
        record.due_date = input.due_date;
        record.event_metadata = {
          ...input,
          action: "reassign",
          actor: entityId,
        };
        saveServiceVersion(record, record.event_metadata);
        await json({ record });
        return;
      }
      throw new Error(`Unexpected servicing fixture action ${command.action}`);
    }
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
      await frame.locator("input").evaluateAll((nodes) =>
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
  async function openServicingForm(kind) {
    await page.goto(`${base}admin/insurance/servicing?kind=${kind}`);
    await page
      .locator("summary")
      .filter({ hasText: /^Create / })
      .click();
    await page
      .getByLabel("Record title", { exact: true })
      .fill(`Synthetic ${kind.replaceAll("_", " ")}`);
    await page
      .getByLabel("Legal entity", { exact: true })
      .selectOption(entityId);
  }
  for (const kind of [
    "vendor_evidence",
    "loss_report",
    "claim_matter",
    "workforce_exposure",
  ]) {
    await openServicingForm(kind);
    if (kind === "vendor_evidence") {
      await page.getByLabel("Vendor", { exact: true }).selectOption(entityId);
      await page
        .getByLabel("Approved requirements to compare")
        .fill("Review the signed contract requirements.");
      await page
        .getByRole("checkbox", { name: /requirements need supporting/ })
        .check();
      await page
        .getByLabel("Supporting endorsement or policy")
        .selectOption(documentId);
      await page.getByLabel("Endorsement evidence page").fill("1");
      await page
        .getByLabel("Requirement assessment")
        .fill("Supporting provisions await final review.");
      await page.getByLabel("Evidence expiration date").fill("2027-09-01");
    }
    if (kind === "loss_report") {
      await page.getByLabel("Reporting carrier").fill("Example carrier");
      await page.getByLabel("Reported coverage line").fill("General liability");
      await page.getByLabel("Report valuation date").fill("2026-09-09");
      await page.getByLabel("Period start").fill("2026-01-01");
      await page.getByLabel("Period end").fill("2026-09-09");
      await page.getByRole("button", { name: "Add reported claim" }).click();
      await page.getByLabel("Claim 1 reference").fill("SYNTHETIC-CLAIM-1");
      await page.getByLabel("Claim 1 paid", { exact: true }).fill("1250.25");
      await page.getByLabel("Claim 1 source page").fill("2");
      await page.getByRole("table").scrollIntoViewIfNeeded();
      await shot("servicing-loss-rows");
    }
    if (kind === "claim_matter") {
      await page.getByLabel("Facility scope").selectOption(facilityId);
      await page
        .getByLabel("Proposed incident", { exact: true })
        .selectOption(policyId);
      await page.getByLabel("Date of loss", { exact: true }).fill("2026-09-09");
      await page
        .getByLabel("Insurance matter summary")
        .fill(
          "Administrative insurance inquiry only; no clinical notes copied.",
        );
      await page
        .getByLabel("Next servicing action")
        .fill("Request carrier reference through existing channel.");
      assert(
        (await page
          .getByRole("option", { name: /fall.*Example ALF/ })
          .count()) === 1,
      );
    }
    if (kind === "workforce_exposure") {
      await page.getByLabel("Period start").fill("2026-01-01");
      await page.getByLabel("Period end").fill("2026-12-31");
      await page
        .getByLabel("Manual exposure source reason")
        .fill("Synthetic aggregate payroll ledger reviewed by finance.");
      await page.getByRole("button", { name: "Add exposure row" }).click();
      await page.getByLabel("Exposure 1 state").selectOption("FL");
      await page.getByLabel("Exposure 1 class code").fill("8810");
      await page.getByLabel("Exposure 1 estimated payroll").fill("10000.25");
      await page
        .getByLabel("Exposure 1 basis note")
        .fill("Forecast aggregate; actual payroll unknown.");
      await page.getByRole("table").scrollIntoViewIfNeeded();
      await shot("servicing-exposure-rows");
    }
    await page
      .getByRole("button", { name: "Save servicing draft", exact: true })
      .click();
    await page
      .getByRole("heading", {
        name: `Synthetic ${kind.replaceAll("_", " ")}`,
        exact: true,
      })
      .waitFor();
    check(`servicing ${kind} form saves schema-valid draft`, {
      record_count: servicingRecords.length,
    });
  }
  const additionalEntityId = "99999999-9999-4999-8999-999999999999";
  workspace.entities.push({
    id: additionalEntityId,
    name: "Approved additional insured LLC",
  });
  workspace.policies[0].insured_entity_ids = [entityId, additionalEntityId];
  workspace.policies[0].covered_facility_ids = [facilityId];
  workspace.policies[0].parties.push({
    entity_id: additionalEntityId,
    role: "additional_insured",
    effective_from: "2026-09-01",
    effective_to: null,
  });
  await openServicingForm("renewal_package");
  await page
    .getByLabel("Legal entity", { exact: true })
    .selectOption(additionalEntityId);
  await page
    .getByLabel("Related policy", { exact: true })
    .selectOption(policyId);
  await page
    .getByLabel("Facility scope", { exact: true })
    .selectOption(facilityId);
  await page
    .getByLabel("Assigned record owner", { exact: true })
    .selectOption(formerOwnerId);
  await page.getByLabel("Period start").fill("2026-09-01");
  await page.getByLabel("Period end").fill("2027-09-01");
  await page
    .getByLabel("Location changes")
    .fill("Review the dated schedule; no assumed new locations.");
  await page
    .getByLabel("Exposure summary")
    .fill("Approved aggregate exposure facts only.");
  await page
    .getByLabel("Intended package recipient")
    .fill("Synthetic broker servicing desk");
  await page
    .getByRole("checkbox", { name: "synthetic-policy.pdf", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Save and request review", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Synthetic renewal package", exact: true })
    .waitFor();
  assert.equal(
    servicingRecords.find((r) => r.kind === "renewal_package").entity_id,
    additionalEntityId,
  );
  assert.equal(
    servicingRecords.find((r) => r.kind === "renewal_package").facility_id,
    facilityId,
  );
  check(
    "additional insured selects approved shared policy and covered facility",
    { entity_id: additionalEntityId, facility_id: facilityId },
  );
  await page
    .getByLabel("Open questions for the broker", { exact: true })
    .fill("Confirm the revised shared-location schedule.");
  await page
    .getByRole("button", { name: "Save and request review", exact: true })
    .click();
  await page
    .locator("p:visible")
    .filter({ hasText: "Renewal packages · review required · Version 3" })
    .waitFor();
  assert.equal(
    result.api_commands.filter(
      (c) =>
        c.action === "transition" && c.payload.status === "review_required",
    ).length,
    1,
  );
  check("in-review editing avoids redundant request-review transition", {
    version: 3,
  });
  await page.getByRole("checkbox", { name: /I checked the record/ }).check();
  await page
    .getByRole("button", { name: "Approve reviewed record", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create new revision", exact: true })
    .waitFor();
  const packageRecord = servicingRecords.find(
    (r) => r.kind === "renewal_package",
  );
  const frozenPayload = structuredClone(packageRecord.payload);
  assert(
    (await page
      .getByText(/Former assignee is inactive or unavailable/)
      .count()) === 1,
  );
  await page.getByLabel("Current operational owner").selectOption(entityId);
  await page
    .getByLabel("Assignment change reason")
    .fill("Former assignee departed; active manager takes responsibility.");
  await page
    .getByRole("button", { name: "Record assignment change", exact: true })
    .click();
  await page
    .getByText("Current owner: Insurance owner", { exact: true })
    .waitFor();
  assert.deepEqual(packageRecord.payload, frozenPayload);
  assert.equal(packageRecord.display_names.owner, "Former insurance owner");
  check(
    "servicing approved record reassignment preserves frozen prepared facts",
    { version: packageRecord.version },
  );
  await page.evaluate(() => scrollTo(0, 0));
  await shot("servicing-package-desktop");
  await axe("servicing-package-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await shot("servicing-package-mobile");
  const servicingWidth = await page.evaluate(() => ({
    viewport: innerWidth,
    width: document.documentElement.scrollWidth,
  }));
  assert(
    servicingWidth.width <= servicingWidth.viewport + 1,
    "Servicing mobile page has no horizontal overflow",
  );
  check("servicing mobile summary stays within the viewport", servicingWidth);
  await axe("servicing-package-mobile");
  await page.setViewportSize({ width: 1512, height: 1100 });
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "Download approved package file", exact: true })
    .click();
  const download = await downloadPromise;
  const exportedPath = path.join(evidence, "approved-package.json");
  await download.saveAs(exportedPath);
  const exported = JSON.parse(await readFile(exportedPath, "utf8"));
  assert.equal(exported.record.version, packageRecord.version);
  assert.deepEqual(exported.record.payload, frozenPayload);
  check("servicing export preserves the selected approved package version", {
    version: exported.version,
  });
  await page
    .getByRole("link", { name: "Open printable approved package", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Print approved package", exact: true })
    .waitFor();
  await shot("servicing-package-print");
  await axe("servicing-package-print");
  await page.pdf({
    path: path.join(evidence, "approved-package-print.pdf"),
    printBackground: true,
    format: "A4",
  });
  check("servicing approved package printable view renders with frozen names", {
    prepared_owner: packageRecord.display_names.owner,
  });
  const unassignedRecord = {
    ...structuredClone(packageRecord),
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    title: "Synthetic unassigned-preparation package",
    owner_id: null,
    display_names: { ...packageRecord.display_names, owner: null },
    version: 1,
    event_metadata: {},
    versions: [],
  };
  saveServiceVersion(unassignedRecord, { action: "approve", actor: entityId });
  servicingRecords.push(unassignedRecord);
  await page.goto(`${base}admin/insurance/servicing/${unassignedRecord.id}`);
  await page
    .getByLabel("Current operational owner", { exact: true })
    .selectOption(entityId);
  await page
    .getByLabel("Assignment change reason", { exact: true })
    .fill("Assign operational follow-up without altering prepared ownership.");
  await page
    .getByRole("button", { name: "Record assignment change", exact: true })
    .click();
  await page
    .getByText("Current owner: Insurance owner", { exact: true })
    .waitFor();
  servicingOwners.find((owner) => owner.id === entityId).name =
    "Renamed operational manager";
  await page.goto(
    `${base}admin/insurance/servicing/${unassignedRecord.id}/print?version=${unassignedRecord.version}`,
  );
  await page
    .getByRole("button", { name: "Print approved package", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByText("Owner at preparation", { exact: true })
      .locator("..")
      .locator("dd")
      .innerText(),
    "Unassigned",
  );
  assert.equal(await page.getByText(/Renamed operational manager/).count(), 0);
  await shot("servicing-null-owner-print");
  await axe("servicing-null-owner-print");
  await page.pdf({
    path: path.join(evidence, "approved-unassigned-owner-print.pdf"),
    printBackground: true,
    format: "A4",
  });
  check(
    "explicit null prepared owner stays unassigned after reassignment and directory rename",
    {
      prepared_owner: unassignedRecord.display_names.owner,
      current_owner: unassignedRecord.owner_id,
      version: unassignedRecord.version,
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
