import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireActor: vi.fn(), revalidateActor: vi.fn(), logError: vi.fn() }));

vi.mock("@/lib/auth/current-api-actor", () => ({
  requireCurrentApiActor: mocks.requireActor,
  revalidateCurrentApiActor: mocks.revalidateActor,
}));
vi.mock("@/lib/observability/logger", () => ({ logError: mocks.logError }));

import { finalizeResidentIntakeSource } from "./source-bytes";

const intakeId = "122d681e-2fa7-4b40-a480-832954d43a34";
const sourceId = "a4875598-cb64-4279-9d23-46a728c6dafd";
const actorId = "8ac58bac-bd8b-45b2-95c2-19aa6ff2cf92";
const orgId = "1fef9308-22f0-432d-9a0e-69849076b11a";
const facilityId = "477e2308-f90c-4281-877c-61e81593b3bb";
const revision = "d4bf39e9-97d6-431d-86c8-8a8518fc6a84";
// Synthetic low-entropy v4 UUID: a random one reads as key material to the
// gitleaks generic-api-key rule (identifier ending in "Key" + high entropy).
const requestKey = "00000000-0000-4000-8000-000000000003";
const bytes = new Uint8Array(Buffer.from("%PDF-1.7\nresident fixture"));
const sha256 = createHash("sha256").update(bytes).digest("hex");
const md5 = createHash("md5").update(bytes).digest("hex");
const path = `${orgId}/${facilityId}/${intakeId}/${sourceId}/source`;

describe("resident intake source finalization target contract", () => {
  beforeEach(() => vi.resetAllMocks());

  it("uses object identity returned by the scoped target RPC and never queries the storage schema", async () => {
    const target = {
      source_id: sourceId,
      bucket: "resident-intake-sources",
      path,
      declared_mime: "application/pdf",
      declared_size_bytes: bytes.length,
      declared_sha256: sha256,
      state: "prepared",
      revision,
      object: { id: "df924fb5-c2ec-4372-93b7-a36d808c5820", version: "object-version-1", etag: md5, size_bytes: bytes.length, mime: "application/pdf", owner_id: actorId },
    };
    const finalizedSource = {
      id: sourceId,
      intake_id: intakeId,
      organization_id: orgId,
      facility_id: facilityId,
      source_order: 1,
      title: "resident.pdf",
      original_filename: "resident.pdf",
      declared_mime: "application/pdf",
      declared_size_bytes: bytes.length,
      declared_sha256: sha256,
      storage_path: path,
      state: "finalized",
      revision: "29dfe4d7-75a2-4e17-9225-3563d595ccf2",
      uploaded_by: actorId,
      preflight_state: "needs_confirmation",
      source_class: "unclassified",
    };
    const rpc = vi.fn(async (name: string) => {
      if (name === "resident_record_intake_source_target") return { data: target, error: null };
      if (name === "finalize_resident_record_intake_source") return { data: { source: finalizedSource, replayed: false }, error: null };
      throw new Error(`unexpected rpc ${name}`);
    });
    const attest = vi.fn().mockResolvedValue({ data: null, error: null });
    const schema = vi.fn(() => { throw new Error("storage schema must not be queried"); });
    const actor = {
      id: actorId,
      organizationId: orgId,
      appRole: "nurse",
      client: { rpc, auth: {}, storage: { from: vi.fn().mockReturnValue({ download: vi.fn().mockResolvedValue({ data: new Blob([bytes]), error: null }) }) } },
      admin: { rpc: attest, schema },
    };
    mocks.requireActor.mockResolvedValue({ actor });
    mocks.revalidateActor.mockResolvedValue({ actor });

    const response = await finalizeResidentIntakeSource(new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ request_key: requestKey, expected_revision: revision }),
    }), intakeId, sourceId);

    expect(response.status).toBe(200);
    expect(schema).not.toHaveBeenCalled();
    expect(attest).toHaveBeenCalledWith("attest_resident_record_intake_bytes", {
      p_source_id: sourceId,
      p_object_id: target.object.id,
      p_object_version: target.object.version,
      p_etag: md5,
      p_size: bytes.length,
      p_mime: "application/pdf",
      p_sha256: sha256,
      p_md5: md5,
      p_uploader: actorId,
    });
  });
});
