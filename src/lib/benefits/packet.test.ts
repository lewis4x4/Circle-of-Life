import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BenefitsDetail, BenefitsDocument } from "./contracts";
import { MAX_PACKET_BYTES, buildBenefitsCoverPdf, buildBenefitsPacket, packetRequestSchema, selectPacketDocuments } from "./packet";
import { POST } from "@/app/api/admin/benefits/cases/[id]/packet/route";

const server = vi.hoisted(() => ({ requireBenefitsActor: vi.fn(), revalidateBenefitsActor: vi.fn(), loadBenefitsDetail: vi.fn(), getVerifiedBenefitsDocument: vi.fn(), recordBenefitsDocumentAccess: vi.fn() }));
vi.mock("@/lib/benefits/server", () => server);

const caseId = "11111111-1111-4111-8111-111111111111";
const docId = "22222222-2222-4222-8222-222222222222";
const otherId = "33333333-3333-4333-8333-333333333333";
const bytes = Buffer.from("123456789"); // Well-known CRC32 check vector, cbf43926.
const date = "2026-09-21T15:00:00.000Z";

function fixture(): BenefitsDetail {
  const document: BenefitsDocument = { id: docId, case_id: caseId, filename: "../../Signed José (test).pdf", mime_type: "application/pdf", size_bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), storage_path: "private/never-export-path", status: "ready", document_type: "financial_release", template_version: "reviewed-v1", created_at: date, created_by: otherId };
  return {
    case: { id: caseId, organization_id: otherId, facility_id: otherId, resident_id: otherId, admission_case_id: null, program: "smmc_ltc", status: "open", revision: 4, next_action: null, assigned_to: null, due_date: null, closure_reason: null, screening: {}, funding: {}, created_at: date, updated_at: date, created_by: otherId, resident_name: "José 李 (resident)", facility_name: "Test facility", assignee_name: null },
    permissions: { can_write: true, can_review: true, can_manage_access: false }, documents: [document],
    requirements: [{ id: otherId, case_id: caseId, title: "Financial release", stage: "application", status: "accepted", document_id: docId, signature_status: "verified", reviewed_by: otherId, reviewed_at: date, updated_at: date }],
    events: [], submissions: [], receipts: [], history: [], history_has_more: false,
  };
}

// Independent reader checks local headers against central-directory offsets/sizes.
function unzip(packet: Buffer) {
  const end = packet.length - 22;
  expect(packet.readUInt32LE(end)).toBe(0x06054b50);
  const count = packet.readUInt16LE(end + 10);
  let central = packet.readUInt32LE(end + 16);
  const files = new Map<string, { bytes: Buffer; crc: number }>();
  for (let i = 0; i < count; i++) {
    expect(packet.readUInt32LE(central)).toBe(0x02014b50);
    const offset = packet.readUInt32LE(central + 42), size = packet.readUInt32LE(central + 24);
    expect(packet.readUInt32LE(offset)).toBe(0x04034b50);
    expect(packet.readUInt16LE(offset + 8)).toBe(0);
    expect(packet.readUInt32LE(offset + 22)).toBe(size);
    const length = packet.readUInt16LE(central + 28);
    const name = packet.subarray(central + 46, central + 46 + length).toString("utf8");
    expect(packet.subarray(offset + 30, offset + 30 + length).toString("utf8")).toBe(name);
    files.set(name, { bytes: packet.subarray(offset + 30 + length, offset + 30 + length + size), crc: packet.readUInt32LE(offset + 14) });
    central += 46 + length;
  }
  expect(central).toBe(end);
  return files;
}

