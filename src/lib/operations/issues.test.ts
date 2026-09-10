import { describe, expect, it } from "vitest";

import {
  ISSUE_COMMAND_RPC,
  ISSUE_COMMAND_SCHEMAS,
  isIssueEventOutcome,
  issuePayloadProblem,
  mapIssueRpcError,
} from "./issues";

const key = "issue-cmd:2026-09-10:0001";
const revision = "a".repeat(64);
const userId = "22222222-2222-4222-8222-222222222222";
const receiptId = "77777777-7777-4777-8777-777777777777";

function problem(command: keyof typeof ISSUE_COMMAND_SCHEMAS, body: unknown) {
  const parsed = ISSUE_COMMAND_SCHEMAS[command].safeParse(body);
  return parsed.success ? null : issuePayloadProblem(parsed.error);
}

describe("issue lifecycle bodies", () => {
  it("names every command's database function", () => {
    expect(Object.values(ISSUE_COMMAND_RPC)).toEqual([
      "assign_operation_issue_review", "accept_operation_issue_review", "wait_operation_issue_review", "resume_operation_issue_review",
      "resolve_operation_issue_review", "reopen_operation_issue_review", "link_operation_issue_review",
    ]);
  });

  it("requires the issue revision and a well-formed request key on every command", () => {
    expect(problem("accept", { request_key: key, payload: {} })).toBe("expected_revision: Invalid input: expected string, received undefined");
    expect(problem("accept", { request_key: key, expected_revision: "abc", payload: {} })).toBe("expected_revision: expected_revision must be the issue revision");
    expect(problem("accept", { request_key: "short", expected_revision: revision, payload: {} })).toBe("request_key: request_key must be 8 to 128 key characters");
    expect(problem("accept", { request_key: key, expected_revision: revision, payload: {} })).toBeNull();
  });

  it("assignment needs an owner and refuses server-owned or unknown fields", () => {
    expect(problem("assign", { request_key: key, expected_revision: revision, payload: { backup_user_id: userId } })).toBe("Assignment needs an owner");
    expect(problem("assign", { request_key: key, expected_revision: revision, payload: { owner_role: "chef" } })).toContain("owner_role");
    expect(problem("assign", { request_key: key, expected_revision: revision, payload: { owner_user_id: userId, assigned_at: "now" } })).toContain("assigned_at");
    expect(problem("assign", { request_key: key, expected_revision: revision, payload: { owner_role: "maintenance_role", backup_user_id: userId, note: "Generator" } })).toBeNull();
  });

  it("waiting needs a reason and a future follow-up; resolve needs a summary; reopen needs a reason; link needs a receipt", () => {
    expect(problem("wait", { request_key: key, expected_revision: revision, payload: { reason: "Vendor part", follow_up_at: "2020-01-01T00:00:00Z" } })).toBe("follow_up_at must be in the future");
    expect(problem("wait", { request_key: key, expected_revision: revision, payload: { follow_up_at: "2999-01-01T00:00:00Z" } })).toContain("reason");
    expect(problem("wait", { request_key: key, expected_revision: revision, payload: { reason: "Vendor part", follow_up_at: "2999-01-01T00:00:00Z" } })).toBeNull();
    expect(problem("resolve", { request_key: key, expected_revision: revision, payload: { resolution_receipt_id: receiptId } })).toContain("resolution_summary");
    expect(problem("resolve", { request_key: key, expected_revision: revision, payload: { resolution_summary: "  ", resolution_receipt_id: receiptId } })).toContain("resolution_summary");
    expect(problem("resolve", { request_key: key, expected_revision: revision, payload: { resolution_summary: "Belt replaced", resolution_receipt_id: receiptId } })).toBeNull();
    expect(problem("resolve", { request_key: key, expected_revision: revision, payload: { resolution_summary: "x".repeat(4000) } })).toBeNull();
    expect(problem("resolve", { request_key: key, expected_revision: revision, payload: { resolution_summary: "x".repeat(4001) } })).toContain("resolution_summary");
    expect(problem("reopen", { request_key: key, expected_revision: revision, payload: {} })).toContain("reason");
    expect(problem("link", { request_key: key, expected_revision: revision, payload: { receipt_id: "not-a-uuid" } })).toContain("receipt_id");
    expect(problem("accept", { request_key: key, expected_revision: revision, payload: { cover_reason: "" } })).toContain("cover_reason");
  });
});

