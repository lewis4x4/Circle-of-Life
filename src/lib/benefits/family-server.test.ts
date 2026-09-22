import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { finalizeFamilyBenefitsDocument, listFamilyBenefits, prepareFamilyBenefitsDocument, commandBenefitsCollection } from "./family-server";

const state = vi.hoisted(() => ({ actor: {} as Record<string, unknown>, denied: false, bytes: new Uint8Array(), doc: {} as Record<string, unknown>, object: {} as Record<string, unknown>, downloads: 0, attestations: 0, commands: [] as Array<Record<string, unknown>>, linkRevokedOnDownload: false, changedObjectOnDownload: false, deniedOnSignedUrl: false, malformedList: false, role: "family", list: [] as unknown[], signed: vi.fn() }));
vi.mock("@/lib/auth/current-api-actor", () => ({
  requireCurrentApiActor: async (options: { allowedRoles: string[] }) => options.allowedRoles.includes(state.role) ? { actor: state.actor } : { response: Response.json({ error: "Denied" }, { status: 403 }) },
  revalidateCurrentApiActor: async () => state.denied ? { response: Response.json({ error: "Revoked" }, { status: 403 }) } : { actor: state.actor },
}));
const org = "00000000-0000-0000-0000-000000000001", caseId = "00000000-0000-0000-0000-000000000002", docId = "00000000-0000-0000-0000-000000000003", userId = "00000000-0000-0000-0000-000000000004", collectionId = "00000000-0000-0000-0000-000000000005";
const commandId = "11111111-1111-4111-8111-111111111111";
const date = "2026-09-21T12:00:00Z";
const request = (value: unknown) => new Request("https://haven.test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
const prepare = () => ({ filename: state.doc.filename, mime_type: state.doc.mime_type, size_bytes: state.doc.size_bytes, sha256: state.doc.sha256, expected_revision: 3, request_id: commandId });
const finalize = () => request({ expected_revision: 4, request_id: commandId });

beforeEach(() => {
  state.denied = false; state.linkRevokedOnDownload = false; state.changedObjectOnDownload = false; state.deniedOnSignedUrl = false; state.malformedList = false; state.role = "family";
  state.bytes = new Uint8Array(Buffer.from("%PDF-1.7\nfixture")); state.downloads = 0; state.attestations = 0; state.commands = [];
  state.doc = { id: docId, case_id: caseId, filename: "statement.pdf", mime_type: "application/pdf", size_bytes: state.bytes.length, sha256: createHash("sha256").update(state.bytes).digest("hex"), storage_path: `${org}/${caseId}/${docId}`, status: "reserved", document_type: "family_requested_evidence", template_version: null, created_at: date, created_by: userId };
  state.object = { id: docId, version: "v1", etag: "etag1", size_bytes: state.bytes.length, mime_type: "application/pdf" };
  state.list = [{ id: collectionId, resident_name: "Synthetic Person", title: "Bank statement", due_date: null, expires_at: date, requires_signature: false, revision: 3, upload: null, forbidden_case_finances: { income: 100000 } }];
  const rpc = async (name: string, params: Record<string, unknown>) => {
    if (state.denied) return { error: { code: "42501" }, data: null };
    if (name === "benefits_family_list") return { error: null, data: state.malformedList ? { requests: null } : { requests: state.list } };
    if (name === "benefits_family_target") return { error: null, data: { document: { ...state.doc }, object: { ...state.object } } };
    if (name === "benefits_family_command") { state.commands.push(params); return { error: null, data: { collection_id: collectionId, revision: 4, document: { ...state.doc, ...(params.p_action === "finalize" ? { status: "ready" } : {}) } } }; }
    throw new Error("Unexpected RPC " + name);
  };
  state.signed.mockReset(); state.signed.mockImplementation(async () => { if (state.deniedOnSignedUrl) state.denied = true; return { error: null, data: { signedUrl: "https://storage.test/upload", token: "synthetic-token", path: state.doc.storage_path } }; });
  state.actor = { id: userId, organizationId: org, appRole: "family", client: { rpc }, admin: { rpc: async () => { state.attestations++; return { error: null }; }, storage: { from: () => ({ createSignedUploadUrl: state.signed, download: async () => { state.downloads++; if (state.linkRevokedOnDownload) state.denied = true; if (state.changedObjectOnDownload) state.object.version = "v2"; return { error: null, data: new Blob([new Uint8Array(state.bytes)]) }; } }) } } };
});

describe("authenticated benefits family collection", () => {
  it("returns only validated explicit request fields with no-store", async () => {
    const response = await listFamilyBenefits();
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    const data = await response.json(); expect(data.requests[0].title).toBe("Bank statement"); expect(data.requests[0].forbidden_case_finances).toBeUndefined();
  });
  it("distinguishes an unreadable list from a successful empty result", async () => {
    state.malformedList = true; expect((await listFamilyBenefits()).status).toBe(503);
    state.malformedList = false; state.list = []; expect(await (await listFamilyBenefits()).json()).toEqual({ requests: [] });
  });
  it("rejects wrong actors before issuing uploads or listing requests", async () => {
    state.role = "manager"; expect((await listFamilyBenefits()).status).toBe(403); expect((await prepareFamilyBenefitsDocument(request(prepare()), collectionId)).status).toBe(403); expect(state.signed).not.toHaveBeenCalled();
  });
  it("reserves exact metadata and returns a minimal signed upload response", async () => {
    const response = await prepareFamilyBenefitsDocument(request(prepare()), collectionId);
    expect(response.status).toBe(200);
    const data = await response.json(); expect(data.document.id).toBe(docId); expect(data.document.created_by).toBeUndefined(); expect(data.document.case_id).toBeUndefined();
    expect(state.commands[0].p_action).toBe("prepare"); expect(state.signed).toHaveBeenCalledWith(`${org}/${caseId}/${docId}`, { upsert: false });
  });
  it("does not return a signed URL when authority changes while issuing it", async () => {
    state.deniedOnSignedUrl = true;
    const response = await prepareFamilyBenefitsDocument(request(prepare()), collectionId);
    expect(response.status).toBe(403); expect(await response.text()).not.toContain("synthetic-token");
  });
  it("rejects invalid filenames, oversized files and malformed hashes", async () => {
    for (const value of [{ ...prepare(), filename: "../bank.pdf" }, { ...prepare(), size_bytes: 16 * 1024 * 1024 }, { ...prepare(), sha256: "bad" }, { ...prepare(), size_bytes: "12" }]) {
      expect((await prepareFamilyBenefitsDocument(request(value), collectionId)).status).toBe(400);
    }
    expect(state.commands).toHaveLength(0);
  });
  it("resumes only the exact original immutable file", async () => {
    const response = await prepareFamilyBenefitsDocument(request({ ...prepare(), resume_document_id: docId }), collectionId);
    expect(response.status).toBe(200); expect(state.commands).toHaveLength(0);
    expect((await prepareFamilyBenefitsDocument(request({ ...prepare(), filename: "different.pdf", resume_document_id: docId }), collectionId)).status).toBe(409);
  });
  it("rejects foreign document owners and storage paths", async () => {
    state.doc.created_by = collectionId;
    expect((await finalizeFamilyBenefitsDocument(finalize(), collectionId, docId)).status).toBe(503);
    state.doc.created_by = userId; state.doc.storage_path = `wrong/${caseId}/${docId}`;
    expect((await finalizeFamilyBenefitsDocument(finalize(), collectionId, docId)).status).toBe(503);
    expect(state.downloads).toBe(0);
  });
  it("verifies downloaded bytes before service attestation and caller finalization", async () => {
    const response = await finalizeFamilyBenefitsDocument(finalize(), collectionId, docId);
    expect(response.status).toBe(200); expect(state.attestations).toBe(1); expect(state.commands[0].p_action).toBe("finalize");
    expect(await response.json()).toMatchObject({ document: { status: "ready" }, upload: null });
  });
  it("blocks altered checksum and MIME bytes without attestation", async () => {
    state.bytes = new Uint8Array(Buffer.from("not a PDF______"));
    expect((await finalizeFamilyBenefitsDocument(finalize(), collectionId, docId)).status).toBe(409);
    expect(state.attestations).toBe(0); expect(state.commands).toHaveLength(0);
  });
  it("blocks link revocation or object replacement during download", async () => {
    state.linkRevokedOnDownload = true;
    expect((await finalizeFamilyBenefitsDocument(finalize(), collectionId, docId)).status).toBe(403);
    expect(state.attestations).toBe(0);
    state.denied = false; state.linkRevokedOnDownload = false; state.changedObjectOnDownload = true;
    expect((await finalizeFamilyBenefitsDocument(finalize(), collectionId, docId)).status).toBe(409);
    expect(state.attestations).toBe(0);
  });
  it("replays a ready upload via caller RPC without attempting to attest immutable bytes again", async () => {
    state.doc.status = "ready";
    expect((await finalizeFamilyBenefitsDocument(finalize(), collectionId, docId)).status).toBe(200);
    expect(state.attestations).toBe(0); expect(state.downloads).toBe(0); expect(state.commands[0].p_action).toBe("finalize");
  });
  it("does not let a family user assign collection requests", async () => {
    expect((await commandBenefitsCollection(request({ action: "revoke", payload: { collection_id: collectionId }, expected_revision: 1, request_id: commandId }), caseId)).status).toBe(403);
  });
});
