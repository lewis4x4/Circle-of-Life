import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ require: vi.fn(), revalidate: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/auth/current-api-actor", () => ({ requireCurrentApiActor: mocks.require, revalidateCurrentApiActor: mocks.revalidate }));

import { listAdmissionScreenings, overrideAdmissionScreening, recordAdmissionScreening } from "./server";

const residentId = "00000000-0000-0000-0000-000000000202";
const facilityId = "00000000-0000-0000-0000-000000000204";
const screeningId = "00000000-0000-0000-0000-000000000206";
const caseId = "00000000-0000-0000-0000-000000000207";
const requestId = "960fe30d-2fd3-45a8-b5a3-7ceea294f618";
const actor = { id: "00000000-0000-0000-0000-000000000205", organizationId: facilityId, appRole: "owner", client: { rpc: mocks.rpc } };
const answers = { resident_id: residentId, source: "admission", coverage: "private_pay", q_property_non_primary: "no", q_income_over_limit: "no", q_life_insurance: "yes", q_burial_contract: "no", q_assets: "no", q_power_of_attorney: "no" };
const post = (body: unknown) => new Request("http://localhost/api/admin/benefits/screenings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const gate = { disqualify: ["q_property_non_primary", "q_income_over_limit", "q_assets"], income_limit_cents: 282900, assets_limit_cents: 200000, source: "Owner ruling" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.require.mockResolvedValue({ actor });
  mocks.revalidate.mockResolvedValue({ actor });
});