describe("benefits packet selection", () => {
  it("bounds and deduplicates requests", () => {
    expect(packetRequestSchema.safeParse({ document_ids: [docId], expected_revision: 1 }).success).toBe(true);
    for (const ids of [[], [docId, docId], ["../../path"], Array(26).fill(docId)]) {
      expect(packetRequestSchema.safeParse({ document_ids: ids, expected_revision: 1 }).success).toBe(false);
    }
    expect(packetRequestSchema.safeParse({ document_ids: [docId], expected_revision: 0 }).success).toBe(false);
    expect(() => selectPacketDocuments(fixture(), [docId, docId])).toThrow("distinct");
  });
  it("rejects foreign, missing, reserved and unreviewed documents", () => {
    const detail = fixture();
    expect(() => selectPacketDocuments(detail, [otherId])).toThrow("belong");
    detail.documents[0].case_id = otherId;
    expect(() => selectPacketDocuments(detail, [docId])).toThrow("belong");
    detail.documents[0].case_id = caseId;
    detail.documents[0].status = "reserved";
    expect(() => selectPacketDocuments(detail, [docId])).toThrow("accepted review");
    detail.documents[0].status = "ready";
    detail.requirements[0].reviewed_by = null;
    expect(() => selectPacketDocuments(detail, [docId])).toThrow("accepted review");
  });
  it("rejects unresolved signatures and contradictory rejection", () => {
    const detail = fixture();
    detail.requirements[0].signature_status = "pending";
    expect(() => selectPacketDocuments(detail, [docId])).toThrow("signatures resolved");
    detail.requirements[0].signature_status = "verified";
    detail.requirements.push({ ...detail.requirements[0], id: caseId, status: "rejected" });
    expect(() => selectPacketDocuments(detail, [docId])).toThrow("accepted review");
  });
  it("rejects a review attached to a different case", () => {
    const detail = fixture();
    detail.requirements[0].case_id = otherId;
    expect(() => selectPacketDocuments(detail, [docId])).toThrow("accepted review");
  });
  it("limits aggregate source bytes before downloads", () => {
    const detail = fixture(); detail.documents[0].size_bytes = MAX_PACKET_BYTES + 1;
    expect(() => selectPacketDocuments(detail, [docId])).toThrow("18 MiB");
  });
});

describe("benefits packet contents", () => {
  it("preserves exact evidence bytes, filenames in manifest, safe ZIP paths and CRC", () => {
    const detail = fixture();
    const before = JSON.stringify(detail);
    const files = unzip(buildBenefitsPacket(detail, [docId], new Map([[docId, bytes]]), date));
    expect([...files.keys()]).toEqual(["cover-and-checklist.pdf", "manifest.json", "documents/01.pdf"]);
    expect(files.get("documents/01.pdf")?.bytes).toEqual(bytes);
    expect(files.get("documents/01.pdf")?.crc).toBe(0xcbf43926);
    const manifest = JSON.parse(files.get("manifest.json")!.bytes.toString("utf8"));
    expect(manifest.case.resident_name).toBe("José 李 (resident)");
    expect(manifest.documents[0].filename).toBe(detail.documents[0].filename);
    expect(manifest.documents[0].template_version).toBe("reviewed-v1");
    expect(manifest.documents[0].sha256).toBe(detail.documents[0].sha256);
    expect(manifest.documents[0].storage_path).toBeUndefined();
    expect(manifest.stage_checklists.find((stage: { stage: string }) => stage.stage === "application").status).toBe("checklist_satisfied");
    expect(manifest.stage_checklists[0].status).toBe("requirements_not_defined");
    expect(JSON.stringify(detail)).toBe(before);
  });
  it("reports missing requirements without pretending an export is submission-ready", () => {
    const detail = fixture();
    detail.requirements.push({ ...detail.requirements[0], id: caseId, title: "New statement", document_id: null, status: "requested", reviewed_by: null, reviewed_at: null });
    const files = unzip(buildBenefitsPacket(detail, [docId], new Map([[docId, bytes]]), date));
    const manifest = JSON.parse(files.get("manifest.json")!.bytes.toString());
    expect(manifest.stage_checklists.find((stage: { stage: string }) => stage.stage === "application")).toMatchObject({ status: "incomplete", missing_requirement_ids: [caseId] });
    expect(manifest.purpose).toContain("Does not record submission");
  });
  it("requires attributable reasoned not-applicable decisions", () => {
    const detail = fixture();
    detail.requirements.push({ ...detail.requirements[0], id: caseId, document_id: null, status: "not_applicable", review_reason: "" });
    let files = unzip(buildBenefitsPacket(detail, [docId], new Map([[docId, bytes]]), date));
    expect(JSON.parse(files.get("manifest.json")!.bytes.toString()).requirements[1].satisfied_in_export).toBe(false);
    detail.requirements[1].review_reason = "Not needed for this program";
    files = unzip(buildBenefitsPacket(detail, [docId], new Map([[docId, bytes]]), date));
    expect(JSON.parse(files.get("manifest.json")!.bytes.toString()).requirements[1].satisfied_in_export).toBe(true);
  });
  it("rejects changed, absent and truncated bytes", () => {
    for (const map of [new Map(), new Map([[docId, Buffer.from("987654321")]]), new Map([[docId, bytes.subarray(0, 8)]])]) {
      expect(() => buildBenefitsPacket(fixture(), [docId], map, date)).toThrow("immutable evidence");
    }
  });
});

