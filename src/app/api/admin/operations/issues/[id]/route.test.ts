import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/operations/auth", () => ({ requireOperationsActor: vi.fn(), revalidateOperationsActor: vi.fn(), actorCanAccessFacility: vi.fn() }));
const logError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/observability/logger", () => ({ logError }));

import { GET as DETAIL } from "./route";
import { GET as BACKLOG } from "../backlog/route";
import { POST as ASSIGN } from "./assign/route";
import { POST as ACCEPT } from "./accept/route";
import { POST as WAIT } from "./wait/route";
import { POST as RESUME } from "./resume/route";
import { POST as RESOLVE } from "./resolve/route";
import { POST as REOPEN } from "./reopen/route";
import { POST as LINK } from "./link/route";
import { actorCanAccessFacility, requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";

const rpc = vi.fn();
const maybeSingle = vi.fn();
const order = vi.fn();
const tables: string[] = [];
const from = vi.fn((table: string) => {
  tables.push(table);
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is"]) query[method] = vi.fn(() => query);
  query.order = order;
  query.maybeSingle = maybeSingle;
  return query;
});
const actor = { id: "actor", organizationId: "org", appRole: "manager", currentActor: { client: { rpc, from } } };
const facilityId = "33333333-3333-4333-8333-333333333333";
const issueId = "88888888-8888-4888-8888-888888888888";
const userId = "22222222-2222-4222-8222-222222222222";
const receiptId = "77777777-7777-4777-8777-777777777777";
const key = "issue-cmd:2026-09-10:0001";
const revision = "a".repeat(64);
const issueRow = { id: issueId, organization_id: "org", facility_id: facilityId, status: "open", task_instance_id: null };
const post = (body: unknown) => new Request("https://local.test/issue", { method: "POST", body: JSON.stringify(body) }) as never;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const outcome = (status: string, kind: string) => ({
  issue: { id: issueId, status, issue_revision: "b".repeat(64), request_hash: "f".repeat(64) },
  event: { id: "event-1", event_kind: kind, request_hash: "e".repeat(64) },
  replayed: false,
});

beforeEach(() => {
  vi.clearAllMocks();
  tables.length = 0;
  vi.mocked(requireOperationsActor).mockResolvedValue({ actor } as never);
  vi.mocked(revalidateOperationsActor).mockResolvedValue({ actor } as never);
  vi.mocked(actorCanAccessFacility).mockResolvedValue(true);
  maybeSingle.mockResolvedValue({ data: issueRow, error: null });
  order.mockResolvedValue({ data: [], error: null });
});

describe("issue detail and backlog reads", () => {
  it("returns the issue and its events only for a granted site, stripping the request fingerprint", async () => {
    maybeSingle.mockResolvedValueOnce({ data: { ...issueRow, request_hash: "f".repeat(64), reopen_count: 0 }, error: null });
    order.mockResolvedValueOnce({ data: [{ id: "event-1", event_kind: "assigned" }], error: null });
    const response = await DETAIL(new NextRequest(`https://local.test/issues/${issueId}`) as never, params(issueId));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.issue).toEqual({ ...issueRow, reopen_count: 0 });
    expect(body.events).toEqual([{ id: "event-1", event_kind: "assigned" }]);
    expect(tables).toEqual(["operation_issues", "operation_issue_events"]);
    expect(order).toHaveBeenCalledWith("event_seq", { ascending: true });
  });

  it("treats a missing, foreign or ungranted issue as missing before reading events", async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect((await DETAIL(new NextRequest("https://local.test/x") as never, params(issueId))).status).toBe(404);
    maybeSingle.mockResolvedValueOnce({ data: { ...issueRow, organization_id: "other" }, error: null });
    expect((await DETAIL(new NextRequest("https://local.test/x") as never, params(issueId))).status).toBe(404);
    vi.mocked(actorCanAccessFacility).mockResolvedValueOnce(false);
    const response = await DETAIL(new NextRequest("https://local.test/x") as never, params(issueId));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Issue not found", outcome: "missing" });
    expect(tables).toEqual(["operation_issues", "operation_issues", "operation_issues"]);
    expect((await DETAIL(new NextRequest("https://local.test/x") as never, params("not-a-uuid"))).status).toBe(404);
  });

  it("reads the backlog projection for a granted site with an optional status", async () => {
    expect((await BACKLOG(new NextRequest("https://local.test/backlog") as never)).status).toBe(400);
    expect((await BACKLOG(new NextRequest(`https://local.test/backlog?facility_id=${facilityId}&status=done`) as never)).status).toBe(400);
    // Resolved rows are not backlog; the list route serves them.
    expect((await BACKLOG(new NextRequest(`https://local.test/backlog?facility_id=${facilityId}&status=resolved`) as never)).status).toBe(400);
    vi.mocked(actorCanAccessFacility).mockResolvedValueOnce(false);
    expect((await BACKLOG(new NextRequest(`https://local.test/backlog?facility_id=${facilityId}`) as never)).status).toBe(404);
    expect(from).not.toHaveBeenCalled();
    order.mockResolvedValueOnce({ data: [{ id: issueId, status: "waiting", owner_current: false, follow_up_overdue: true }], error: null });
    const response = await BACKLOG(new NextRequest(`https://local.test/backlog?facility_id=${facilityId}&status=waiting`) as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ backlog: [{ id: issueId, status: "waiting", owner_current: false, follow_up_overdue: true }] });
    expect(tables).toEqual(["operation_issue_backlog"]);
    const query = from.mock.results[0]?.value as { eq: ReturnType<typeof vi.fn> };
    expect(query.eq.mock.calls).toEqual([["organization_id", "org"], ["facility_id", facilityId], ["status", "waiting"]]);
  });
});

