import { PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { deriveRequestKey } from "@/lib/document-intake/server/request-key";
import { sha256Hex } from "@/lib/document-intake/server/bytes";

const mocks = vi.hoisted(() => ({ requireActor: vi.fn(), revalidateActor: vi.fn(), logError: vi.fn() }));

vi.mock("@/lib/auth/current-api-actor", () => ({
  requireCurrentApiActor: mocks.requireActor,
  revalidateCurrentApiActor: mocks.revalidateActor,
}));
vi.mock("@/lib/observability/logger", () => ({ logError: mocks.logError }));

import { POST as fileRoute } from "./items/[itemId]/file/route";
import { POST as splitRoute } from "./items/[itemId]/split/route";
import { POST as finalizeRoute } from "./uploads/[itemId]/finalize/route";

const orgId = "1fef9308-22f0-432d-9a0e-69849076b11a";
const facilityId = "477e2308-f90c-4281-877c-61e81593b3bb";
const actorId = "8ac58bac-bd8b-45b2-95c2-19aa6ff2cf92";
const itemId = "122d681e-2fa7-4b40-a480-832954d43a34";
const filingId = "a4875598-cb64-4279-9d23-46a728c6dafd";
const residentId = "5b0c3f39-6a55-4b43-9f8e-0c0b8a1d2e33";
const revision = "d4bf39e9-97d6-431d-86c8-8a8518fc6a84";
// Synthetic low-entropy request keys (gitleaks reads random ones as secrets).
const requestKey = "00000000-0000-4000-8000-000000000021";

const PERSON_RPCS = [
  "document_intake_prepare_upload",
  "document_intake_finalize_upload",
  "document_intake_command",
  "document_intake_prepare_split",
  "document_intake_finalize_split",
  "document_intake_prepare_filing",
  "document_intake_complete_filing",
  "document_intake_abandon_filing",
  "document_intake_correct_filing",
  "document_intake_operations_summary",
];
const SERVICE_RPCS = ["document_intake_attest_source", "document_intake_reject_source", "document_intake_declare_split_child", "document_intake_attest_filing_object"];

type Row = Record<string, unknown>;
type RpcHandler = (name: string, args: Row) => { data?: unknown; error?: { code?: string; message?: string } | null };

/** Chainable PostgREST stand-in: filters by .eq on the given rows. */
function tables(rows: Record<string, Row[]>) {
  return vi.fn((table: string) => {
    const filters: [string, unknown][] = [];
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => { filters.push([column, value]); return query; },
      is: () => query,
      order: () => query,
      maybeSingle: async () => ({
        data: (rows[table] ?? []).find((row) => filters.every(([column, value]) => row[column] === value)) ?? null,
        error: null,
      }),
    };
    return query;
  });
}

type StoredObjects = Map<string, Uint8Array>;

type StorageFault = (key: string) => { message: string; statusCode: string } | null;

function storage(objects: StoredObjects, options: { uploadError?: StorageFault; downloadError?: StorageFault } = {}) {
  const upload = vi.fn(async (bucket: string, path: string, bytes: Uint8Array) => {
    const key = `${bucket}/${path}`;
    const forced = options.uploadError?.(key);
    if (forced) return { data: null, error: forced };
    if (objects.has(key)) return { data: null, error: { message: "The resource already exists", statusCode: "409" } };
    objects.set(key, bytes);
    return { data: { path }, error: null };
  });
  const from = vi.fn((bucket: string) => ({
    download: async (path: string) => {
      const fault = options.downloadError?.(`${bucket}/${path}`);
      if (fault) return { data: null, error: fault };
      const bytes = objects.get(`${bucket}/${path}`);
      return bytes ? { data: new Blob([Buffer.from(bytes)]), error: null } : { data: null, error: { message: "Object not found", statusCode: "404" } };
    },
    upload: (path: string, bytes: Uint8Array) => upload(bucket, path, bytes),
    createSignedUploadUrl: async (path: string) => ({ data: { path, token: "t", signedUrl: `https://storage.test/${path}` }, error: null }),
  }));
  return { from, upload };
}