describe("benefits cover PDF", () => {
  it("escapes PDF operators and retains valid xref offsets with Unicode fallback", () => {
    const pdf = buildBenefitsCoverPdf(["José 李 (resident) \\ test\n/JS (bad)"]);
    const text = pdf.toString();
    expect(text).toContain("Jose ? \\(resident\\) \\\\ test?/JS \\(bad\\)");
    const start = Number(text.match(/startxref\n(\d+)/)![1]);
    expect(text.slice(start, start + 4)).toBe("xref");
    const offsets = [...text.matchAll(/(\d{10}) 00000 n/g)].map((item) => Number(item[1]));
    offsets.forEach((offset, index) => expect(text.slice(offset)).toMatch(new RegExp(`^${index + 1} 0 obj`)));
    expect(text).not.toContain("/JavaScript");
  });
  it("wraps long text and paginates rather than clipping", () => {
    const text = buildBenefitsCoverPdf(Array(100).fill("x".repeat(180))).toString();
    expect(text).toContain("/Count 7");
    expect(text).toContain("Page 7 of 7");
    expect(text).not.toContain("x".repeat(89));
  });
});

describe("benefits packet route", () => {
  const request = () => new Request("https://haven.test/api/admin/benefits/cases/id/packet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ document_ids: [docId], expected_revision: 4 }) });
  const context = { params: Promise.resolve({ id: caseId }) };
  beforeEach(() => {
    server.recordBenefitsDocumentAccess.mockResolvedValue(null);
    vi.resetAllMocks();
    server.requireBenefitsActor.mockResolvedValue({ actor: { id: otherId } });
    server.revalidateBenefitsActor.mockResolvedValue({ actor: { id: otherId } });
    server.loadBenefitsDetail.mockResolvedValue({ detail: fixture() });
    server.getVerifiedBenefitsDocument.mockResolvedValue({ bytes, document: fixture().documents[0] });
  });
  it("downloads a private archive after fresh actor and case checks", async () => {
    server.recordBenefitsDocumentAccess.mockClear();
    const response = await POST(request(), context);
    expect(server.recordBenefitsDocumentAccess).toHaveBeenCalledWith(expect.anything(), caseId, docId, "packet");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).not.toContain("José");
    expect(server.revalidateBenefitsActor).toHaveBeenCalledOnce();
    expect(server.loadBenefitsDetail).toHaveBeenCalledTimes(2);
    expect(unzip(Buffer.from(await response.arrayBuffer())).get("documents/01.pdf")?.bytes).toEqual(bytes);
  });
  it("rejects stale revision before downloading any document", async () => {
    const detail = fixture(); detail.case.revision++;
    server.loadBenefitsDetail.mockResolvedValue({ detail });
    expect((await POST(request(), context)).status).toBe(409);
    expect(server.getVerifiedBenefitsDocument).not.toHaveBeenCalled();
  });
  it("rejects case changes that occur during evidence retrieval", async () => {
    const detail = fixture(); detail.case.revision++;
    server.loadBenefitsDetail.mockResolvedValueOnce({ detail: fixture() }).mockResolvedValueOnce({ detail });
    expect((await POST(request(), context)).status).toBe(409);
    expect(server.getVerifiedBenefitsDocument).toHaveBeenCalledOnce();
  });
  it("returns no archive when access is revoked during retrieval", async () => {
    server.revalidateBenefitsActor.mockResolvedValue({ response: Response.json({ error: "Access unavailable" }, { status: 403 }) });
    const response = await POST(request(), context);
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).not.toBe("application/zip");
  });
  it("rejects a document review revoked at the final snapshot", async () => {
    const detail = fixture(); detail.requirements[0].status = "rejected";
    server.loadBenefitsDetail.mockResolvedValueOnce({ detail: fixture() }).mockResolvedValueOnce({ detail });
    expect((await POST(request(), context)).status).toBe(400);
  });
  it("fails closed on verification errors and unauthenticated requests", async () => {
    server.getVerifiedBenefitsDocument.mockRejectedValue(new Error("private provider details"));
    const failed = await POST(request(), context);
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("private provider details");
    server.requireBenefitsActor.mockResolvedValue({ response: Response.json({ error: "Sign in" }, { status: 401 }) });
    expect((await POST(request(), context)).status).toBe(401);
  });
  it("bounds chunked input without trusting content-length", async () => {
    const oversized = new Request("https://haven.test", { method: "POST", body: " ".repeat(8193) });
    expect((await POST(oversized, context)).status).toBe(400);
    expect(server.loadBenefitsDetail).not.toHaveBeenCalled();
  });
});