describe("admission screening API", () => {
  it("refuses an absent session before any query", async () => {
    mocks.require.mockResolvedValue({ response: NextResponse.json({ error: "Sign in" }, { status: 401 }) });
    expect((await recordAdmissionScreening(post({ request_id: requestId, screening: answers }))).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("records answers through the checked RPC with the request identity", async () => {
    mocks.rpc.mockResolvedValue({ data: { screening_id: screeningId, result: "candidate", reasons: [], case_id: caseId, recheck_id: null, recheck_due_on: null }, error: null });
    const response = await recordAdmissionScreening(post({ request_id: requestId, screening: answers }));
    expect(response.status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledWith("benefits_screening_record", { p_payload: answers, p_request_id: requestId });
    expect(await response.json()).toMatchObject({ result: "candidate", case_id: caseId });
  });
  it("rejects a missing answer, a made-up answer, or a forged organization before mutation", async () => {
    const missing: Record<string, unknown> = { ...answers };
    delete missing.q_assets;
    for (const screening of [missing, { ...answers, q_assets: "maybe" }, { ...answers, organization_id: facilityId }]) {
      expect((await recordAdmissionScreening(post({ request_id: requestId, screening }))).status).toBe(400);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("maps a denied facility to not-available and a reused request to a conflict", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } }).mockResolvedValueOnce({ data: null, error: { code: "23505" } });
    expect((await recordAdmissionScreening(post({ request_id: requestId, screening: answers }))).status).toBe(404);
    expect((await recordAdmissionScreening(post({ request_id: requestId, screening: answers }))).status).toBe(409);
  });
  it("treats an unverifiable list as an error, not as no screenings", async () => {
    mocks.rpc.mockResolvedValue({ data: { resident_id: residentId }, error: null });
    const response = await listAdmissionScreenings(new Request(`http://localhost/api/admin/benefits/screenings?resident_id=${residentId}`));
    expect(response.status).toBe(503);
  });
  it("returns a verified list for the requested resident only", async () => {
    mocks.rpc.mockResolvedValue({ data: { resident_id: residentId, facility_id: facilityId, permissions: { can_write: true, can_review: false }, gate, active_case_id: null, open_recheck: null, screenings: [] }, error: null });
    const ok = await listAdmissionScreenings(new Request(`http://localhost/api/admin/benefits/screenings?resident_id=${residentId}`));
    expect(ok.status).toBe(200);
    mocks.rpc.mockResolvedValue({ data: { resident_id: caseId, facility_id: facilityId, permissions: { can_write: true, can_review: false }, gate, active_case_id: null, open_recheck: null, screenings: [] }, error: null });
    expect((await listAdmissionScreenings(new Request(`http://localhost/api/admin/benefits/screenings?resident_id=${residentId}`))).status).toBe(503);
  });
  it("requires a reason for an override and passes it to the reviewer RPC", async () => {
    expect((await overrideAdmissionScreening(post({ request_id: requestId, result: "candidate", reason: "  " }), screeningId)).status).toBe(400);
    mocks.rpc.mockResolvedValue({ data: { override_id: caseId, screening_id: screeningId, result: "candidate", case_id: caseId }, error: null });
    expect((await overrideAdmissionScreening(post({ request_id: requestId, result: "candidate", reason: "Income is in a trust" }), screeningId)).status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledWith("benefits_screening_override", { p_screening_id: screeningId, p_result: "candidate", p_reason: "Income is in a trust", p_request_id: requestId });
  });
});

describe("recheck API", () => {
  it("bounds the window and passes the facility filter", async () => {
    const { listBenefitsRechecks } = await import("./server");
    expect((await listBenefitsRechecks(new Request("http://localhost/api/admin/benefits/rechecks?within_days=9999"))).status).toBe(400);
    mocks.rpc.mockResolvedValue({ data: { as_of: "2026-09-24", rechecks: [] }, error: null });
    expect((await listBenefitsRechecks(new Request(`http://localhost/api/admin/benefits/rechecks?facility_id=${facilityId}`))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("benefits_recheck_list", { p_facility_id: facilityId, p_due_within_days: 14 });
  });
  it("only accepts no change or resident left, and passes the request identity", async () => {
    const { completeBenefitsRecheck } = await import("./server");
    expect((await completeBenefitsRecheck(post({ request_id: requestId, outcome: "changed" }), screeningId)).status).toBe(400);
    mocks.rpc.mockResolvedValue({ data: { recheck_id: screeningId, outcome: "no_change", next_recheck_id: caseId, next_due_on: "2026-12-23" }, error: null });
    expect((await completeBenefitsRecheck(post({ request_id: requestId, outcome: "no_change" }), screeningId)).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("benefits_recheck_complete", { p_recheck_id: screeningId, p_outcome: "no_change", p_note: null, p_request_id: requestId });
  });
});

describe("sweep API", () => {
  it("starts a sweep only with a facility and passes the request identity", async () => {
    const { startBenefitsSweep, getBenefitsSweep } = await import("./server");
    expect((await startBenefitsSweep(post({ request_id: requestId }))).status).toBe(400);
    mocks.rpc.mockResolvedValue({ data: { sweep_id: caseId, facility_id: facilityId, started_at: "2026-09-24T18:00:00Z", already_started: false }, error: null });
    expect((await startBenefitsSweep(post({ request_id: requestId, facility_id: facilityId }))).status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledWith("benefits_sweep_start", { p_facility_id: facilityId, p_note: null, p_request_id: requestId });
    mocks.rpc.mockResolvedValue({ data: { can_start: true, facilities: [{ facility_id: caseId, facility_name: "x", started_at: null, started_by_name: null, can_write: true, total: 1, answered: 0, remaining: [] }] }, error: null });
    expect((await getBenefitsSweep(new Request(`http://localhost/api/admin/benefits/sweep?facility_id=${facilityId}`))).status).toBe(503);
  });
});

describe("prompts API", () => {
  it("refuses unknown prompt kinds and out-of-range set-aside periods before mutation", async () => {
    const { startPromptCase, dismissPrompt } = await import("./server");
    expect((await startPromptCase(post({ request_id: requestId, resident_id: residentId, kind: "vibes" }))).status).toBe(400);
    expect((await dismissPrompt(post({ request_id: requestId, resident_id: residentId, kind: "runway", days: 365, reason: "x" }))).status).toBe(400);
    expect((await dismissPrompt(post({ request_id: requestId, resident_id: residentId, kind: "runway", days: 30, reason: " " }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("treats an unverifiable prompt list as an error", async () => {
    const { getMedicaidPrompts } = await import("./server");
    mocks.rpc.mockResolvedValue({ data: { as_of: "2026-09-24", runway: [] }, error: null });
    expect((await getMedicaidPrompts(new Request("http://localhost/api/admin/benefits/prompts"))).status).toBe(503);
  });
});

describe("informational prompt set-aside (COL-769)", () => {
  it("needs a reason for runway prompts but not for the trust or look-back prompts", async () => {
    const { dismissPrompt } = await import("./server");
    mocks.rpc.mockResolvedValue({ data: { dismissal_id: caseId, until_on: "2026-12-23" }, error: null });
    expect((await dismissPrompt(post({ request_id: requestId, resident_id: residentId, kind: "runway", days: 30 }))).status).toBe(400);
    expect((await dismissPrompt(post({ request_id: requestId, resident_id: residentId, kind: "over_income", days: 90 }))).status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledWith("benefits_prompt_dismiss", { p_resident_id: residentId, p_kind: "over_income", p_days: 90, p_reason: null, p_request_id: requestId });
  });
});

describe("board API", () => {
  it("requires a facility, rejects the score step as a plain step and scores outside 1-5", async () => {
    const { getMedicaidBoard, commandMedicaidBoard } = await import("./server");
    expect((await getMedicaidBoard(new Request("http://localhost/api/admin/benefits/board"))).status).toBe(400);
    expect((await commandMedicaidBoard(post({ request_id: requestId, expected_revision: 1, action: "record_step", payload: { step: "score" } }), caseId)).status).toBe(400);
    expect((await commandMedicaidBoard(post({ request_id: requestId, expected_revision: 1, action: "record_score", payload: { score: 6 } }), caseId)).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("passes revision and request identity and surfaces a stale case as a conflict", async () => {
    const { commandMedicaidBoard } = await import("./server");
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0409" } });
    expect((await commandMedicaidBoard(post({ request_id: requestId, expected_revision: 7, action: "record_step", payload: { step: "intake_requested", occurred_on: "2026-09-20" } }), caseId)).status).toBe(409);
    expect(mocks.rpc).toHaveBeenCalledWith("benefits_board_command", { p_case_id: caseId, p_action: "record_step", p_payload: { step: "intake_requested", occurred_on: "2026-09-20" }, p_expected_revision: 7, p_request_id: requestId });
  });
  it("keeps the first-payment and renewal phase on each row (COL-774)", async () => {
    const { getMedicaidBoard } = await import("./server");
    const row = { case_id: caseId, revision: 2, status: "waiting", resident_id: residentId, resident_name: "Anon", next_action: null, due_date: null, assignee_name: null, agency_score: null, reapply_on: null, caseworker_id: null, caseworker_name: null, caseworker_phone: null,
      step_dates: { plan_authorized: "2026-09-20" }, next_step: null, waiting_on: "agency", days_since_last_step: 4, stalled: false, plan_rate_cents: null, revenue_not_collected_cents: null,
      phase: "awaiting_first_payment", phase_days: 4, first_payment_on: null, renewal_date: "2027-09-01" };
    mocks.rpc.mockResolvedValue({ data: { as_of: "2026-09-24", facility_id: facilityId, facility_name: "Anon", stalled_days: 14, can_write: true, steps: [], rows: [row], needs_answers: [], rechecks_due: 0, contacts: [] }, error: null });
    const response = await getMedicaidBoard(new Request(`http://localhost/api/admin/benefits/board?facility_id=${facilityId}`));
    expect(response.status).toBe(200);
    expect((await response.json()).rows[0]).toMatchObject({ phase: "awaiting_first_payment", phase_days: 4, renewal_date: "2027-09-01" });
  });
});
