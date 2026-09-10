import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/operations/auth", () => ({ requireOperationsActor: vi.fn(), revalidateOperationsActor: vi.fn(), actorCanAccessFacility: vi.fn() }));
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn() }));

import { GET, POST } from "./route";
import { actorCanAccessFacility, requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";

const rpc = vi.fn();
const maybeSingle = vi.fn();
const order = vi.fn();
const from = vi.fn(() => {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is"]) query[method] = vi.fn(() => query);
  query.order = order;
  query.maybeSingle = maybeSingle;
  return query;
});
const actor = { id: "actor", organizationId: "org", appRole: "housekeeper", currentActor: { client: { rpc, from } } };
const facilityId = "33333333-3333-4333-8333-333333333333";
const activityId = "11111111-1111-4111-8111-111111111111";
const subjectId = "44444444-4444-4444-8444-444444444444";
const occurrenceId = "55555555-5555-4555-8555-555555555555";
const issueId = "88888888-8888-4888-8888-888888888888";
const key = "issue:2026-09-10:0001";
const post = (body: unknown) => new Request("https://local.test/issues", { method: "POST", body: JSON.stringify(body) }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOperationsActor).mockResolvedValue({ actor } as never);
  vi.mocked(revalidateOperationsActor).mockResolvedValue({ actor } as never);
  vi.mocked(actorCanAccessFacility).mockResolvedValue(true);
  maybeSingle.mockResolvedValue({ data: { id: occurrenceId, facility_id: facilityId, organization_id: "org" }, error: null });
  order.mockResolvedValue({ data: [], error: null });
});

describe("issue reads", () => {
  it("requires a granted site before listing", async () => {
    expect((await GET(new NextRequest("https://local.test/issues") as never)).status).toBe(400);
    vi.mocked(actorCanAccessFacility).mockResolvedValueOnce(false);
    expect((await GET(new NextRequest(`https://local.test/issues?facility_id=${facilityId}`) as never)).status).toBe(404);
    expect(from).not.toHaveBeenCalled();
    const response = await GET(new NextRequest(`https://local.test/issues?facility_id=${facilityId}&task_instance_id=${occurrenceId}`) as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ issues: [] });
  });
});

describe("issue reports", () => {
  it("resolves a linked occurrence through the session before the command and forwards the payload", async () => {
    rpc.mockResolvedValue({ data: { issue: { id: issueId, status: "open" }, replayed: false }, error: null });
    const payload = { task_instance_id: occurrenceId, kind: "help_request", summary: "Need the generator key" };
    const response = await POST(post({ request_key: key, payload }));
    expect(response.status).toBe(200);
    expect(actorCanAccessFacility).toHaveBeenCalledWith(actor, facilityId);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("report_operation_issue_review", { p_request_key: key, p_payload: payload });
    expect(await response.json()).toEqual({ outcome: "receipt", issue: { id: issueId, status: "open" }, replayed: false });
  });

  it("hides a foreign or missing occurrence and an ungranted site", async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect((await POST(post({ request_key: key, payload: { task_instance_id: occurrenceId, kind: "problem", summary: "Leak" } }))).status).toBe(404);
    vi.mocked(actorCanAccessFacility).mockResolvedValueOnce(false);
    const response = await POST(post({ request_key: key, payload: { activity_id: activityId, facility_id: facilityId, subject_id: subjectId, kind: "problem", summary: "Leak" } }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Facility not found", outcome: "missing" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses an ambiguous scope and maps a changed replay to a conflict", async () => {
    expect((await POST(post({ request_key: key, payload: { task_instance_id: occurrenceId, facility_id: facilityId, kind: "problem", summary: "Leak" } }))).status).toBe(400);
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "This request was already saved with different content" } });
    const response = await POST(post({ request_key: key, payload: { activity_id: activityId, facility_id: facilityId, subject_id: subjectId, kind: "problem", summary: "Leak" } }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "This request was already saved with different content", outcome: "conflict" });
  });
});