describe("issue outcome classes", () => {
  it("hides authority denials and reports missing issues", () => {
    expect(mapIssueRpcError({ code: "42501", message: "Operation unavailable: owner secret" }, "assign")).toEqual({ status: 403, outcome: "denied", error: "Operation unavailable" });
    expect(mapIssueRpcError({ code: "P0002", message: "no rows" }, "resolve")).toEqual({ status: 404, outcome: "missing", error: "Issue not found" });
  });

  it("passes every 342 validation wording through and hides internal detail behind the command noun", () => {
    for (const message of [
      "Owner is not current staff at this site", "Backup is not current staff at this site", "Backup must differ from the owner", "An owner user or role is required",
      "Covering for a current owner requires cover_reason", "A waiting reason is required", "follow_up_at must be in the future", "A resolution summary is required",
      "Resolution receipt must be a readable performance receipt for this subject", "Linked receipt must be a readable performance receipt for this subject",
      "receipt_id is required", "A reopen reason is required", "owner_role must be an application role", "note must be text of at most 2000 characters",
    ]) {
      expect(mapIssueRpcError({ code: "22023", message }, "assign")).toEqual({ status: 400, outcome: "validation", error: message });
    }
    expect(mapIssueRpcError({ code: "22023", message: "invalid input syntax for type jsonb at haven.internal_helper" }, "wait")).toEqual({ status: 400, outcome: "validation", error: "Waiting request contains an invalid value" });
    expect(mapIssueRpcError({ code: "23503", message: "violates foreign key constraint" }, "link")).toEqual({ status: 400, outcome: "validation", error: "Receipt link contains an invalid reference or value" });
  });

  it("reports every 342 state, revision and replay refusal verbatim as a conflict", () => {
    for (const message of [
      "Issue changed since it was read", "This request was already saved with different content", "Issue cannot wait from this state", "Issue is resolved",
      "Issue is not assigned", "Issue is not waiting", "Issue is not resolved", "Issue is already accepted", "Issue is already linked to a receipt",
    ]) {
      expect(mapIssueRpcError({ code: "P0001", message }, "accept")).toEqual({ status: 409, outcome: "conflict", error: message });
    }
    // Immutability guards never reach a command reply through the wrappers; if one did, its wording stays hidden.
    expect(mapIssueRpcError({ code: "23514", message: "Issue identity is immutable" }, "assign")).toEqual({ status: 409, outcome: "conflict", error: "Assignment could not be completed. Refresh the issue and retry." });
    expect(mapIssueRpcError({ code: "23505", message: "duplicate key value violates unique constraint operation_issue_events_request_key_key" }, "reopen")).toEqual({ status: 409, outcome: "conflict", error: "Reopen request conflicts with an existing event" });
    expect(mapIssueRpcError({ code: "P0001", message: "trigger raised something internal" }, "resume")).toEqual({ status: 409, outcome: "conflict", error: "Resume request could not be completed. Refresh the issue and retry." });
  });

  it("classifies anything else as uncertain without echoing it", () => {
    const mapped = mapIssueRpcError({ code: "57014", message: "canceling statement due to statement timeout at pg_sleep" }, "resolve");
    expect(mapped).toEqual({ status: 500, outcome: "uncertain", error: "Resolution could not be confirmed; re-read the issue before retrying" });
    expect(mapped.error).not.toContain("pg_sleep");
  });

  it("recognises the command reply shape", () => {
    expect(isIssueEventOutcome({ issue: { id: "i" }, event: { id: "e" }, replayed: true })).toBe(true);
    expect(isIssueEventOutcome({ issue: { id: "i" }, replayed: false })).toBe(false);
    expect(isIssueEventOutcome(null)).toBe(false);
  });
});
