import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/operations/auth", () => ({ requireOperationsActor: vi.fn(), revalidateOperationsActor: vi.fn(), actorCanAccessFacility: vi.fn() }));
const logError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/observability/logger", () => ({ logError }));

import { GET as LIST, POST as PREPARE } from "./route";
import { POST as UPLOADED } from "./[id]/uploaded/route";
import { POST as FINALIZE } from "./[id]/finalize/route";
import { POST as FAIL } from "./[id]/fail/route";
import { GET as DOWNLOAD } from "./[id]/download/route";
import { actorCanAccessFacility, requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";

const rpc = vi.fn();
const maybeSingle = vi.fn();
const order = vi.fn();
const fromCalls: string[] = [];
const selects: string[] = [];
const from = vi.fn((table: string) => {
  fromCalls.push(table);
  const query: Record<string, unknown> = {};
  for (const method of ["eq", "is", "not"]) query[method] = vi.fn(() => query);
  query.select = vi.fn((columns: string) => { selects.push(columns); return query; });
  query.order = order;
  query.maybeSingle = maybeSingle;
  return query;
});
const createSignedUploadUrl = vi.fn();
const createSignedUrl = vi.fn();
const storageFrom = vi.fn(() => ({ createSignedUploadUrl, createSignedUrl }));
const actor = { id: "actor", organizationId: "org", appRole: "maintenance_role", currentActor: { client: { rpc, from, storage: { from: storageFrom } } } };
const facilityId = "33333333-3333-4333-8333-333333333333";
const receiptId = "77777777-7777-4777-8777-777777777777";
const evidenceId = "88888888-8888-4888-8888-888888888888";
const key = "evidence:2026-09-10:0001";
const revision = "a".repeat(64);
const path = `${facilityId}/${evidenceId}/panel.jpg`;
const photo = { kind: "photo", rule_label: "Panel photo", filename: "panel.jpg", mime: "image/jpeg", size_bytes: 1024 };
const post = (body: unknown) => new Request("https://local.test/evidence", { method: "POST", body: JSON.stringify(body) }) as never;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const receiptRow = { id: receiptId, organization_id: "org", facility_id: facilityId };
const satisfaction = { receipt_evidence_status: "complete", unmet: [], satisfied_event_id: "ev-sat", occurrence: { id: "occ", status: "completed", execution_state: "completed" } };
const evidenceRow = { id: evidenceId, organization_id: "org", facility_id: facilityId, state: "prepared", uploaded_by: "actor", object_path: path, evidence_kind: "photo" };
const prepared = { evidence: { id: evidenceId, state: "prepared", uploaded_by: "actor", object_path: path, request_hash: "h".repeat(64) }, event: { id: "ev1", event_kind: "prepared", request_hash: "h".repeat(64) }, replayed: false };

beforeEach(() => {
  vi.clearAllMocks();
  fromCalls.length = 0;
  selects.length = 0;
  vi.mocked(requireOperationsActor).mockResolvedValue({ actor } as never);
  vi.mocked(revalidateOperationsActor).mockResolvedValue({ actor } as never);
  vi.mocked(actorCanAccessFacility).mockResolvedValue(true);
  maybeSingle.mockResolvedValue({ data: receiptRow, error: null });
  order.mockResolvedValue({ data: [], error: null });
  createSignedUploadUrl.mockResolvedValue({ data: { signedUrl: "https://storage.test/upload", token: "tok", path }, error: null });
  createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://storage.test/download" }, error: null });
});

describe("prepare evidence", () => {
  it("refuses a malformed payload before any read", async () => {
    const response = await PREPARE(post({ receipt_id: receiptId, request_key: key, payload: { ...photo, mime: "text/html" } }));
    expect(response.status).toBe(400);
    expect((await response.json()).outcome).toBe("validation");
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("treats a missing, foreign or ungranted receipt as missing before the command", async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect((await PREPARE(post({ receipt_id: receiptId, request_key: key, payload: photo }))).status).toBe(404);
    maybeSingle.mockResolvedValueOnce({ data: { ...receiptRow, organization_id: "other" }, error: null });
    expect((await PREPARE(post({ receipt_id: receiptId, request_key: key, payload: photo }))).status).toBe(404);
    vi.mocked(actorCanAccessFacility).mockResolvedValueOnce(false);
    const response = await PREPARE(post({ receipt_id: receiptId, request_key: key, payload: photo }));
    expect(await response.json()).toEqual({ error: "Receipt not found", outcome: "missing" });
    expect(rpc).not.toHaveBeenCalled();
    expect(revalidateOperationsActor).not.toHaveBeenCalled();
  });

  it("stops before the command when the actor no longer revalidates", async () => {
    vi.mocked(revalidateOperationsActor).mockResolvedValue({ response: new Response("{}", { status: 401 }) } as never);
    expect((await PREPARE(post({ receipt_id: receiptId, request_key: key, payload: photo }))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("forwards exactly the receipt, key and payload, then asks the session's Storage for a signed upload URL on the owned path", async () => {
    rpc.mockResolvedValue({ data: prepared, error: null });
    const response = await PREPARE(post({ receipt_id: receiptId, request_key: key, payload: photo }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("prepare_operation_evidence_review", { p_receipt: receiptId, p_request_key: key, p_payload: photo });
    expect(storageFrom).toHaveBeenCalledWith("operation-evidence");
    expect(createSignedUploadUrl).toHaveBeenCalledExactlyOnceWith(path);
    expect(await response.json()).toEqual({
      outcome: "receipt",
      evidence: { id: evidenceId, state: "prepared", uploaded_by: "actor", object_path: path },
      event: { id: "ev1", event_kind: "prepared" },
      replayed: false,
      satisfaction: null,
      upload: { path, token: "tok", signedUrl: "https://storage.test/upload" },
    });
  });

  it("returns the satisfaction outcome when a linked record finalizes at preparation", async () => {
    rpc.mockResolvedValue({ data: { ...prepared, evidence: { id: evidenceId, state: "finalized", uploaded_by: "actor", object_path: null, evidence_kind: "linked_record" }, satisfaction }, error: null });
    const response = await PREPARE(post({ receipt_id: receiptId, request_key: key, payload: { kind: "linked_record", linked_table: "facility_documents", linked_record_id: receiptId } }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.satisfaction).toEqual(satisfaction);
    expect(body.upload).toBeNull();
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("keeps the prepared row and reports a retryable upload URL failure without a service-role call", async () => {
    rpc.mockResolvedValue({ data: prepared, error: null });
    createSignedUploadUrl.mockResolvedValue({ data: null, error: { message: "new row violates row-level security policy" } });
    const response = await PREPARE(post({ receipt_id: receiptId, request_key: key, payload: photo }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.upload).toBeNull();
    expect(body.upload_error).toBe("Upload URL unavailable; retry");
    expect(body.evidence.id).toBe(evidenceId);
    expect(logError).toHaveBeenCalled();
  });

  it("returns no upload for a linked record or an already finalized replay", async () => {
    rpc.mockResolvedValue({ data: { ...prepared, evidence: { id: evidenceId, state: "finalized", uploaded_by: "actor", object_path: null, evidence_kind: "linked_record" }, replayed: true }, error: null });
    const response = await PREPARE(post({ receipt_id: receiptId, request_key: key, payload: { kind: "linked_record", linked_table: "facility_documents", linked_record_id: receiptId } }));
    const body = await response.json();
    expect(body.upload).toBeNull();
    expect(body.replayed).toBe(true);
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("maps a duplicate-bytes refusal to a conflict naming the existing evidence and hides a denial", async () => {
    const existing = "99999999-9999-4999-8999-999999999999";
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "Evidence already finalized for these bytes", details: `evidence_id=${existing}` } });
    let response = await PREPARE(post({ receipt_id: receiptId, request_key: key, payload: photo }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Evidence already finalized for these bytes", outcome: "conflict", existing_evidence_id: existing });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "Operation unavailable" } });
    response = await PREPARE(post({ receipt_id: receiptId, request_key: key, payload: photo }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Operation unavailable", outcome: "denied" });
  });

  it("does not echo unexpected database detail", async () => {
    const sentinel = "relation public.operation_evidence deadlock detected";
    rpc.mockResolvedValue({ data: null, error: { code: "40P01", message: sentinel } });
    const response = await PREPARE(post({ receipt_id: receiptId, request_key: key, payload: photo }));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.outcome).toBe("uncertain");
    expect(JSON.stringify(body)).not.toContain(sentinel);
    expect(logError).toHaveBeenCalled();
  });
});

describe("evidence commands", () => {
  beforeEach(() => {
    maybeSingle.mockResolvedValue({ data: evidenceRow, error: null });
  });

  it("marks uploaded with exactly the evidence id and key", async () => {
    rpc.mockResolvedValue({ data: { ...prepared, evidence: { ...prepared.evidence, state: "uploaded" } }, error: null });
    const response = await UPLOADED(post({ request_key: key }), params(evidenceId));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("mark_operation_evidence_uploaded_review", { p_evidence: evidenceId, p_request_key: key });
    expect((await response.json()).evidence.object_path).toBe(path);
  });

  it("finalizes with the receipt revision the client read and returns the satisfaction outcome", async () => {
    rpc.mockResolvedValue({ data: { ...prepared, evidence: { ...prepared.evidence, state: "finalized" }, satisfaction }, error: null });
    const response = await FINALIZE(post({ request_key: key, expected_receipt_revision: revision }), params(evidenceId));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("finalize_operation_evidence_review", { p_evidence: evidenceId, p_request_key: key, p_expected_receipt_revision: revision, p_payload: {} });
    const body = await response.json();
    expect(body.satisfaction).toEqual(satisfaction);
    // A finalized row carries no object path; downloads go through the signed-URL route.
    expect(body.evidence).toEqual({ id: evidenceId, state: "finalized", uploaded_by: "actor" });
  });

  it("surfaces a stale receipt revision and a foreign uploader as conflicts", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "Receipt changed since it was read" } });
    let response = await FINALIZE(post({ request_key: key, expected_receipt_revision: revision }), params(evidenceId));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Receipt changed since it was read", outcome: "conflict" });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "Evidence belongs to another uploader" } });
    response = await UPLOADED(post({ request_key: key }), params(evidenceId));
    expect(response.status).toBe(409);
  });

  it("fails an upload with a reason and passes an object-mismatch validation through", async () => {
    rpc.mockResolvedValueOnce({ data: { ...prepared, evidence: { ...prepared.evidence, state: "failed" } }, error: null });
    const response = await FAIL(post({ request_key: key, payload: { reason: "Camera upload timed out" } }), params(evidenceId));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("fail_operation_evidence_review", { p_evidence: evidenceId, p_request_key: key, p_payload: { reason: "Camera upload timed out" } });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "Uploaded object does not match the prepared evidence" } });
    const mismatch = await UPLOADED(post({ request_key: key }), params(evidenceId));
    expect(mismatch.status).toBe(400);
    expect(await mismatch.json()).toEqual({ error: "Uploaded object does not match the prepared evidence", outcome: "validation" });
  });

  it("treats a missing, foreign or ungranted evidence row as missing before revalidation and the command", async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect((await FINALIZE(post({ request_key: key, expected_receipt_revision: revision }), params(evidenceId))).status).toBe(404);
    vi.mocked(actorCanAccessFacility).mockResolvedValueOnce(false);
    expect((await FAIL(post({ request_key: key, payload: { reason: "x" } }), params(evidenceId))).status).toBe(404);
    expect((await UPLOADED(post({ request_key: key }), params("not-a-uuid"))).status).toBe(404);
    maybeSingle.mockResolvedValueOnce({ data: null, error: { message: "read failed" } });
    expect((await UPLOADED(post({ request_key: key }), params(evidenceId))).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
    expect(revalidateOperationsActor).not.toHaveBeenCalled();
  });

  it("refuses a malformed body before any read", async () => {
    expect((await FINALIZE(post({ request_key: key }), params(evidenceId))).status).toBe(400);
    expect((await FAIL(new Request("https://local.test/fail", { method: "POST", body: "{" }) as never, params(evidenceId))).status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });
});

describe("evidence reads", () => {
  it("requires a receipt id and gates the site before listing", async () => {
    expect((await LIST(new NextRequest("https://local.test/evidence") as never)).status).toBe(400);
    vi.mocked(actorCanAccessFacility).mockResolvedValueOnce(false);
    expect((await LIST(new NextRequest(`https://local.test/evidence?receipt_id=${receiptId}`) as never)).status).toBe(404);
    expect(fromCalls).toEqual(["operation_execution_receipts"]);
  });

  it("lists finalized rows and the caller's own in-flight rows, never another uploader's path", async () => {
    order.mockResolvedValue({
      data: [
        { id: "e-final", state: "finalized", uploaded_by: "other", object_path: "f/e-final/a.pdf", request_hash: "h" },
        { id: "e-mine", state: "uploaded", uploaded_by: "actor", object_path: "f/e-mine/b.jpg", request_hash: "h" },
        { id: "e-theirs", state: "prepared", uploaded_by: "other", object_path: "f/e-theirs/c.jpg", request_hash: "h" },
        { id: "e-failed", state: "failed", uploaded_by: "other", object_path: "f/e-failed/d.jpg", request_hash: "h" },
      ],
      error: null,
    });
    const response = await LIST(new NextRequest(`https://local.test/evidence?receipt_id=${receiptId}`) as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      evidence: [
        { id: "e-final", state: "finalized", uploaded_by: "other" },
        { id: "e-mine", state: "uploaded", uploaded_by: "actor", object_path: "f/e-mine/b.jpg" },
      ],
    });
    expect(fromCalls).toEqual(["operation_execution_receipts", "operation_evidence"]);
  });

  it("signs a download only for finalized object evidence through the session client", async () => {
    maybeSingle.mockResolvedValueOnce({ data: { ...evidenceRow, state: "finalized" }, error: null });
    const response = await DOWNLOAD(new NextRequest("https://local.test/download") as never, params(evidenceId));
    expect(response.status).toBe(200);
    expect(createSignedUrl).toHaveBeenCalledExactlyOnceWith(path, 60, { download: true });
    expect(await response.json()).toEqual({ outcome: "receipt", download: { signedUrl: "https://storage.test/download", expires_in: 60 } });
    maybeSingle.mockResolvedValueOnce({ data: evidenceRow, error: null });
    const unfinished = await DOWNLOAD(new NextRequest("https://local.test/download") as never, params(evidenceId));
    expect(unfinished.status).toBe(409);
    maybeSingle.mockResolvedValueOnce({ data: { ...evidenceRow, state: "finalized", evidence_kind: "linked_record", object_path: null }, error: null });
    expect((await DOWNLOAD(new NextRequest("https://local.test/download") as never, params(evidenceId))).status).toBe(409);
    maybeSingle.mockResolvedValueOnce({ data: { ...evidenceRow, state: "finalized" }, error: null });
    createSignedUrl.mockResolvedValueOnce({ data: null, error: { message: "Object not found" } });
    const refused = await DOWNLOAD(new NextRequest("https://local.test/download") as never, params(evidenceId));
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "Operation unavailable", outcome: "denied" });
  });

  it("hides a missing or ungranted evidence row from the download route", async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect((await DOWNLOAD(new NextRequest("https://local.test/download") as never, params(evidenceId))).status).toBe(404);
    vi.mocked(actorCanAccessFacility).mockResolvedValueOnce(false);
    expect((await DOWNLOAD(new NextRequest("https://local.test/download") as never, params(evidenceId))).status).toBe(404);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("revalidates the actor before signing a download and signs with the revalidated session", async () => {
    maybeSingle.mockResolvedValue({ data: { ...evidenceRow, state: "finalized" }, error: null });
    vi.mocked(revalidateOperationsActor).mockResolvedValueOnce({ response: new Response("{}", { status: 401 }) } as never);
    expect((await DOWNLOAD(new NextRequest("https://local.test/download") as never, params(evidenceId))).status).toBe(401);
    expect(createSignedUrl).not.toHaveBeenCalled();
    const revalidatedSign = vi.fn().mockResolvedValue({ data: { signedUrl: "https://storage.test/revalidated" }, error: null });
    vi.mocked(revalidateOperationsActor).mockResolvedValueOnce({ actor: { ...actor, currentActor: { client: { rpc, from, storage: { from: vi.fn(() => ({ createSignedUrl: revalidatedSign })) } } } } } as never);
    const response = await DOWNLOAD(new NextRequest("https://local.test/download") as never, params(evidenceId));
    expect(response.status).toBe(200);
    expect(revalidatedSign).toHaveBeenCalledExactlyOnceWith(path, 60, { download: true });
    expect(createSignedUrl).not.toHaveBeenCalled();
  });
});