function setup(options: { clientRpc: RpcHandler; adminRpc?: RpcHandler; clientRows?: Record<string, Row[]>; adminRows?: Record<string, Row[]>; objects?: StoredObjects; uploadError?: StorageFault; downloadError?: StorageFault }) {
  const objects = options.objects ?? new Map();
  const clientRpc = vi.fn(async (name: string, args: Row = {}) => {
    const result = options.clientRpc(name, args);
    return { data: result.data ?? null, error: result.error ?? null };
  });
  const adminRpc = vi.fn(async (name: string, args: Row = {}) => {
    const result = options.adminRpc?.(name, args) ?? {};
    return { data: result.data ?? null, error: result.error ?? null };
  });
  const store = storage(objects, { uploadError: options.uploadError, downloadError: options.downloadError });
  const actor = {
    id: actorId,
    organizationId: orgId,
    appRole: "facility_admin",
    client: { rpc: clientRpc, from: tables(options.clientRows ?? {}), auth: {}, storage: { from: vi.fn(() => { throw new Error("user client must not touch storage"); }) } },
    admin: { rpc: adminRpc, from: tables(options.adminRows ?? {}), storage: { from: store.from } },
  };
  mocks.requireActor.mockResolvedValue({ actor });
  mocks.revalidateActor.mockResolvedValue({ actor });
  return { clientRpc, adminRpc, upload: store.upload, objects };
}

function called(rpc: ReturnType<typeof vi.fn>) {
  return rpc.mock.calls.map(([name]) => name as string);
}

function expectPrincipals(clientRpc: ReturnType<typeof vi.fn>, adminRpc: ReturnType<typeof vi.fn>) {
  for (const name of called(clientRpc)) expect(PERSON_RPCS).toContain(name);
  for (const name of called(adminRpc)) expect(SERVICE_RPCS).toContain(name);
}

function post(body: unknown) {
  return new Request("http://localhost/api", { method: "POST", body: JSON.stringify(body) });
}

const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });

// ── Filing ──────────────────────────────────────────────────────────────────

const sourcePath = `${orgId}/${facilityId}/${itemId}/original`;
const destinationPath = `intake/${facilityId}/${residentId}/${filingId}.pdf`;
const original = new Uint8Array(Buffer.from("%PDF-1.7\nfiling fixture"));
const originalSha = sha256Hex(original);

const fileBody = {
  request_key: requestKey,
  expected_revision: revision,
  catalog_code: "form_1823",
  subject_id: residentId,
  title: "Form 1823",
  document_date: "2026-09-20",
};

function filingRpcs(state: { filing: string }) {
  const clientRpc: RpcHandler = (name) => {
    if (name === "document_intake_prepare_filing") {
      return { data: { filing_id: filingId, bucket: "resident-documents", path: destinationPath, source_path: sourcePath, sha256: originalSha, mime: "application/pdf" } };
    }
    if (name === "document_intake_complete_filing") {
      state.filing = "filed";
      return { data: { filing: { id: filingId, item_id: itemId, facility_id: facilityId, subject_id: residentId, destination_kind: "resident_document", destination_record_id: "0c9f7f58-6b0c-4c0e-8f65-0f1d0a8f1b21", state: "filed" } } };
    }
    throw new Error(`unexpected client rpc ${name}`);
  };
  const adminRpc: RpcHandler = (name) => {
    if (name === "document_intake_attest_filing_object") { state.filing = "attested"; return {}; }
    throw new Error(`unexpected admin rpc ${name}`);
  };
  return { clientRpc, adminRpc };
}

