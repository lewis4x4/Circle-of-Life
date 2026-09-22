import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireActor: vi.fn(),
  revalidateActor: vi.fn(),
  download: vi.fn(),
  readSnapshot: vi.fn(),
}));

vi.mock("./source-bytes", () => ({
  requireResidentIntakeActor: mocks.requireActor,
  revalidateResidentIntakeActor: mocks.revalidateActor,
  downloadVerifiedResidentIntakeSource: mocks.download,
}));
vi.mock("./snapshot", () => ({
  readResidentIntakeSnapshot: mocks.readSnapshot,
  snapshotErrorResponse: vi.fn(),
}));

import { parseResidentIntakeSource } from "./parser";

const intakeId = "da182453-4d54-4658-ac57-d6d689148c87";
const sourceId = "61f0877b-c3ce-4602-a112-d1cc347f9e91";
const revision = "44cd948a-77dc-42b3-9fd1-132814ef5b74";
// Synthetic low-entropy v4 UUID: a random one reads as key material to the
// gitleaks generic-api-key rule (identifier ending in "Key" + high entropy).
const requestKey = "00000000-0000-4000-8000-000000000001";

describe("resident intake PHI policy gate", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("makes zero provider calls when the organization has no PHI policy row", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {}, error: null });
    const policy = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
    policy.select.mockReturnValue(policy);
    policy.eq.mockReturnValue(policy);
    const actor = { id: "2383b30f-73cf-4d97-886c-31af8b505346", organizationId: "0a35a335-f0a6-4ae8-84ad-2adb0986168f", appRole: "med_tech", client: { rpc }, admin: { from: vi.fn().mockReturnValue(policy) } };
    mocks.requireActor.mockResolvedValue({ actor });
    mocks.revalidateActor.mockResolvedValue({ actor });
    mocks.readSnapshot.mockResolvedValue({ snapshot: { sources: [{ id: sourceId, revision, original_filename: "resident.pdf", declared_mime: "application/pdf", preflight_state: "safe" }] } });
    const providerFetch = vi.spyOn(globalThis, "fetch");
    const response = await parseResidentIntakeSource(new Request("http://localhost", { method: "POST", body: JSON.stringify({ source_id: sourceId, request_key: requestKey, expected_revision: revision }) }), intakeId);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ outcome: "manual_required", manual_available: true });
    expect(providerFetch).not.toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("resident_record_intake_command", expect.objectContaining({ p_command: "record_parse_failure" }));
    providerFetch.mockRestore();
  });

  it("makes zero provider calls when PHI is allowed and routed but no BAA is recorded", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {}, error: null });
    const policy = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: { allow_phi: true, baa_reference: null, baa_verified_at: null, default_provider: "anthropic", routing_json: { resident_record_intake: { provider: "anthropic", enabled: true } } }, error: null }) };
    policy.select.mockReturnValue(policy);
    policy.eq.mockReturnValue(policy);
    const actor = { id: "2383b30f-73cf-4d97-886c-31af8b505346", organizationId: "0a35a335-f0a6-4ae8-84ad-2adb0986168f", appRole: "med_tech", client: { rpc }, admin: { from: vi.fn().mockReturnValue(policy) } };
    mocks.requireActor.mockResolvedValue({ actor });
    mocks.revalidateActor.mockResolvedValue({ actor });
    mocks.readSnapshot.mockResolvedValue({ snapshot: { sources: [{ id: sourceId, revision, original_filename: "resident.pdf", declared_mime: "application/pdf", preflight_state: "safe" }] } });
    const providerFetch = vi.spyOn(globalThis, "fetch");
    const response = await parseResidentIntakeSource(new Request("http://localhost", { method: "POST", body: JSON.stringify({ source_id: sourceId, request_key: requestKey, expected_revision: revision }) }), intakeId);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ outcome: "manual_required", manual_available: true });
    expect(providerFetch).not.toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("resident_record_intake_command", expect.objectContaining({ p_command: "record_parse_failure", p_payload: expect.objectContaining({ error_code: "phi_not_authorized" }) }));
    providerFetch.mockRestore();
  });

  it("makes zero provider calls when PHI is allowed but resident-intake provider routing is absent", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {}, error: null });
    const policy = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: { allow_phi: true, default_provider: "anthropic", routing_json: {} }, error: null }) };
    policy.select.mockReturnValue(policy);
    policy.eq.mockReturnValue(policy);
    const actor = { id: "2383b30f-73cf-4d97-886c-31af8b505346", organizationId: "0a35a335-f0a6-4ae8-84ad-2adb0986168f", appRole: "med_tech", client: { rpc }, admin: { from: vi.fn().mockReturnValue(policy) } };
    mocks.requireActor.mockResolvedValue({ actor });
    mocks.revalidateActor.mockResolvedValue({ actor });
    mocks.readSnapshot.mockResolvedValue({ snapshot: { sources: [{ id: sourceId, revision, original_filename: "resident.pdf", declared_mime: "application/pdf", preflight_state: "safe" }] } });
    const providerFetch = vi.spyOn(globalThis, "fetch");
    const response = await parseResidentIntakeSource(new Request("http://localhost", { method: "POST", body: JSON.stringify({ source_id: sourceId, request_key: requestKey, expected_revision: revision }) }), intakeId);
    expect(response.status).toBe(409);
    expect(providerFetch).not.toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
    providerFetch.mockRestore();
  });
});
