// Hosted smoke for the Medicaid & Benefits workflow (COL-504) against Haven HFO Staging.
//
// Drives the real Next.js routes (dev server pointed at staging) with real hosted auth,
// RLS, storage transport and PostgREST: staff case lifecycle, evidence upload/verify,
// submissions, receipts, funding, family collection, authorization refusals, and UI captures.
// Synthetic actors are created for the run and retired afterwards. Never run this against
// production: it refuses any project ref other than the staging ref.
//
// Usage (from the worktree root, with a dev server already running on BASE_URL):
//   set -a; source ~/.config/haven-staging/col217.env; set +a
//   BASE_URL=http://localhost:4624 EVIDENCE_DIR="<dir>" node scripts/benefits/staging-smoke.mjs
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { createHash, randomUUID, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import path from "node:path";

const STAGING_REF = "iwcnajanvjvynolltflw";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const baseUrl = process.env.BASE_URL || "http://localhost:4624";
const evidenceDir = process.env.EVIDENCE_DIR || path.resolve("test-results/benefits/staging");
if (!url || !anonKey || !serviceKey) throw new Error("staging env missing (source ~/.config/haven-staging/col217.env)");
if (!url.includes(STAGING_REF)) throw new Error(`refusing: NEXT_PUBLIC_SUPABASE_URL is not the staging project (${STAGING_REF})`);
mkdirSync(evidenceDir, { recursive: true });

const ORG = "00000000-0000-0000-0000-000000000001";
const FACILITY = "00000000-0000-0000-0002-000000000003"; // Synthetic facility 0003
const OTHER_FACILITY = "00000000-0000-0000-0002-000000000004";
const RESIDENT = "c0000003-0000-0000-0000-000000000002";
const OTHER_RESIDENT = "c0000004-0000-0000-0000-000000000001"; // facility 0004, out of scope for the nurse

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const run = `col504-${randomBytes(4).toString("hex")}`;
const password = `${randomBytes(12).toString("base64url")}!Aa1`;
const log = [];
const record = (step, ok, detail) => { log.push({ step, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${step}${detail ? " — " + (typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 300) : ""}`); if (!ok) failures.push(step); };
const failures = [];
const assert = (cond, step, detail) => record(step, Boolean(cond), detail);

function pngBytes(seed) {
  // Valid RGBA PNG whose pixel data is the seed (width = seed bytes / 4, height 1), so hashes differ per run and size scales with the seed.
  if (seed.length > 64) {
    const width = Math.floor(seed.length / 4);
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6;
    const raw = Buffer.concat([Buffer.from([0]), seed.subarray(0, width * 4)]);
    return assemblePng(ihdr, raw);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.concat([Buffer.from([0]), Buffer.from(seed.subarray(0, 8)), Buffer.from([0]), Buffer.from(seed.subarray(8, 16))]);
  return assemblePng(ihdr, raw);
}
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function assemblePng(ihdr, raw) {
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 0 })), chunk("IEND", Buffer.alloc(0))]);
}

async function createActor(role, label, links) {
  const email = `${run}-${label}@example.invalid`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { organization_id: ORG, app_role: role }, user_metadata: { synthetic: run } });
  if (created.error) throw new Error(`createUser ${label}: ${created.error.message}`);
  const id = created.data.user.id;
  const profile = await admin.from("user_profiles").upsert({ id, organization_id: ORG, email, full_name: `COL504 ${label}`, app_role: role, is_active: true, settings: {} }, { onConflict: "id" });
  if (profile.error) throw new Error(`profile ${label}: ${profile.error.message}`);
  for (const link of links) {
    const res = await admin.from(link.table).insert(link.row(id));
    if (res.error) throw new Error(`${link.table} ${label}: ${res.error.message}`);
  }
  return { id, email, role };
}

const owner = await createActor("owner", "owner", [{ table: "user_facility_access", row: (id) => ({ user_id: id, facility_id: FACILITY, organization_id: ORG, is_primary: true }) }]);
const nurse = await createActor("nurse", "nurse", [
  { table: "user_facility_access", row: (id) => ({ user_id: id, facility_id: FACILITY, organization_id: ORG, is_primary: true }) },
  { table: "staff", row: (id) => ({ user_id: id, facility_id: FACILITY, organization_id: ORG, first_name: "COL504", last_name: "Nurse", staff_role: "rn", employment_status: "active", hire_date: "2026-01-05", email: `${run}-nurse@example.invalid` }) },
]);
const family = await createActor("family", "family", [{ table: "family_resident_links", row: (id) => ({ user_id: id, resident_id: RESIDENT, organization_id: ORG, relationship: "daughter", is_responsible_party: true, can_view_clinical: false, can_view_financial: true, can_make_decisions: true }) }]);
const bystander = await createActor("family", "bystander", [{ table: "family_resident_links", row: (id) => ({ user_id: id, resident_id: RESIDENT, organization_id: ORG, relationship: "friend", can_view_clinical: false, can_view_financial: false, can_make_decisions: false }) }]);
record("setup: synthetic actors", true, { owner: owner.id, nurse: nurse.id, family: family.id, bystander: bystander.id });

const browser = await chromium.launch();
const createdDocuments = [];
let caseId = null; let ltcCaseId = null;

async function login(actor) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel(/email/i).fill(actor.email);
  await page.getByLabel(/password/i).fill(password);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 90_000 }), page.getByRole("button", { name: /sign in|log in/i }).click()]);
  return { context, page, api: context.request };
}
const json = async (res) => { const text = await res.text(); try { return JSON.parse(text); } catch { return { raw: text.slice(0, 200) }; } };
const post = (api, route, body) => api.post(`${baseUrl}${route}`, { data: body, headers: { "content-type": "application/json" } });
const command = (api, action, payload, revision) => post(api, `/api/admin/benefits/cases/${caseId}/commands`, { action, payload, expected_revision: revision, request_id: randomUUID() });

try {
  // ---- anonymous refusals
  const anonRes = await fetch(`${baseUrl}/api/admin/benefits/cases`);
  assert(anonRes.status === 401, "anonymous: list cases refused", anonRes.status);
  const anonFamily = await fetch(`${baseUrl}/api/family/benefits`);
  assert(anonFamily.status === 401, "anonymous: family list refused", anonFamily.status);

  // ---- owner session
  const o = await login(owner);
  let res = await o.api.get(`${baseUrl}/api/admin/benefits/options?facility_id=${FACILITY}`);
  let body = await json(res);
  assert(res.status() === 200 && body.facilities?.some((f) => f.id === FACILITY) && body.residents?.some((r) => r.id === RESIDENT), "owner: options lists facility and resident", { status: res.status(), facilities: body.facilities?.length, residents: body.residents?.length, can_manage_access: body.can_manage_access });
  assert(res.headers()["cache-control"]?.includes("no-store"), "owner: options is no-store", res.headers()["cache-control"]);

  // smmc_ltc seeds the Jessica checklist; verify it, then run the main flow on a second program with no seeded requirements.
  res = await post(o.api, "/api/admin/benefits/cases", { resident_id: RESIDENT, program: "smmc_ltc", request_id: randomUUID() }); body = await json(res);
  assert(res.status() === 201 && body.case_id, "owner: smmc_ltc case created", { status: res.status(), body });
  ltcCaseId = body.case_id;
  res = await o.api.get(`${baseUrl}/api/admin/benefits/cases/${ltcCaseId}`); body = await json(res);
  assert(res.status() === 200 && body.requirements?.length === 18 && body.requirements.every((r) => r.status === "missing"), "owner: smmc_ltc case seeded 18 checklist requirements, all missing", { count: body.requirements?.length });
  const createRequest = { resident_id: RESIDENT, program: "oss", request_id: randomUUID() };
  res = await post(o.api, "/api/admin/benefits/cases", createRequest); body = await json(res);
  assert(res.status() === 201 && body.case_id && body.revision === 1, "owner: create case", { status: res.status(), body });
  caseId = body.case_id;
  const replay = await post(o.api, "/api/admin/benefits/cases", createRequest); const replayBody = await json(replay);
  assert(replay.status() === 201 && replayBody.case_id === caseId, "owner: create replay with same request_id returns the same case", { status: replay.status(), body: replayBody });
  const dup = await post(o.api, "/api/admin/benefits/cases", { ...createRequest, request_id: randomUUID() });
  assert(dup.status() === 409, "owner: second active case for resident/program refused", dup.status());
  const crossOrgResident = await post(o.api, "/api/admin/benefits/cases", { resident_id: "00000000-0000-0000-0000-00000000dead", program: "oss", request_id: randomUUID() });
  assert([404, 409, 400].includes(crossOrgResident.status()), "owner: unknown resident refused", crossOrgResident.status());

  res = await o.api.get(`${baseUrl}/api/admin/benefits/cases/${caseId}`); let detail = await json(res);
  assert(res.status() === 200 && detail.case?.id === caseId && detail.case.facility_id === FACILITY, "owner: detail loads", { permissions: detail.permissions, revision: detail.case?.revision });
  let revision = detail.case.revision;
  const ownerPermissions = detail.permissions;

  res = await command(o.api, "update_case", { next_action: "Collect three months of bank statements", due_date: "2026-10-05", screening: { income_cents: 282900, assets_cents: 150000, income_basis: "gross", property: "no", life_insurance: "unknown", burial: "no", power_of_attorney: "yes", married: "no", notes: "Synthetic screening for hosted smoke", rule_reference: "DCF 2026 ICP standard (context only)" } }, revision); body = await json(res);
  assert(res.status() === 200 && body.revision === revision + 1, "owner: screening + next action saved", { status: res.status(), body });
  if (res.status() === 200) revision = body.revision;
  const stale = await command(o.api, "update_case", { next_action: "stale write" }, revision - 1);
  assert(stale.status() === 409, "owner: stale expected_revision refused with 409", stale.status());

  res = await command(o.api, "upsert_requirement", { title: "Three months of bank statements", stage: "application", status: "requested", due_date: "2026-10-05", signature_status: "not_required" }, revision); body = await json(res);
  assert(res.status() === 200, "owner: requirement created", { status: res.status(), body }); if (res.status() === 200) revision = body.revision;
  res = await command(o.api, "upsert_requirement", { title: "Financial release (signature required)", stage: "referral", status: "missing", signature_status: "pending" }, revision); body = await json(res);
  assert(res.status() === 200, "owner: signature requirement created", { status: res.status(), body }); if (res.status() === 200) revision = body.revision;
  res = await o.api.get(`${baseUrl}/api/admin/benefits/cases/${caseId}`); detail = await json(res);
  const bankReq = detail.requirements.find((r) => r.title.startsWith("Three months"));
  const signReq = detail.requirements.find((r) => r.title.startsWith("Financial release"));
  assert(bankReq && signReq, "owner: both requirements listed", detail.requirements.map((r) => [r.title, r.status]));

  // ---- staff evidence upload: prepare → signed upload → finalize → accept
  const bytes = pngBytes(randomBytes(16));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const prepareBody = { filename: `statement-${run}.png`, mime_type: "image/png", size_bytes: bytes.length, sha256, document_type: "bank_statement", expected_revision: revision, request_id: randomUUID() };
  res = await post(o.api, `/api/admin/benefits/cases/${caseId}/documents`, prepareBody); body = await json(res);
  assert(res.status() === 200 && body.document?.status === "reserved" && body.upload?.token, "owner: document reserved with signed upload", { status: res.status(), document: body.document?.id, hasUpload: Boolean(body.upload) });
  const documentId = body.document?.id; if (documentId) createdDocuments.push(body.document.storage_path);
  revision = body.revision ?? revision;
  const earlyDownload = await o.api.get(`${baseUrl}/api/admin/benefits/cases/${caseId}/documents/${documentId}`);
  assert(earlyDownload.status() === 409, "owner: download before upload refused", earlyDownload.status());
  const uploaded = await anon.storage.from("benefits-documents").uploadToSignedUrl(body.upload.path, body.upload.token, bytes, { contentType: "image/png" });
  assert(!uploaded.error, "owner: bytes uploaded through signed URL", uploaded.error?.message);
  const direct = await anon.storage.from("benefits-documents").download(body.upload.path);
  assert(direct.error, "anonymous: direct bucket read refused", direct.error?.message || "no error");
  res = await post(o.api, `/api/admin/benefits/cases/${caseId}/documents/${documentId}/finalize`, { expected_revision: revision, request_id: randomUUID() }); body = await json(res);
  assert(res.status() === 200 && body.document?.status === "ready", "owner: document finalized after byte verification", { status: res.status(), body });
  if (res.status() === 200) revision = body.revision;
  const download = await o.api.get(`${baseUrl}/api/admin/benefits/cases/${caseId}/documents/${documentId}`);
  const downloadedBytes = Buffer.from(await download.body());
  assert(download.status() === 200 && createHash("sha256").update(downloadedBytes).digest("hex") === sha256 && download.headers()["cache-control"]?.includes("no-store"), "owner: verified download returns identical bytes, no-store", { status: download.status(), length: downloadedBytes.length });

  // ---- a 6 MiB upload crosses the storage multipart threshold; etag/md5 and byte verification must still agree
  const bigBytes = pngBytes(randomBytes(6 * 1024 * 1024 + 16));
  const bigSha = createHash("sha256").update(bigBytes).digest("hex");
  res = await post(o.api, `/api/admin/benefits/cases/${caseId}/documents`, { filename: `scan-${run}.png`, mime_type: "image/png", size_bytes: bigBytes.length, sha256: bigSha, document_type: "bank_statement", expected_revision: revision, request_id: randomUUID() }); body = await json(res);
  assert(res.status() === 200 && body.upload?.token, "owner: large document reserved", { status: res.status(), size: bigBytes.length });
  const bigDoc = body.document?.id; if (body.document?.storage_path) createdDocuments.push(body.document.storage_path); revision = body.revision ?? revision;
  const bigUp = await anon.storage.from("benefits-documents").uploadToSignedUrl(body.upload.path, body.upload.token, bigBytes, { contentType: "image/png" });
  assert(!bigUp.error, "owner: large bytes uploaded", bigUp.error?.message);
  res = await post(o.api, `/api/admin/benefits/cases/${caseId}/documents/${bigDoc}/finalize`, { expected_revision: revision, request_id: randomUUID() }); body = await json(res);
  assert(res.status() === 200 && body.document?.status === "ready", "owner: large document finalized (multipart etag)", { status: res.status(), body });
  if (res.status() === 200) revision = body.revision;

  res = await command(o.api, "upsert_requirement", { id: bankReq.id, title: bankReq.title, stage: "application", status: "accepted", document_id: documentId, review_reason: "Three complete statements, legible", signature_status: "not_required" }, revision); body = await json(res);
  assert(res.status() === 200, "owner: requirement accepted with reviewed document", { status: res.status(), body }); if (res.status() === 200) revision = body.revision;

  // ---- agency history, submission, receipt, funding
  res = await command(o.api, "record_event", { agency: "elder_options", event_type: "screening", outcome: "Priority 5 reported by telephone assessment", occurred_on: "2026-09-18", notes: "Recorded from the administrator's call note", formal_decision: false }, revision); body = await json(res);
  assert(res.status() === 200, "owner: agency event recorded", { status: res.status(), body }); if (res.status() === 200) revision = body.revision;
  res = await command(o.api, "record_submission", { stage: "application", destination: "DCF ACCESS (fax)", method: "fax", sent_at: new Date().toISOString(), external_reference: `FAX-${run}`, document_ids: [documentId] }, revision); body = await json(res);
  assert(res.status() === 200, "owner: submission recorded with manifest", { status: res.status(), body }); if (res.status() === 200) revision = body.revision;
  res = await o.api.get(`${baseUrl}/api/admin/benefits/cases/${caseId}`); detail = await json(res);
  const submission = detail.submissions?.[0];
  assert(submission?.manifest?.some((m) => m.id === documentId && m.sha256 === sha256), "owner: submission manifest carries document id + sha256", submission?.manifest);
  res = await command(o.api, "record_receipt", { submission_id: submission.id, received_at: new Date().toISOString(), source_reference: "Fax confirmation page" }, revision); body = await json(res);
  assert(res.status() === 200, "owner: receipt recorded", { status: res.status(), body }); if (res.status() === 200) revision = body.revision;
  res = await command(o.api, "update_case", { funding: { plan: "Sunshine Health LTC", reference: `AUTH-${run}`, coverage_start: "2026-10-01", renewal_date: "2027-10-01", resident_contribution_cents: 120000, expected_benefit_cents: 350000, status: "unverified", notes: "Awaiting enrollment letter" } }, revision); body = await json(res);
  assert(res.status() === 200, "owner: funding facts saved (unverified)", { status: res.status(), body }); if (res.status() === 200) revision = body.revision;

  // ---- packet export
  res = await post(o.api, `/api/admin/benefits/cases/${caseId}/packet`, { document_ids: [documentId], expected_revision: revision });
  const packetBytes = Buffer.from(await res.body());
  assert(res.status() === 200 && res.headers()["content-type"] === "application/zip" && packetBytes.length > 100 && packetBytes.slice(0, 2).toString() === "PK", "owner: packet export is a zip of verified documents", { status: res.status(), length: packetBytes.length });

  // ---- family collection request
  res = await o.api.get(`${baseUrl}/api/admin/benefits/cases/${caseId}/collection`); body = await json(res);
  assert(res.status() === 200 && body.eligible_family?.some((f) => f.id === family.id) && !body.eligible_family?.some((f) => f.id === bystander.id), "owner: only financially-authorized family is eligible", body.eligible_family);
  const expires = new Date(Date.now() + 7 * 86400_000).toISOString();
  res = await post(o.api, `/api/admin/benefits/cases/${caseId}/collection`, { action: "assign", payload: { requirement_id: signReq.id, family_user_id: bystander.id, expires_at: expires }, expected_revision: revision, request_id: randomUUID() });
  assert(res.status() === 404 || res.status() === 403, "owner: assigning a family member without financial authority refused", res.status());
  res = await post(o.api, `/api/admin/benefits/cases/${caseId}/collection`, { action: "assign", payload: { requirement_id: signReq.id, family_user_id: family.id, expires_at: expires }, expected_revision: revision, request_id: randomUUID() }); body = await json(res);
  assert(res.status() === 200 && body.collection_id, "owner: collection request assigned to authorized family", { status: res.status(), body });
  const collectionId = body.collection_id; if (res.status() === 200) revision = body.revision;

  // ---- operating rules: readable, owner-changeable, effective-dated, never back-dated
  res = await o.api.get(`${baseUrl}/api/admin/benefits/rules`); body = await json(res);
  assert(res.status() === 200 && body.can_manage === true && body.rules?.length === 6 && body.rules.find((r) => r.rule_key === "checklist.smmc_ltc")?.value?.length === 18, "owner: rules list with seeded checklist", { status: res.status(), keys: body.rules?.map((r) => r.rule_key) });
  const todayIso = new Date().toISOString().slice(0, 10);
  res = await post(o.api, "/api/admin/benefits/rules", { rule_key: "renewal.warning_days", value: 400, effective_from: todayIso, reason: "smoke: too long" });
  assert(res.status() === 400, "owner: out-of-range rule refused", res.status());
  res = await post(o.api, "/api/admin/benefits/rules", { rule_key: "renewal.warning_days", value: 30, effective_from: "2026-01-01", reason: "smoke: back-dated" });
  assert(res.status() === 400 || res.status() === 409, "owner: back-dated rule refused", res.status());
  res = await post(o.api, "/api/admin/benefits/rules", { rule_key: "renewal.warning_days", value: 120, effective_from: todayIso, reason: `smoke ${run}: widen the renewal warning` }); body = await json(res);
  assert(res.status() === 201 && body.rule_key === "renewal.warning_days", "owner: renewal window rule recorded", { status: res.status(), body });
  res = await o.api.get(`${baseUrl}/api/admin/benefits/rules`); body = await json(res);
  assert(body.rules?.find((r) => r.rule_key === "renewal.warning_days")?.value === 120, "owner: recorded rule is in force today", body.rules?.find((r) => r.rule_key === "renewal.warning_days")?.value);
  // ---- queue ordering and Medicaid residents without a case
  res = await o.api.get(`${baseUrl}/api/admin/benefits/cases?facility_id=${FACILITY}`); body = await json(res);
  const dues = (body.cases ?? []).map((c) => c.due_date ?? "9999-12-31");
  assert(res.status() === 200 && dues.every((d, i) => i === 0 || d >= dues[i - 1]) && body.cases?.[0]?.due_date === "2026-10-05", "owner: queue orders soonest due first, undated last", dues);
  res = await o.api.get(`${baseUrl}/api/admin/benefits/options?facility_id=${FACILITY}`); body = await json(res);
  assert(res.status() === 200 && Array.isArray(body.uncased_medicaid_residents), "owner: options list Medicaid payers without a case", { count: body.uncased_medicaid_residents?.length });
  // ---- evidence access is recorded in the history
  res = await o.api.get(`${baseUrl}/api/admin/benefits/cases/${caseId}`); detail = await json(res);
  assert(detail.history?.some((h) => h.action === "document_download" && h.payload?.document_id === documentId) && detail.history?.some((h) => h.action === "document_packet"), "owner: download and packet export recorded in case history", detail.history?.filter((h) => h.action.startsWith("document_")).map((h) => h.action));
  // ---- resident moves facilities: case stays readable and flagged, writes refused, reviewed rebind follows the resident
  // The bed guard (444) refuses a facility change while a bed is held, so the move releases the bed and the return restores it.
  const before = await admin.from("residents").select("bed_id").eq("id", RESIDENT).single();
  const heldBed = before.data?.bed_id ?? null;
  const moved = await admin.from("residents").update({ facility_id: OTHER_FACILITY, bed_id: null }).eq("id", RESIDENT);
  assert(!moved.error, "setup: synthetic resident moved to facility 0004", moved.error?.message);
  try {
    res = await o.api.get(`${baseUrl}/api/admin/benefits/cases/${caseId}`); detail = await json(res);
    assert(res.status() === 200 && detail.case?.needs_rebind === true && detail.case?.resident_facility_id === OTHER_FACILITY, "owner: moved resident's case still readable and flagged", { status: res.status(), needs_rebind: detail.case?.needs_rebind });
    res = await command(o.api, "update_case", { next_action: "write while moved" }, detail.case.revision);
    assert(res.status() === 404, "owner: writes refused until rebind", res.status());
    res = await post(o.api, `/api/admin/benefits/cases/${caseId}/rebind`, { request_id: randomUUID() }); body = await json(res);
    assert(res.status() === 200 && body.facility_id === OTHER_FACILITY, "owner: rebind moved the case with the resident", { status: res.status(), body });
    res = await o.api.get(`${baseUrl}/api/admin/benefits/cases/${caseId}`); detail = await json(res);
    assert(detail.case?.needs_rebind === false && detail.case?.facility_id === OTHER_FACILITY && detail.history?.[0]?.action === "rebind_facility", "owner: rebind recorded and flag cleared", { history: detail.history?.[0]?.action });
    // back home so the rest of the smoke runs against facility 0003
    const back = await admin.from("residents").update({ facility_id: FACILITY, bed_id: heldBed }).eq("id", RESIDENT);
    assert(!back.error, "setup: resident returned to facility 0003", back.error?.message);
    res = await post(o.api, `/api/admin/benefits/cases/${caseId}/rebind`, { request_id: randomUUID() }); body = await json(res);
    assert(res.status() === 200 && body.facility_id === FACILITY, "owner: rebind back to facility 0003", { status: res.status(), body });
    res = await o.api.get(`${baseUrl}/api/admin/benefits/cases/${caseId}`); detail = await json(res); revision = detail.case.revision;
  } finally {
    await admin.from("residents").update({ facility_id: FACILITY, bed_id: heldBed }).eq("id", RESIDENT);
  }

  // ---- review findings (453): assignee filter, expired evidence, void, notice evidence, reviewed-funding guard, resume
  res = await o.api.get(`${baseUrl}/api/admin/benefits/options?facility_id=${FACILITY}`); body = await json(res);
  assert(res.status() === 200 && body.actor_id === owner.id, "owner: options carry the actor id for 'assigned to me'", body.actor_id);
  res = await command(o.api, "update_case", { assigned_to: owner.id }, revision); body = await json(res);
  assert(res.status() === 200, "owner: case assigned to owner", { status: res.status(), body }); if (res.status() === 200) revision = body.revision;
  res = await o.api.get(`${baseUrl}/api/admin/benefits/cases?facility_id=${FACILITY}&assigned_to=${owner.id}`); body = await json(res);
  assert(res.status() === 200 && body.cases?.length === 1 && body.cases[0].id === caseId && body.cases[0].assignee_active === true, "owner: 'assigned to me' filter returns the assigned case with active authority", { count: body.cases?.length, active: body.cases?.[0]?.assignee_active });
  res = await o.api.get(`${baseUrl}/api/admin/benefits/cases?facility_id=${FACILITY}&assigned_to=${nurse.id}`); body = await json(res);
  assert(res.status() === 200 && body.cases?.length === 0, "owner: assignee filter excludes other people's cases", body.cases?.length);
  res = await command(o.api, "record_event", { agency: "other", event_type: "notice_review", outcome: "45-day notice considered", occurred_on: "2026-09-18" }, revision);
  assert(res.status() === 400, "owner: notice event without the notice document refused", res.status());
  res = await command(o.api, "record_event", { agency: "other", event_type: "notice_review", outcome: "45-day notice considered", occurred_on: "2026-09-18", document_id: documentId }, revision); body = await json(res);
  assert(res.status() === 200, "owner: notice event recorded against the notice document", { status: res.status(), body }); if (res.status() === 200) revision = body.revision;
  res = await command(o.api, "upsert_requirement", { id: bankReq.id, title: bankReq.title, stage: "application", status: "accepted", document_id: documentId, review_reason: "verify with a signed date", signature_status: "verified" }, revision);
  assert(res.status() === 400, "owner: verified signature without signed_on refused", res.status());
  res = await command(o.api, "upsert_requirement", { id: bankReq.id, title: bankReq.title, stage: "application", status: "expired", review_reason: "Statements older than three months", signature_status: "not_required" }, revision); body = await json(res);
  assert(res.status() === 200, "owner: requirement marked expired", { status: res.status(), body }); if (res.status() === 200) revision = body.revision;
  res = await command(o.api, "record_submission", { stage: "application", destination: "DCF ACCESS (fax)", method: "fax", sent_at: new Date().toISOString(), document_ids: [documentId] }, revision);
  assert(res.status() === 409 || res.status() === 400, "owner: submission refused while a stage requirement is expired", res.status());
  res = await command(o.api, "void_document", { document_id: bigDoc, reason: "Uploaded to the wrong resident" }, revision); body = await json(res);
  assert(res.status() === 200, "owner: misfiled document voided", { status: res.status(), body }); if (res.status() === 200) revision = body.revision;
  res = await o.api.get(`${baseUrl}/api/admin/benefits/cases/${caseId}/documents/${bigDoc}`);
  assert(res.status() === 404, "owner: voided document no longer downloadable", res.status());
  res = await o.api.get(`${baseUrl}/api/admin/benefits/cases/${caseId}`); detail = await json(res);
  assert(detail.documents?.find((d) => d.id === bigDoc)?.void_reason === "Uploaded to the wrong resident" && detail.requirements?.find((r) => r.id === bankReq.id)?.assignee_name !== undefined, "owner: detail shows the void reason and requirement assignee names", { void: detail.documents?.find((d) => d.id === bigDoc)?.void_reason });
  // resume a reserved upload with the same original file after "losing" browser state
  const lostBytes = pngBytes(randomBytes(32)); const lostSha = createHash("sha256").update(lostBytes).digest("hex");
  res = await post(o.api, `/api/admin/benefits/cases/${caseId}/documents`, { filename: `lost-${run}.png`, mime_type: "image/png", size_bytes: lostBytes.length, sha256: lostSha, document_type: "bank_statement", expected_revision: revision, request_id: randomUUID() }); body = await json(res);
  assert(res.status() === 200 && body.document?.status === "reserved", "owner: reservation left unfinished", { status: res.status() });
  const lostDoc = body.document?.id; if (body.document?.storage_path) createdDocuments.push(body.document.storage_path); revision = body.revision ?? revision;
  res = await post(o.api, `/api/admin/benefits/cases/${caseId}/documents`, { filename: `lost-${run}.png`, mime_type: "image/png", size_bytes: lostBytes.length, sha256: "0".repeat(64), document_type: "bank_statement", expected_revision: revision, request_id: randomUUID(), resume_document_id: lostDoc });
  assert(res.status() === 409, "owner: resume with a different file refused", res.status());
  res = await post(o.api, `/api/admin/benefits/cases/${caseId}/documents`, { filename: `lost-${run}.png`, mime_type: "image/png", size_bytes: lostBytes.length, sha256: lostSha, document_type: "bank_statement", expected_revision: revision, request_id: randomUUID(), resume_document_id: lostDoc }); body = await json(res);
  assert(res.status() === 200 && body.document?.id === lostDoc && body.upload?.token, "owner: resume returns the same document with a fresh upload link", { status: res.status(), same: body.document?.id === lostDoc });
  const resumed = await anon.storage.from("benefits-documents").uploadToSignedUrl(body.upload.path, body.upload.token, lostBytes, { contentType: "image/png" });
  assert(!resumed.error, "owner: resumed bytes uploaded", resumed.error?.message);
  res = await post(o.api, `/api/admin/benefits/cases/${caseId}/documents/${lostDoc}/finalize`, { expected_revision: revision, request_id: randomUUID() }); body = await json(res);
  assert(res.status() === 200 && body.document?.status === "ready", "owner: resumed upload finalized", { status: res.status() }); if (res.status() === 200) revision = body.revision;

  // ---- owner UI captures
  for (const [width, label] of [[1440, "1440"], [390, "390"]]) {
    await o.page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await o.page.goto(`${baseUrl}/admin/benefits`, { waitUntil: "networkidle" });
    await o.page.screenshot({ path: path.join(evidenceDir, `${label}-queue.png`), fullPage: true });
    await o.page.goto(`${baseUrl}/admin/benefits/${caseId}`, { waitUntil: "networkidle" });
    await o.page.screenshot({ path: path.join(evidenceDir, `${label}-case.png`), fullPage: true });
  }
  const queueText = await o.page.textContent("body");
  assert(queueText.includes("Collect three months of bank statements") || queueText.includes("bank statements"), "owner UI: case detail shows the next action", queueText.slice(0, 120));

  // ---- family session
  const f = await login(family);
  res = await f.api.get(`${baseUrl}/api/admin/benefits/cases`);
  assert(res.status() === 403, "family: staff queue refused with 403", res.status());
  res = await f.api.get(`${baseUrl}/api/family/benefits`); body = await json(res);
  const familyRequest = body.requests?.find((r) => r.id === collectionId);
  assert(res.status() === 200 && familyRequest && familyRequest.requires_signature === true, "family: sees the assigned request only", { status: res.status(), requests: body.requests?.length, requires_signature: familyRequest?.requires_signature });
  const familyBytes = pngBytes(randomBytes(16)); const familySha = createHash("sha256").update(familyBytes).digest("hex");
  res = await post(f.api, `/api/family/benefits/requests/${collectionId}/documents`, { filename: `release-${run}.png`, mime_type: "image/png", size_bytes: familyBytes.length, sha256: familySha, expected_revision: familyRequest.revision, request_id: randomUUID() }); body = await json(res);
  assert(res.status() === 200 && body.document?.id && body.upload?.token, "family: upload reserved", { status: res.status(), body: { ...body, upload: Boolean(body.upload) } });
  const familyDoc = body.document?.id; if (body.upload?.path) createdDocuments.push(body.upload.path);
  assert(!("storage_path" in (body.document || {})) && !("sha256" in (body.document || {})), "family: reply hides storage path and hash", Object.keys(body.document || {}));
  const familyUpload = await anon.storage.from("benefits-documents").uploadToSignedUrl(body.upload.path, body.upload.token, familyBytes, { contentType: "image/png" });
  assert(!familyUpload.error, "family: bytes uploaded", familyUpload.error?.message);
  res = await post(f.api, `/api/family/benefits/requests/${collectionId}/documents/${familyDoc}/finalize`, { expected_revision: body.revision, request_id: randomUUID() }); body = await json(res);
  assert(res.status() === 200 && body.document?.status === "ready", "family: upload finalized", { status: res.status(), body });
  const familySteal = await f.api.get(`${baseUrl}/api/admin/benefits/cases/${caseId}/documents/${documentId}`);
  assert(familySteal.status() === 403, "family: staff document download refused", familySteal.status());
  await f.page.goto(`${baseUrl}/family/benefits`, { waitUntil: "networkidle" });
  await f.page.screenshot({ path: path.join(evidenceDir, "1440-family.png"), fullPage: true });
  await f.context.close();

  // ---- bystander family (no financial authority) sees nothing
  const b = await login(bystander);
  res = await b.api.get(`${baseUrl}/api/family/benefits`); body = await json(res);
  assert(res.status() === 200 && (body.requests?.length ?? 0) === 0, "bystander family: empty list, not an error", { status: res.status(), requests: body.requests?.length });
  await b.context.close();

  // ---- owner sees the family document as received, pending signature review
  res = await o.api.get(`${baseUrl}/api/admin/benefits/cases/${caseId}`); detail = await json(res);
  const signNow = detail.requirements.find((r) => r.id === signReq.id);
  assert(signNow?.status === "received" && signNow?.signature_status === "pending" && signNow?.document_id === familyDoc, "owner: family upload moved the requirement to received / signature pending", { status: signNow?.status, signature: signNow?.signature_status });
  revision = detail.case.revision;

  // ---- nurse without a grant: no financial access
  const n = await login(nurse);
  res = await n.api.get(`${baseUrl}/api/admin/benefits/cases/${caseId}`);
  assert(res.status() === 404 || res.status() === 403, "nurse without grant: case detail refused", res.status());
  res = await n.api.get(`${baseUrl}/api/admin/benefits/cases?facility_id=${FACILITY}`); body = await json(res);
  assert(res.status() === 403 || res.status() === 404 || (res.status() === 200 && body.cases?.length === 0), "nurse without grant: queue empty or refused", { status: res.status(), cases: body.cases?.length });
  // owner grants the nurse write (not review) access
  res = await post(o.api, "/api/admin/benefits/access", { facility_id: FACILITY, user_id: nurse.id, can_write: true, can_review: false, expires_at: expires, reason: "Hosted smoke: nurse collects evidence" }); body = await json(res);
  assert(res.status() === 200, "owner: grants nurse benefits write access", { status: res.status(), body });
  res = await n.api.get(`${baseUrl}/api/admin/benefits/cases/${caseId}`); detail = await json(res);
  assert(res.status() === 200 && detail.permissions?.can_write === true && detail.permissions?.can_review === false, "nurse with grant: detail loads with write-only permissions", detail.permissions);
  revision = detail.case.revision;
  res = await command(n.api, "upsert_requirement", { id: signReq.id, title: signReq.title, stage: "application", status: "accepted", document_id: familyDoc, review_reason: "nurse trying to accept", signature_status: "verified" }, revision);
  assert(res.status() === 403 || res.status() === 404 || res.status() === 409, "nurse with write-only grant: acceptance refused", res.status());
  res = await command(n.api, "update_case", { funding: { notes: "write-only rewrite" } }, revision);
  assert(res.status() === 200, "nurse with write-only grant: unreviewed funding notes may be edited", res.status());
  if (res.status() === 200) { body = await json(res); revision = body.revision; }
  res = await n.api.get(`${baseUrl}/api/admin/benefits/cases?facility_id=${OTHER_FACILITY}`); body = await json(res);
  assert(res.status() !== 200 || (body.cases?.length ?? 0) === 0, "nurse: other facility queue not visible", { status: res.status(), cases: body.cases?.length });
  // revoke and re-check
  res = await post(o.api, "/api/admin/benefits/access", { facility_id: FACILITY, user_id: nurse.id, can_write: true, can_review: false, expires_at: expires, revoked: true, reason: "Hosted smoke: revoke" });
  assert(res.status() === 200, "owner: revokes nurse grant", res.status());
  res = await n.api.get(`${baseUrl}/api/admin/benefits/cases/${caseId}`);
  assert(res.status() === 404 || res.status() === 403, "nurse after revocation: case detail refused again", res.status());
  await n.context.close();

  // ---- close and reopen
  res = await o.api.get(`${baseUrl}/api/admin/benefits/cases/${caseId}`); detail = await json(res); revision = detail.case.revision;
  res = await command(o.api, "update_case", { status: "closed" }, revision);
  assert(res.status() === 400 || res.status() === 409, "owner: closing without a reason refused", res.status());
  res = await command(o.api, "update_case", { status: "closed", closure_reason: "Hosted smoke complete" }, revision); body = await json(res);
  assert(res.status() === 200, "owner: closed with reason", { status: res.status(), body }); if (res.status() === 200) revision = body.revision;
  res = await command(o.api, "update_case", { status: "open" }, revision); body = await json(res);
  assert(res.status() === 200, "owner: reopened", { status: res.status(), body }); if (res.status() === 200) revision = body.revision;
  res = await o.api.get(`${baseUrl}/api/admin/benefits/cases/${caseId}`); detail = await json(res);
  assert(detail.case.status === "open" && detail.case.funding?.status !== "reviewed" && detail.history?.length >= 10, "owner: reopen keeps funding unverified and history intact", { status: detail.case.status, funding: detail.case.funding?.status, history: detail.history?.length, has_more: detail.history_has_more });
  assert(detail.permissions && ownerPermissions, "owner permissions recorded", ownerPermissions);
  await o.context.close();
} catch (error) {
  record("unexpected error", false, error?.stack || String(error));
} finally {
  await browser.close();
  // ---- retire synthetic actors and evidence
  const cleanup = [];
  try {
    if (createdDocuments.length) { const removed = await admin.storage.from("benefits-documents").remove(createdDocuments); cleanup.push({ storage: removed.error?.message || createdDocuments.length }); }
    if (caseId) cleanup.push({ case: caseId, note: "case rows are immutable evidence; retire them with scripts/benefits/staging-smoke-cleanup.sql as the postgres role" });
    for (const actor of [owner, nurse, family, bystander]) {
      await admin.from("user_facility_access").delete().eq("user_id", actor.id);
      await admin.from("family_resident_links").delete().eq("user_id", actor.id);
      // Retire the synthetic staff row too: one active staff row per facility, name and hire date (COL-793).
      await admin.from("staff").update({ deleted_at: new Date().toISOString(), notes: `${run} smoke actor retired` }).eq("user_id", actor.id).is("deleted_at", null);
      const banned = await admin.auth.admin.updateUserById(actor.id, { ban_duration: "876000h" });
      await admin.from("user_profiles").update({ is_active: false, deleted_at: new Date().toISOString() }).eq("id", actor.id);
      cleanup.push({ actor: actor.email, banned: !banned.error });
    }
  } catch (error) { cleanup.push({ error: String(error) }); }
  const summary = { run, target: STAGING_REF, base_url: baseUrl, case_id: caseId, ltc_case_id: ltcCaseId, actors: { owner: owner.id, nurse: nurse.id, family: family.id, bystander: bystander.id }, steps: log, failures, cleanup, finished_at: new Date().toISOString() };
  writeFileSync(path.join(evidenceDir, "staging-smoke.json"), JSON.stringify(summary, null, 2));
  console.log(`\n${failures.length ? "FAIL" : "PASS"}: ${log.filter((s) => s.ok).length}/${log.length} steps; evidence ${evidenceDir}`);
  process.exit(failures.length ? 1 : 0);
}