describe("POST /api/admin/document-intake/items/[itemId]/file", () => {
  beforeEach(() => vi.resetAllMocks());

  it("prepares and completes as the person, copies and attests as the service", async () => {
    const state = { filing: "preparing" };
    const objects: StoredObjects = new Map([[`document-intake/${sourcePath}`, original]]);
    const { clientRpc, adminRpc } = setup({
      ...filingRpcs(state),
      adminRows: { document_intake_filings: [{ id: filingId, organization_id: orgId, get state() { return state.filing; } }] },
      objects,
    });

    const response = await fileRoute(post(fileBody), params({ itemId }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.href).toBe(`/admin/residents/${residentId}/documents`);
    expect(body.filing.id).toBe(filingId);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(called(clientRpc)).toEqual(["document_intake_prepare_filing", "document_intake_complete_filing"]);
    expect(called(adminRpc)).toEqual(["document_intake_attest_filing_object"]);
    expectPrincipals(clientRpc, adminRpc);
    expect(objects.get(`resident-documents/${destinationPath}`)).toEqual(original);
    expect(clientRpc.mock.calls[0]![1]).toMatchObject({
      p_item: itemId,
      p_request_key: requestKey,
      p_expected_revision: revision,
      p_destination: { catalog_code: "form_1823", subject_id: residentId, requirement_id: null, title: "Form 1823", document_date: "2026-09-20", expiration_date: null },
    });
    expect(clientRpc.mock.calls[1]![1]).toEqual({ p_filing: filingId, p_request_key: deriveRequestKey(requestKey, "complete") });
  });

  it("resumes when the destination object already exists with the same bytes", async () => {
    const state = { filing: "preparing" };
    const objects: StoredObjects = new Map([
      [`document-intake/${sourcePath}`, original],
      [`resident-documents/${destinationPath}`, new Uint8Array(original)],
    ]);
    const { clientRpc, adminRpc, upload } = setup({
      ...filingRpcs(state),
      adminRows: { document_intake_filings: [{ id: filingId, organization_id: orgId, get state() { return state.filing; } }] },
      objects,
    });

    const response = await fileRoute(post(fileBody), params({ itemId }));

    expect(response.status).toBe(200);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(called(adminRpc)).toEqual(["document_intake_attest_filing_object"]);
    expect(called(clientRpc)).toContain("document_intake_complete_filing");
  });

  it("refuses a different file already at the destination and never completes", async () => {
    const state = { filing: "preparing" };
    const objects: StoredObjects = new Map([
      [`document-intake/${sourcePath}`, original],
      [`resident-documents/${destinationPath}`, new Uint8Array(Buffer.from("%PDF-1.7\nsomething else"))],
    ]);
    const { clientRpc, adminRpc } = setup({
      ...filingRpcs(state),
      adminRows: { document_intake_filings: [{ id: filingId, organization_id: orgId, get state() { return state.filing; } }] },
      objects,
    });

    const response = await fileRoute(post(fileBody), params({ itemId }));
    expect(response.status).toBe(409);
    expect((await response.json()).filing_id).toBe(filingId);
    expect(called(adminRpc)).toEqual([]);
    expect(called(clientRpc)).not.toContain("document_intake_complete_filing");
  });

  it("answers 409 when the downloaded original does not match its checksum, and never attests or completes", async () => {
    const state = { filing: "preparing" };
    const objects: StoredObjects = new Map([[`document-intake/${sourcePath}`, new Uint8Array(Buffer.from("%PDF-1.7\ntampered"))]]);
    const { clientRpc, adminRpc, upload } = setup({
      ...filingRpcs(state),
      adminRows: { document_intake_filings: [{ id: filingId, organization_id: orgId, get state() { return state.filing; } }] },
      objects,
    });

    const response = await fileRoute(post(fileBody), params({ itemId }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.outcome).toBe("conflict");
    expect(upload).not.toHaveBeenCalled();
    expect(called(adminRpc)).toEqual([]);
    expect(called(clientRpc)).toEqual(["document_intake_prepare_filing"]);
  });

  it("a retry after completion replays straight to complete without copying again", async () => {
    const state = { filing: "filed" };
    const { clientRpc, adminRpc, upload } = setup({
      ...filingRpcs(state),
      adminRows: { document_intake_filings: [{ id: filingId, organization_id: orgId, state: "filed" }] },
    });

    const response = await fileRoute(post(fileBody), params({ itemId }));

    expect(response.status).toBe(200);
    expect(upload).not.toHaveBeenCalled();
    expect(called(adminRpc)).toEqual([]);
    expect(called(clientRpc)).toEqual(["document_intake_prepare_filing", "document_intake_complete_filing"]);
  });

  it("returns 503 retryable with the filing id when the copy fails after prepare", async () => {
    const state = { filing: "preparing" };
    const { clientRpc } = setup({
      ...filingRpcs(state),
      adminRows: { document_intake_filings: [{ id: filingId, organization_id: orgId, state: "preparing" }] },
      objects: new Map([[`document-intake/${sourcePath}`, original]]),
      uploadError: () => ({ message: "Gateway timeout", statusCode: "504" }),
    });

    const response = await fileRoute(post(fileBody), params({ itemId }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ outcome: "retryable", filing_id: filingId });
    expect(called(clientRpc)).not.toContain("document_intake_abandon_filing");
  });
});

// ── Upload finalize ─────────────────────────────────────────────────────────

describe("POST /api/admin/document-intake/uploads/[itemId]/finalize", () => {
  beforeEach(() => vi.resetAllMocks());

  const uploadRow = (bytes: Uint8Array, extra: Row = {}) => ({
    id: itemId,
    organization_id: orgId,
    facility_id: facilityId,
    status: "receiving",
    channel: "upload",
    parent_item_id: null,
    storage_path: sourcePath,
    declared_mime: "application/pdf",
    declared_size_bytes: bytes.byteLength,
    declared_sha256: sha256Hex(bytes),
    verified_mime: null,
    verified_sha256: null,
    page_count: null,
    created_by: actorId,
    ...extra,
  });

  it("verifies bytes, attests as the service and finalizes as the person", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.addPage();
    const bytes = await doc.save();
    const { clientRpc, adminRpc } = setup({
      clientRpc: (name) => {
        if (name === "document_intake_finalize_upload") return { data: { item: { id: itemId, organization_id: orgId, status: "queued", revision }, possible_duplicate_of: null } };
        throw new Error(`unexpected client rpc ${name}`);
      },
      adminRpc: (name) => (name === "document_intake_attest_source" ? {} : (() => { throw new Error(name); })()),
      clientRows: { document_intake_items: [{ id: itemId }] },
      adminRows: { document_intake_items: [uploadRow(bytes)] },
      objects: new Map([[`document-intake/${sourcePath}`, bytes]]),
    });

    const response = await finalizeRoute(post({ request_key: requestKey }), params({ itemId }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ item: { id: itemId, status: "queued" }, possible_duplicate_of: null });
    expectPrincipals(clientRpc, adminRpc);
    expect(adminRpc.mock.calls[0]).toEqual(["document_intake_attest_source", {
      p_item: itemId, p_object_id: null, p_size: bytes.byteLength, p_mime: "application/pdf", p_sha256: sha256Hex(bytes), p_page_count: 2,
    }]);
  });

  it("refuses bytes whose format does not match the declaration, rejects the item and attests nothing", async () => {
    const bytes = new Uint8Array(Buffer.from("<html>not a pdf</html>"));
    const { clientRpc, adminRpc } = setup({
      clientRpc: () => { throw new Error("must not finalize"); },
      adminRpc: (name) => (name === "document_intake_reject_source" ? { data: { id: itemId, status: "excluded" } } : (() => { throw new Error(name); })()),
      clientRows: { document_intake_items: [{ id: itemId }] },
      adminRows: { document_intake_items: [uploadRow(bytes)] },
      objects: new Map([[`document-intake/${sourcePath}`, bytes]]),
    });

    const response = await finalizeRoute(post({ request_key: requestKey }), params({ itemId }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ outcome: "conflict" });
    expect(adminRpc.mock.calls).toEqual([["document_intake_reject_source", { p_item: itemId, p_code: "format_mismatch" }]]);
    expect(called(clientRpc)).toEqual([]);
  });

  it("rejects an encrypted PDF with its own code and answers 400 unsupported", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.context.trailerInfo.Encrypt = doc.context.obj({});
    const bytes = await doc.save();
    const { adminRpc } = setup({
      clientRpc: () => { throw new Error("must not finalize"); },
      adminRpc: () => ({}),
      clientRows: { document_intake_items: [{ id: itemId }] },
      adminRows: { document_intake_items: [uploadRow(bytes)] },
      objects: new Map([[`document-intake/${sourcePath}`, bytes]]),
    });

    const response = await finalizeRoute(post({ request_key: requestKey }), params({ itemId }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ outcome: "unsupported" });
    expect(adminRpc.mock.calls).toEqual([["document_intake_reject_source", { p_item: itemId, p_code: "encrypted_pdf" }]]);
  });

  it("does not reject the item when the download itself fails (503 retryable)", async () => {
    const bytes = new Uint8Array(Buffer.from("%PDF-1.7\nx"));
    const { clientRpc, adminRpc } = setup({
      clientRpc: () => { throw new Error("must not finalize"); },
      adminRpc: () => { throw new Error("must not call a service rpc"); },
      clientRows: { document_intake_items: [{ id: itemId }] },
      adminRows: { document_intake_items: [uploadRow(bytes)] },
      objects: new Map([[`document-intake/${sourcePath}`, bytes]]),
      downloadError: () => ({ message: "Bad gateway", statusCode: "502" }),
    });

    const response = await finalizeRoute(post({ request_key: requestKey }), params({ itemId }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ outcome: "retryable" });
    expect(called(adminRpc)).toEqual([]);
    expect(called(clientRpc)).toEqual([]);
  });

  it("is 404 for an item the person can neither see nor uploaded", async () => {
    const bytes = new Uint8Array(Buffer.from("%PDF-1.7\nx"));
    setup({
      clientRpc: () => { throw new Error("must not finalize"); },
      adminRows: { document_intake_items: [uploadRow(bytes, { created_by: "11111111-1111-4111-8111-111111111111" })] },
    });
    const response = await finalizeRoute(post({ request_key: requestKey }), params({ itemId }));
    expect(response.status).toBe(404);
  });
});

