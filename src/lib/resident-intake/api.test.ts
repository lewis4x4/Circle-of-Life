import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireActor: vi.fn(), revalidateActor: vi.fn(), readSnapshot: vi.fn() }));

vi.mock("./source-bytes", () => ({
  requireResidentIntakeActor: mocks.requireActor,
  revalidateResidentIntakeActor: mocks.revalidateActor,
}));
vi.mock("./snapshot", () => ({
  readResidentIntakeSnapshot: mocks.readSnapshot,
  snapshotErrorResponse: vi.fn(),
}));

import { commandResidentIntake, createResidentIntake } from "./api";

const ids = {
  intake: "ea06db41-2321-4bad-a3a0-3f354df3916b",
  org: "7852f1ae-352d-4e89-975b-192165782d94",
  facility: "839c836e-adc3-479f-ac23-21f9df0a8e2a",
  actor: "1da58832-3243-40cc-bbc5-442a01000e11",
  source: "0a2b12ff-9fca-4aaa-a137-bc5705155cf9",
  revision: "4e44ec31-ad9e-45aa-9f64-a53b7ee295f1",
  request: "cab1130a-a045-4759-bf59-b5f22b75c958",
};

describe("resident intake API RPC contracts", () => {
  const rpc = vi.fn();
  const actor = { id: ids.actor, organizationId: ids.org, appRole: "nurse", client: { rpc }, admin: {} };

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireActor.mockResolvedValue({ actor });
    mocks.revalidateActor.mockResolvedValue({ actor });
    mocks.readSnapshot.mockResolvedValue({ snapshot: { intake: { id: ids.intake }, sources: [], facts: [], matches: [], checklist: [], counts: {}, can: {} } });
  });

  it("uses the exact create RPC parameter contract and reads back the snapshot", async () => {
    rpc.mockResolvedValue({
      data: {
        intake: {
          id: ids.intake,
          organization_id: ids.org,
          facility_id: ids.facility,
          resident_id: null,
          admission_case_id: null,
          title: "Resident record packet",
          state: "draft",
          parser_state: "not_started",
          revision: ids.revision,
          created_at: "2026-09-15T00:00:00Z",
          completed_at: null,
        },
        replayed: false,
      },
      error: null,
    });
    const response = await createResidentIntake(new Request("http://localhost", { method: "POST", body: JSON.stringify({ facility_id: ids.facility, request_key: ids.request }) }));
    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("prepare_resident_record_intake", {
      p_request_key: ids.request,
      p_facility_id: ids.facility,
      p_title: "Resident record packet",
      p_resident_id: null,
      p_admission_case_id: null,
    });
    expect(mocks.readSnapshot).toHaveBeenCalledWith(actor, ids.intake);
  });

  it("maps a manual fact to controlled database fields rather than accepting a writer path", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    const response = await commandResidentIntake(new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({
        command: "propose_manual_fact",
        request_key: ids.request,
        expected_revision: ids.revision,
        payload: {
          source_id: ids.source,
          field_code: "resident.first_name",
          value: "Ada",
          display_value: "Ada",
          page_numbers: [2],
          reason: "Reviewed the source",
        },
      }),
    }), ids.intake);
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("resident_record_intake_command", {
      p_intake_id: ids.intake,
      p_request_key: ids.request,
      p_command: "propose_manual_fact",
      p_payload: {
        source_id: ids.source,
        field_code: "resident.first_name",
        domain: "demographics",
        structured_value: "Ada",
        display_value: "Ada",
        page_start: 2,
        page_end: 2,
        confidence: null,
        conflict: false,
        conflict_code: null,
        reason: "Reviewed the source",
      },
    });
  });
});
