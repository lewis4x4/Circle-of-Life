import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ require: vi.fn(), revalidate: vi.fn(), rpc: vi.fn(), attest: vi.fn(), download: vi.fn(), signedUpload: vi.fn() }));
vi.mock("@/lib/auth/current-api-actor", () => ({ requireCurrentApiActor: mocks.require, revalidateCurrentApiActor: mocks.revalidate }));

import { commandBenefitsCase, createBenefitsCase, downloadBenefitsDocument, finalizeBenefitsDocument, listBenefitsCases, prepareBenefitsDocument } from "./server";

const caseId = "00000000-0000-0000-0000-000000000101";
const residentId = "00000000-0000-0000-0000-000000000102";
const documentId = "00000000-0000-0000-0000-000000000103";
const facilityId = "00000000-0000-0000-0000-000000000104";
const actorId = "00000000-0000-0000-0000-000000000105";
const requestId = "960fe30d-2fd3-45a8-b5a3-7ceea294f617";
const actor = {
  id: actorId, organizationId: facilityId, appRole: "owner", client: { rpc: mocks.rpc },
  admin: { rpc: mocks.attest, storage: { from: () => ({ download: mocks.download, createSignedUploadUrl: mocks.signedUpload }) } },
};
const bytes = Buffer.from("%PDF-1.4\nA synthetic benefits fixture\n%%EOF");
const sha = createHash("sha256").update(bytes).digest("hex");
const doc = { id: documentId, case_id: caseId, filename: "bank statement.pdf", mime_type: "application/pdf", size_bytes: bytes.length, sha256: sha, storage_path: `${facilityId}/${caseId}/${documentId}`, status: "ready", document_type: "bank_statement", template_version: null, created_at: "2026-09-21T12:00:00Z", created_by: actorId };
const target = { document: doc, object: { id: residentId, version: "1", etag: createHash("md5").update(bytes).digest("hex"), size_bytes: bytes.length, mime_type: "application/pdf" } };
const request = (body: unknown) => new Request("http://localhost/api/admin/benefits/cases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.require.mockResolvedValue({ actor }); mocks.revalidate.mockResolvedValue({ actor });
  mocks.rpc.mockResolvedValue({ data: target, error: null });
  mocks.download.mockResolvedValue({ data: new Blob([bytes]), error: null });
  mocks.attest.mockResolvedValue({ data: null, error: null });
});

describe("benefits API authority and evidence", () => {
  it("refuses an absent session before querying case data", async () => {
    mocks.require.mockResolvedValue({ response: NextResponse.json({ error: "Sign in" }, { status: 401 }) });
    expect((await listBenefitsCases(new Request("http://localhost/api/admin/benefits/cases"))).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("accepts existing database UUIDs and derives identity in the create RPC", async () => {
    mocks.rpc.mockResolvedValue({ data: { case_id: caseId, revision: 1 }, error: null });
    expect((await createBenefitsCase(request({ resident_id: residentId, program: "smmc_ltc", request_id: requestId }))).status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledWith("benefits_case_create", { p_resident_id: residentId, p_admission_case_id: null, p_program: "smmc_ltc", p_request_id: requestId });
  });
  it("rejects forged organization and actor fields", async () => {
    expect((await createBenefitsCase(request({ resident_id: residentId, program: "smmc_ltc", request_id: requestId, organization_id: facilityId }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("keeps unverified list data as an error instead of reporting no cases", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const response = await listBenefitsCases(new Request("http://localhost/api/admin/benefits/cases"));
    expect(response.status).toBe(503); expect(await response.json()).not.toHaveProperty("cases");
  });
  it("bounds list requests", async () => {
    expect((await listBenefitsCases(new Request("http://localhost/api/admin/benefits/cases?limit=10000"))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("passes revision and request identity to the atomic command and surfaces conflicts", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0409" } });
    const response = await commandBenefitsCase(request({ action: "update_case", payload: { next_action: "Request current bank statement" }, expected_revision: 7, request_id: requestId }), caseId);
    expect(response.status).toBe(409);
    expect(mocks.rpc).toHaveBeenCalledWith("benefits_case_command", expect.objectContaining({ p_case_id: caseId, p_expected_revision: 7, p_request_id: requestId }));
  });
  it("rejects impossible dates before mutation", async () => {
    const response = await commandBenefitsCase(request({ action: "update_case", payload: { due_date: "2026-02-31" }, expected_revision: 1, request_id: requestId }), caseId);
    expect(response.status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not issue signed uploads after an authority revocation", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { case_id: caseId, revision: 2, document: { ...doc, status: "reserved" } }, error: null });
    mocks.revalidate.mockResolvedValue({ response: NextResponse.json({ error: "Revoked" }, { status: 403 }) });
    const response = await prepareBenefitsDocument(request({ filename: doc.filename, mime_type: doc.mime_type, size_bytes: doc.size_bytes, sha256: sha, document_type: "bank_statement", expected_revision: 1, request_id: requestId }), caseId);
    expect(response.status).toBe(403); expect(mocks.signedUpload).not.toHaveBeenCalled();
  });
  it("refuses a target document belonging to another case before storage access", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...target, document: { ...doc, case_id: residentId } }, error: null });
    expect((await downloadBenefitsDocument(new Request("http://localhost"), caseId, documentId)).status).toBe(503);
    expect(mocks.download).not.toHaveBeenCalled();
  });
  it("does not attest a file whose actual bytes mismatch its recorded checksum", async () => {
    mocks.download.mockResolvedValue({ data: new Blob([Buffer.from("%PDF-wrong")]), error: null });
    expect((await finalizeBenefitsDocument(request({ expected_revision: 2, request_id: requestId }), caseId, documentId)).status).toBe(409);
    expect(mocks.attest).not.toHaveBeenCalled();
  });
  it("refuses stale downloaded bytes when the current object ETag differs", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...target, object: { ...target.object, etag: "f".repeat(32) } }, error: null });
    expect((await finalizeBenefitsDocument(request({ expected_revision: 2, request_id: requestId }), caseId, documentId)).status).toBe(409);
    expect(mocks.attest).not.toHaveBeenCalled();
  });
  it("refuses a changed storage object during read", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: target, error: null }).mockResolvedValueOnce({ data: { ...target, object: { ...target.object, version: "2" } }, error: null });
    expect((await downloadBenefitsDocument(new Request("http://localhost"), caseId, documentId)).status).toBe(409);
  });
  it("rechecks authority after reading private bytes", async () => {
    mocks.revalidate.mockResolvedValueOnce({ actor }).mockResolvedValueOnce({ response: NextResponse.json({ error: "Revoked" }, { status: 403 }) });
    const response = await downloadBenefitsDocument(new Request("http://localhost"), caseId, documentId);
    expect(response.status).toBe(403); expect(response.headers.get("Content-Disposition")).toBeNull();
  });
  it("serves only verified bytes privately as an attachment", async () => {
    const response = await downloadBenefitsDocument(new Request("http://localhost"), caseId, documentId);
    expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("Content-Disposition")).toContain("attachment;");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  });
});