// ── Split ───────────────────────────────────────────────────────────────────

describe("POST /api/admin/document-intake/items/[itemId]/split", () => {
  beforeEach(() => vi.resetAllMocks());

  it("cuts real child PDFs, declares and attests them as the service, finalizes with a derived key", async () => {
    const doc = await PDFDocument.create();
    for (const size of [300, 400, 500]) doc.addPage([size, size]);
    const parentBytes = await doc.save();
    const childA = "7b7c2d5e-1f7a-4c3b-9c1e-2a7b9d3e4f51";
    const childB = "8c8d3e6f-2a8b-4d4c-8d2f-3b8c0e4f5a62";
    const parentRevision = "0f3e2d1c-4b5a-4968-8776-a5b4c3d2e1f0";
    const childRow = (id: string, n: number) => ({
      id, organization_id: orgId, facility_id: facilityId, status: "receiving", channel: "split", parent_item_id: itemId,
      storage_path: `${orgId}/${facilityId}/${itemId}/split-${n}`, declared_mime: "application/pdf", declared_size_bytes: 1,
      declared_sha256: "0".repeat(64), verified_mime: null, verified_sha256: null, page_count: null, created_by: actorId,
    });
    const objects: StoredObjects = new Map([[`document-intake/${sourcePath}`, parentBytes]]);
    const { clientRpc, adminRpc } = setup({
      clientRpc: (name) => {
        if (name === "document_intake_prepare_split") {
          return { data: { parent_revision: parentRevision, children: [
            { item_id: childA, path: `${orgId}/${facilityId}/${itemId}/split-1`, pages: [3, 1] },
            { item_id: childB, path: `${orgId}/${facilityId}/${itemId}/split-2`, pages: [2] },
          ] } };
        }
        if (name === "document_intake_finalize_split") return { data: { item: { id: itemId, status: "split" } } };
        throw new Error(`unexpected client rpc ${name}`);
      },
      adminRpc: () => ({}),
      adminRows: { document_intake_items: [
        { ...childRow(itemId, 0), channel: "upload", parent_item_id: null, status: "pending_review", storage_path: sourcePath, verified_mime: "application/pdf", verified_sha256: sha256Hex(parentBytes), page_count: 3 },
        childRow(childA, 1),
        childRow(childB, 2),
      ] },
      objects,
    });

    const response = await splitRoute(post({ request_key: requestKey, expected_revision: revision, parts: [{ pages: [3, 1] }, { pages: [2] }] }), params({ itemId }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ item: { status: "split" }, children: [{ item_id: childA, pages: [3, 1] }, { item_id: childB, pages: [2] }] });
    expectPrincipals(clientRpc, adminRpc);
    expect(called(adminRpc)).toEqual([
      "document_intake_declare_split_child", "document_intake_attest_source",
      "document_intake_declare_split_child", "document_intake_attest_source",
    ]);
    const stored = objects.get(`document-intake/${orgId}/${facilityId}/${itemId}/split-1`)!;
    const reread = await PDFDocument.load(stored);
    expect(reread.getPages().map((page) => page.getWidth())).toEqual([500, 300]);
    expect(adminRpc.mock.calls[1]![1]).toMatchObject({ p_item: childA, p_mime: "application/pdf", p_sha256: sha256Hex(stored), p_page_count: 2 });
    expect(clientRpc.mock.calls.at(-1)).toEqual(["document_intake_finalize_split", {
      p_item: itemId, p_request_key: deriveRequestKey(requestKey, "finalize"), p_expected_revision: parentRevision,
    }]);
  });

  it("refuses a page placed twice before calling anything", async () => {
    const { clientRpc } = setup({ clientRpc: () => { throw new Error("must not prepare"); } });
    const response = await splitRoute(post({ request_key: requestKey, expected_revision: revision, parts: [{ pages: [1, 2] }], excluded_pages: [2] }), params({ itemId }));
    expect(response.status).toBe(400);
    expect(called(clientRpc)).toEqual([]);
  });
});
