import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/operations/auth", () => ({ requireOperationsActor: vi.fn(), revalidateOperationsActor: vi.fn(), actorCanAccessFacility: vi.fn() }));
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn() }));

import { GET as LIST } from "./route";
import { GET as LIST_BINDINGS, POST as ENROLL } from "./bindings/route";
import { POST as RETIRE } from "./bindings/[id]/retire/route";
import { POST as MANUAL } from "./manual/route";
import { POST as ASSOCIATE } from "./[id]/associate/route";
import { POST as CANCEL } from "./[id]/cancel/route";
import { actorCanAccessFacility, requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";

const rpc = vi.fn();
const terminal = vi.fn();
const maybeSingle = vi.fn();
const from = vi.fn(() => {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "not", "gte", "lte"]) query[method] = vi.fn(() => query);
  query.order = vi.fn(() => ({ order: terminal }));
  query.maybeSingle = maybeSingle;
  return query;
});
const actor = { id: "actor", organizationId: "org", appRole: "facility_admin", currentActor: { client: { rpc, from } } };
const facilityId = "33333333-3333-4333-8333-333333333333";
const activityId = "11111111-1111-4111-8111-111111111111";
const subjectId = "44444444-4444-4444-8444-444444444444";
const occurrenceId = "55555555-5555-4555-8555-555555555555";
const workId = "66666666-6666-4666-8666-666666666666";
const revision = "b".repeat(64);
const post = (body: unknown) => new Request("https://local.test/occurrences", { method: "POST", body: JSON.stringify(body) }) as never;
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOperationsActor).mockResolvedValue({ actor } as never);
  vi.mocked(revalidateOperationsActor).mockResolvedValue({ actor } as never);
  vi.mocked(actorCanAccessFacility).mockResolvedValue(true);
  terminal.mockResolvedValue({ data: [], error: null });
  maybeSingle.mockResolvedValue({ data: { id: occurrenceId, facility_id: facilityId, organization_id: "org" }, error: null });
});

describe("managed occurrence reads", () => {
  it("hides a site without a current grant before any read", async () => {
    vi.mocked(actorCanAccessFacility).mockResolvedValue(false);
    const response = await LIST(new NextRequest(`https://local.test/occurrences?facility_id=${facilityId}`) as never);
    expect(response.status).toBe(404);
    expect(from).not.toHaveBeenCalled();
  });

  it("refuses an invalid date range and lists managed rows through the session client", async () => {
    expect((await LIST(new NextRequest(`https://local.test/occurrences?facility_id=${facilityId}&date_from=2026-09-20&date_to=2026-09-10`) as never)).status).toBe(400);
    const response = await LIST(new NextRequest(`https://local.test/occurrences?facility_id=${facilityId}&activity_id=${activityId}&date_from=2026-09-01&date_to=2026-09-30`) as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ occurrences: [] });
  });

  it("lists bindings for a granted site", async () => {
    const response = await LIST_BINDINGS(new NextRequest(`https://local.test/bindings?facility_id=${facilityId}`) as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ bindings: [] });
  });
});

describe("binding commands", () => {
  const enrolment = { activity_id: activityId, facility_id: facilityId, subject_id: subjectId, authority_class: "asset", provenance: { source: "interview", reason: "Second generator" }, effective_from: "2026-10-01T04:00:00Z" };

  it("refuses an enrolment for a site without a current grant before the command", async () => {
    vi.mocked(actorCanAccessFacility).mockResolvedValue(false);
    expect((await ENROLL(post(enrolment))).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("stops before the command when the actor no longer revalidates", async () => {
    vi.mocked(revalidateOperationsActor).mockResolvedValue({ response: new Response(JSON.stringify({ error: "Sign in again to continue." }), { status: 401 }) } as never);
    const response = await ENROLL(post(enrolment));
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("forwards only the contract fields and returns the binding", async () => {
    expect((await ENROLL(post({ ...enrolment, created_by: "me" }))).status).toBe(400);
    rpc.mockResolvedValue({ data: { id: "binding", effective_from: "2026-10-01T04:00:00+00:00" }, error: null });
    const response = await ENROLL(post(enrolment));
    expect(response.status).toBe(200);
    expect(revalidateOperationsActor).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("enroll_operation_binding_review", {
      p_activity: activityId, p_facility: facilityId, p_subject: subjectId, p_authority_class: "asset", p_shift: null, p_provenance: enrolment.provenance, p_effective_from: enrolment.effective_from,
    });
  });

  it("maps an existing open binding to a conflict and a subject denial to a hidden outcome", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "23505", message: "An open binding already exists for this subject" } });
    expect((await ENROLL(post(enrolment))).status).toBe(409);
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "Requirement actor is not authorized" } });
    const denied = await ENROLL(post(enrolment));
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "Operation unavailable" });
  });

  it("retires a binding only after the session read finds it and the site is granted", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect((await RETIRE(post({ effective_to: "2026-12-31T05:00:00Z", reason: "Asset sold" }), params(occurrenceId))).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
    maybeSingle.mockResolvedValue({ data: { id: occurrenceId, facility_id: facilityId, organization_id: "org" }, error: null });
    rpc.mockResolvedValue({ data: { id: occurrenceId, effective_from: "2026-10-01T04:00:00+00:00", effective_to: "2026-12-31T05:00:00+00:00" }, error: null });
    const response = await RETIRE(post({ effective_to: "2026-12-31T05:00:00Z", reason: "Asset sold" }), params(occurrenceId));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("retire_operation_binding_review", { p_binding: occurrenceId, p_effective_to: "2026-12-31T05:00:00Z", p_reason: "Asset sold" });
  });
});

