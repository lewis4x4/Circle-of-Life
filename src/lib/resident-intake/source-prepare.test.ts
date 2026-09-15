import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireActor: vi.fn(), revalidateActor: vi.fn(), logError: vi.fn() }));

vi.mock("@/lib/auth/current-api-actor", () => ({
  requireCurrentApiActor: mocks.requireActor,
  revalidateCurrentApiActor: mocks.revalidateActor,
}));
vi.mock("@/lib/observability/logger", () => ({ logError: mocks.logError }));

import { prepareResidentIntakeSource } from "./source-bytes";

const intakeId = "a686fd93-1996-4057-a958-7226e2be7bf7";
const sourceId = "f1282f5a-b71d-45b9-9242-219de48a5996";
const actorId = "4058fd08-4786-4977-927d-c0a644016064";
const orgId = "7b290f39-a878-460f-b3dc-9dfb22d409f6";
const facilityId = "90b3d1a4-84e9-46cf-b96a-c764c26d57b6";
const expectedRevision = "7a9971d4-b707-4f51-8ba3-7431b356dcfe";
const nextRevision = "b621d18a-d4a5-4037-b9a3-c0c1ca9628ab";
// Synthetic low-entropy v4 UUID: a random one reads as key material to the
// gitleaks generic-api-key rule (identifier ending in "Key" + high entropy).
const requestKey = "00000000-0000-4000-8000-000000000004";
const sha256 = "a".repeat(64);
const path = `${orgId}/${facilityId}/${intakeId}/${sourceId}/source`;

describe("resident intake source prepare revision contract", () => {
  beforeEach(() => vi.resetAllMocks());

  it("passes the expected intake revision and returns the new revision", async () => {
    const source = {
      id: sourceId,
      intake_id: intakeId,
      organization_id: orgId,
      facility_id: facilityId,
      source_order: 1,
      title: "resident.pdf",
      original_filename: "resident.pdf",
      declared_mime: "application/pdf",
      declared_size_bytes: 100,
      declared_sha256: sha256,
      storage_path: path,
      state: "prepared",
      revision: "2891e5eb-f0aa-48b7-a97e-83722bacec39",
      uploaded_by: actorId,
      preflight_state: "needs_confirmation",
      source_class: "unclassified",
    };
    const rpc = vi.fn(async (name: string) => {
      if (name === "prepare_resident_record_intake_source") return { data: { source, intake_revision: nextRevision, replayed: false }, error: null };
      if (name === "resident_record_intake_source_target") return { data: { source_id: sourceId, bucket: "resident-intake-sources", path, declared_mime: "application/pdf", declared_size_bytes: 100, declared_sha256: sha256, state: "prepared", revision: source.revision, object: null }, error: null };
      throw new Error(`unexpected rpc ${name}`);
    });
    const createSignedUploadUrl = vi.fn().mockResolvedValue({ data: { path, token: "token", signedUrl: "https://storage.test/upload" }, error: null });
    const actor = {
      id: actorId,
      organizationId: orgId,
      appRole: "nurse",
      client: { rpc, auth: {}, storage: { from: vi.fn().mockReturnValue({ createSignedUploadUrl }) } },
      admin: {},
    };
    mocks.requireActor.mockResolvedValue({ actor });
    mocks.revalidateActor.mockResolvedValue({ actor });

    const response = await prepareResidentIntakeSource(new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ request_key: requestKey, expected_revision: expectedRevision, file_name: "resident.pdf", declared_mime: "application/pdf", declared_size_bytes: 100, declared_sha256: sha256 }),
    }), intakeId);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ intake_revision: nextRevision, upload: { path } });
    expect(rpc).toHaveBeenCalledWith("prepare_resident_record_intake_source", {
      p_intake_id: intakeId,
      p_request_key: requestKey,
      p_payload: expect.objectContaining({ expected_intake_revision: expectedRevision }),
    });
  });
});