describe("issue lifecycle commands", () => {
  it("refuses a malformed body with the validation class before any read", async () => {
    const response = await ASSIGN(post({ request_key: key, expected_revision: revision, payload: { backup_user_id: userId } }), params(issueId));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Assignment needs an owner", outcome: "validation" });
    expect((await ASSIGN(post({ request_key: key, payload: { owner_user_id: userId } }), params(issueId))).status).toBe(400);
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("treats a missing, foreign or ungranted issue as missing before the command", async () => {
    const body = { request_key: key, expected_revision: revision, payload: { owner_user_id: userId } };
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect((await ASSIGN(post(body), params(issueId))).status).toBe(404);
    maybeSingle.mockResolvedValueOnce({ data: { ...issueRow, organization_id: "other" }, error: null });
    expect((await ASSIGN(post(body), params(issueId))).status).toBe(404);
    vi.mocked(actorCanAccessFacility).mockResolvedValueOnce(false);
    const response = await ASSIGN(post(body), params(issueId));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Issue not found", outcome: "missing" });
    expect(rpc).not.toHaveBeenCalled();
    expect(revalidateOperationsActor).not.toHaveBeenCalled();
  });

  it("stops before the command when the session read fails or the actor no longer revalidates", async () => {
    const body = { request_key: key, expected_revision: revision, payload: { owner_user_id: userId } };
    maybeSingle.mockResolvedValueOnce({ data: null, error: { message: "relation locked" } });
    const failed = await ASSIGN(post(body), params(issueId));
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ error: "Issue unavailable", outcome: "uncertain" });
    vi.mocked(revalidateOperationsActor).mockResolvedValueOnce({ response: new Response(JSON.stringify({ error: "Sign in again to continue." }), { status: 401 }) } as never);
    expect((await ASSIGN(post(body), params(issueId))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("forwards each command to its database function with the key, revision and payload, and strips fingerprints", async () => {
    const cases: Array<[string, (request: never, context: never) => Promise<Response>, string, Record<string, unknown>, string]> = [
      ["assign", ASSIGN as never, "assign_operation_issue_review", { owner_user_id: userId, backup_role: "maintenance_role", note: "Generator belt" }, "assigned"],
      ["accept", ACCEPT as never, "accept_operation_issue_review", { cover_reason: "Owner on leave" }, "covered"],
      ["wait", WAIT as never, "wait_operation_issue_review", { reason: "Part on order", follow_up_at: "2999-01-01T12:00:00Z" }, "waiting"],
      ["resume", RESUME as never, "resume_operation_issue_review", {}, "resumed"],
      ["resolve", RESOLVE as never, "resolve_operation_issue_review", { resolution_summary: "Belt replaced", resolution_receipt_id: receiptId }, "resolved"],
      ["reopen", REOPEN as never, "reopen_operation_issue_review", { reason: "Belt failed again" }, "reopened"],
      ["link", LINK as never, "link_operation_issue_review", { receipt_id: receiptId }, "linked"],
    ];
    for (const [command, handler, fn, payload, kind] of cases) {
      rpc.mockClear();
      rpc.mockResolvedValueOnce({ data: outcome("assigned", kind), error: null });
      const response = await handler(post({ request_key: `${key}-${command}`, expected_revision: revision, payload }) as never, params(issueId) as never);
      expect(response.status).toBe(200);
      expect(rpc).toHaveBeenCalledExactlyOnceWith(fn, { p_issue: issueId, p_request_key: `${key}-${command}`, p_expected_revision: revision, p_payload: payload });
      const body = await response.json();
      expect(body).toEqual({ outcome: "event", issue: { id: issueId, status: "assigned", issue_revision: "b".repeat(64) }, event: { id: "event-1", event_kind: kind }, replayed: false });
      expect(JSON.stringify(body)).not.toContain("request_hash");
    }
    expect(revalidateOperationsActor).toHaveBeenCalledTimes(cases.length);
  });

  it("reports a replayed command as such", async () => {
    rpc.mockResolvedValueOnce({ data: { ...outcome("waiting", "waiting"), replayed: true }, error: null });
    const response = await WAIT(post({ request_key: key, expected_revision: revision, payload: { reason: "Part on order", follow_up_at: "2999-01-01T12:00:00Z" } }), params(issueId));
    expect((await response.json()).replayed).toBe(true);
  });

  it("maps stale revisions, wrong status and ownership rules to conflicts with the plain message", async () => {
    const body = { request_key: key, expected_revision: revision, payload: { resolution_summary: "Done" } };
    for (const message of ["Issue changed since it was read", "Issue is resolved", "Issue cannot wait from this state", "This request was already saved with different content"]) {
      rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message } });
      const response = await RESOLVE(post(body), params(issueId));
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: message, outcome: "conflict" });
    }
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "Issue is already accepted" } });
    expect(await (await ACCEPT(post({ request_key: key, expected_revision: revision, payload: {} }), params(issueId))).json()).toEqual({ error: "Issue is already accepted", outcome: "conflict" });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "22023", message: "Covering for a current owner requires cover_reason" } });
    const cover = await ACCEPT(post({ request_key: key, expected_revision: revision, payload: {} }), params(issueId));
    expect(cover.status).toBe(400);
    expect(await cover.json()).toEqual({ error: "Covering for a current owner requires cover_reason", outcome: "validation" });
  });

  it("refuses a body that is not JSON before any read", async () => {
    const response = await RESUME(new Request("https://local.test/issue", { method: "POST", body: "{not json" }) as never, params(issueId));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid request", outcome: "validation" });
    expect(from).not.toHaveBeenCalled();
  });

  it("maps database validation and denial classes and never echoes unexpected detail", async () => {
    const body = { request_key: key, expected_revision: revision, payload: { owner_user_id: userId } };
    rpc.mockResolvedValueOnce({ data: null, error: { code: "22023", message: "Owner is not current staff at this site" } });
    expect(await (await ASSIGN(post(body), params(issueId))).json()).toEqual({ error: "Owner is not current staff at this site", outcome: "validation" });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "Operation unavailable" } });
    const denied = await ASSIGN(post(body), params(issueId));
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "Operation unavailable", outcome: "denied" });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "internal sentinel-9f3c" } });
    const uncertain = await ASSIGN(post(body), params(issueId));
    expect(uncertain.status).toBe(500);
    const text = JSON.stringify(await uncertain.json());
    expect(text).not.toContain("sentinel-9f3c");
    expect(text).toContain("uncertain");
    expect(logError).toHaveBeenCalled();
    rpc.mockResolvedValueOnce({ data: { issue: { id: issueId } }, error: null });
    expect((await ASSIGN(post(body), params(issueId))).status).toBe(500);
  });
});