describe("occurrence commands", () => {
  it("creates a manual occurrence with the request key and only the editable payload", async () => {
    expect((await MANUAL(post({ activity_id: activityId, facility_id: facilityId, subject_id: subjectId, request_key: "manual-0001", payload: { due_at: "2026-09-10T10:00:00Z" } }))).status).toBe(400);
    rpc.mockResolvedValue({ data: { id: workId, occurrence_kind: "manual", due_at: null }, error: null });
    const response = await MANUAL(post({ activity_id: activityId, facility_id: facilityId, subject_id: subjectId, request_key: "manual-0001", payload: { queue_date: "2026-09-10", note: "Found during rounds" } }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("create_operation_manual_occurrence_review", {
      p_activity: activityId, p_facility: facilityId, p_subject: subjectId, p_request_key: "manual-0001", p_payload: { queue_date: "2026-09-10", note: "Found during rounds" },
    });
  });

  it("reports a replayed manual request with different content as a conflict", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "This request was already saved with different content" } });
    const response = await MANUAL(post({ activity_id: activityId, facility_id: facilityId, subject_id: subjectId, request_key: "manual-0001", payload: {} }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "This request was already saved with different content" });
  });

  it("associates work only after the session read finds the occurrence, forwarding the revision the client read", async () => {
    const body = { work_task_id: workId, association_kind: "late", expected_revision: revision, reason: "Recorded the next morning", request_key: "assoc-0001" };
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect((await ASSOCIATE(post(body), params(occurrenceId))).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
    maybeSingle.mockResolvedValue({ data: { id: occurrenceId, facility_id: facilityId, organization_id: "org" }, error: null });
    vi.mocked(actorCanAccessFacility).mockResolvedValueOnce(false);
    expect((await ASSOCIATE(post(body), params(occurrenceId))).status).toBe(404);
    rpc.mockResolvedValue({ data: { association_id: "assoc", replayed: false }, error: null });
    const response = await ASSOCIATE(post(body), params(occurrenceId));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("associate_operation_occurrence_review", {
      p_occurrence: occurrenceId, p_work: workId, p_kind: "late", p_expected_revision: revision, p_reason: body.reason, p_request_key: "assoc-0001",
    });
  });

  it("surfaces a stale revision and an already associated work row as conflicts", async () => {
    const body = { work_task_id: workId, association_kind: "early", expected_revision: revision, reason: "Done ahead", request_key: "assoc-0002" };
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "Occurrence changed since it was read" } });
    expect(await (await ASSOCIATE(post(body), params(occurrenceId))).json()).toEqual({ error: "Occurrence changed since it was read" });
    rpc.mockResolvedValue({ data: null, error: { code: "23505", message: "Work is already associated" } });
    expect((await ASSOCIATE(post(body), params(occurrenceId))).status).toBe(409);
  });

  it("cancels a managed occurrence with a reason and a request key", async () => {
    expect((await CANCEL(post({ reason: "Resident discharged" }), params(occurrenceId))).status).toBe(400);
    expect((await CANCEL(post({ reason: "x", request_key: "cancel-0001" }), params("not-a-uuid"))).status).toBe(404);
    rpc.mockResolvedValue({ data: { id: occurrenceId, status: "cancelled", replayed: false }, error: null });
    const response = await CANCEL(post({ reason: "Resident discharged", request_key: "cancel-0001" }), params(occurrenceId));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("cancel_operation_occurrence_review", { p_task: occurrenceId, p_reason: "Resident discharged", p_request_key: "cancel-0001" });
  });

  it("does not echo unexpected database detail", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "relation public.secret does not exist" } });
    const response = await CANCEL(post({ reason: "Resident discharged", request_key: "cancel-0001" }), params(occurrenceId));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Occurrence request could not be completed" });
  });
});
