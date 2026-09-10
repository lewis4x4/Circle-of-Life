import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  CHECK_FAILED_MESSAGE,
  DRAFT_UNAVAILABLE_MESSAGE,
  OFFLINE_MESSAGE,
  OFFLINE_UNCONFIRMED_MESSAGE,
  SIGN_IN_AGAIN_MESSAGE,
  PendingSaveMachine,
  commandRequest,
  createFetchAdapters,
  extractRecord,
  listPendingDrafts,
  type AdapterAnswer,
  type DraftSummary,
  type SaveAdapters,
  type SaveDraftInput,
  type SaveState,
} from "./recovery-client";

const occurrenceId = "55555555-5555-4555-8555-555555555555";
const receiptId = "77777777-7777-4777-8777-777777777777";
const draftId = "99999999-9999-4999-8999-999999999999";
const key = "record:2026-09-10:0001";
const input: SaveDraftInput = { request_key: key, command: "record_work", target_id: occurrenceId, arguments: { payload: { outcome: "performed", values: { run_minutes: 12 } } } };
const draft: DraftSummary = { id: draftId, command: "record_work", target_id: occurrenceId, request_key: key, state: "pending", expires_at: null };
const receiptReply = { outcome: "receipt", receipt: { id: receiptId }, occurrence: { id: occurrenceId }, issue: null, replayed: false };
const ok = <T,>(body: T): AdapterAnswer<T> => ({ kind: "ok", body });
const rejected = (status: number, outcome: string, error: string, extra: Record<string, unknown> = {}): AdapterAnswer<never> => ({ kind: "rejected", status, body: { error, outcome, ...extra } });
const lost: AdapterAnswer<never> = { kind: "lost", reason: "network" };

function adapters(overrides: Partial<SaveAdapters> = {}): SaveAdapters {
  return {
    saveDraft: vi.fn(async () => ok({ draft, replayed: false })),
    execute: vi.fn(async () => ok(receiptReply)),
    reconcile: vi.fn(async () => ok({ outcome: "unsaved" as const, draft })),
    resume: vi.fn(async () => ok({ outcome: "saved" as const, draft: { ...draft, state: "reconciled" }, reply: receiptReply })),
    discard: vi.fn(async () => ok({ outcome: "discarded" as const, draft: { ...draft, state: "discarded" } })),
    ...overrides,
  };
}

function record(machine: PendingSaveMachine) {
  const kinds: string[] = [];
  machine.subscribe((state) => kinds.push(state.kind));
  return kinds;
}

describe("a save with a usable answer", () => {
  it("drafts, executes and lands in saved only with the server's record", async () => {
    const io = adapters();
    const machine = new PendingSaveMachine(io);
    const kinds = record(machine);
    const state = await machine.save(input);
    expect(state).toEqual({ kind: "saved", draft, record: { kind: "receipt", id: receiptId, replayed: false }, reply: receiptReply });
    expect(kinds).toEqual(["saving_draft", "submitting", "saved"]);
    expect(io.saveDraft).toHaveBeenCalledExactlyOnceWith(input);
    expect(io.execute).toHaveBeenCalledExactlyOnceWith(input, draft);
    expect(io.reconcile).not.toHaveBeenCalled();
  });

  it("treats a usable rejection as rejected with the server's class and message, and discards the draft", async () => {
    const io = adapters({ execute: vi.fn(async () => rejected(409, "conflict", "Work is already recorded for this occurrence", { current_receipt_id: receiptId })) });
    const machine = new PendingSaveMachine(io);
    const state = await machine.save(input);
    expect(state).toEqual({ kind: "rejected", draft, outcome: "conflict", message: "Work is already recorded for this occurrence", current_receipt_id: receiptId });
    expect(io.discard).toHaveBeenCalledExactlyOnceWith(draftId);
    expect(io.reconcile).not.toHaveBeenCalled();
  });

  it("never reports saved when a 200 carries no record: it reconciles instead", async () => {
    const io = adapters({ execute: vi.fn(async () => ok({ ok: true })), reconcile: vi.fn(async () => ok({ outcome: "saved" as const, draft: { ...draft, state: "reconciled" }, record: { kind: "receipt", id: receiptId, replayed: true } })) });
    const machine = new PendingSaveMachine(io);
    const kinds = record(machine);
    const state = await machine.save(input);
    expect(state.kind).toBe("saved");
    expect(state.kind === "saved" && state.record).toEqual({ kind: "receipt", id: receiptId, replayed: true });
    expect(kinds).toEqual(["saving_draft", "submitting", "uncertain", "reconciling", "saved"]);
  });
});

describe("a save with a lost answer", () => {
  it("goes uncertain, reconciles and lands in saved when the command had committed", async () => {
    const io = adapters({ execute: vi.fn(async () => lost), reconcile: vi.fn(async () => ok({ outcome: "saved" as const, draft: { ...draft, state: "reconciled" }, record: { kind: "receipt", id: receiptId, replayed: false } })) });
    const machine = new PendingSaveMachine(io);
    const kinds = record(machine);
    const state = await machine.save(input);
    expect(state.kind).toBe("saved");
    expect(kinds).toEqual(["saving_draft", "submitting", "uncertain", "reconciling", "saved"]);
    expect(io.execute).toHaveBeenCalledTimes(1);
  });

  it("treats a server-side uncertain refusal and a thrown adapter as lost answers", async () => {
    const io = adapters({ execute: vi.fn(async () => rejected(500, "uncertain", "Record could not be confirmed; check the occurrence before retrying")) });
    expect((await new PendingSaveMachine(io).save(input)).kind).toBe("unsaved");
    expect(io.discard).not.toHaveBeenCalled();
    const thrown = adapters({ execute: vi.fn(async () => { throw new TypeError("Failed to fetch"); }) });
    expect((await new PendingSaveMachine(thrown).save(input)).kind).toBe("unsaved");
  });

  it("offers a retry when unsaved and resumes the stored draft, never re-sending content", async () => {
    const io = adapters({ execute: vi.fn(async () => lost) });
    const machine = new PendingSaveMachine(io);
    const kinds = record(machine);
    expect((await machine.save(input)).kind).toBe("unsaved");
    const state = await machine.retry();
    expect(state).toEqual({ kind: "saved", draft: { ...draft, state: "reconciled" }, record: { kind: "receipt", id: receiptId, replayed: false }, reply: receiptReply });
    expect(io.resume).toHaveBeenCalledExactlyOnceWith(draftId);
    expect(io.execute).toHaveBeenCalledTimes(1);
    expect(kinds).toEqual(["saving_draft", "submitting", "uncertain", "reconciling", "unsaved", "resuming", "saved"]);
  });

  it("maps a resumed command's refusal to rejected and discards; a lost resume reconciles again", async () => {
    const io = adapters({ execute: vi.fn(async () => lost), resume: vi.fn(async () => rejected(400, "validation", "Recorded values are invalid: run_minutes is required")) });
    const machine = new PendingSaveMachine(io);
    await machine.save(input);
    expect(await machine.retry()).toEqual({ kind: "rejected", draft, outcome: "validation", message: "Recorded values are invalid: run_minutes is required" });
    expect(io.discard).toHaveBeenCalledExactlyOnceWith(draftId);
    const lostResume = adapters({ execute: vi.fn(async () => lost), resume: vi.fn(async () => lost), reconcile: vi.fn().mockResolvedValueOnce(ok({ outcome: "unsaved", draft })).mockResolvedValueOnce(ok({ outcome: "saved", draft, record: { kind: "receipt", id: receiptId, replayed: true } })) });
    const second = new PendingSaveMachine(lostResume);
    await second.save(input);
    expect((await second.retry()).kind).toBe("saved");
    expect(lostResume.reconcile).toHaveBeenCalledTimes(2);
  });

  it("checks the database before treating a resume refusal as a rejection: a second tab ends saved, not rejected", async () => {
    // Tab A: the resume lands.
    const tabA = adapters({ execute: vi.fn(async () => lost) });
    const machineA = new PendingSaveMachine(tabA);
    await machineA.save(input);
    expect((await machineA.retry()).kind).toBe("saved");
    // Tab B: its resume is refused because the draft is no longer pending; reconciliation finds A's record.
    const tabB = adapters({
      execute: vi.fn(async () => lost),
      resume: vi.fn(async () => rejected(409, "conflict", "Draft is not pending")),
      reconcile: vi.fn().mockResolvedValueOnce(ok({ outcome: "unsaved", draft })).mockResolvedValueOnce(ok({ outcome: "saved", draft: { ...draft, state: "reconciled" }, record: { kind: "receipt", id: receiptId, replayed: true } })),
    });
    const machineB = new PendingSaveMachine(tabB);
    expect((await machineB.save(input)).kind).toBe("unsaved");
    const kinds = record(machineB);
    const state = await machineB.retry();
    expect(state.kind).toBe("saved");
    expect(state.kind === "saved" && state.record).toEqual({ kind: "receipt", id: receiptId, replayed: true });
    expect(kinds).toEqual(["resuming", "uncertain", "reconciling", "saved"]);
    expect(tabB.discard).not.toHaveBeenCalled();
    expect(tabB.reconcile).toHaveBeenCalledTimes(2);
  });

  it("lands in expired or discarded when the database says so and refuses to retry from there", async () => {
    const expired = adapters({ execute: vi.fn(async () => lost), reconcile: vi.fn(async () => ok({ outcome: "expired" as const, draft: { ...draft, state: "expired" } })) });
    const machine = new PendingSaveMachine(expired);
    expect((await machine.save(input)).kind).toBe("expired");
    expect((await machine.retry()).kind).toBe("expired");
    expect(expired.resume).not.toHaveBeenCalled();
    const discardedOnResume = adapters({ execute: vi.fn(async () => lost), resume: vi.fn(async () => rejected(409, "discarded", "Draft was discarded")) });
    const second = new PendingSaveMachine(discardedOnResume);
    await second.save(input);
    expect((await second.retry()).kind).toBe("discarded");
    expect(discardedOnResume.discard).not.toHaveBeenCalled();
  });

  it("stays uncertain with a message when the check itself fails or the draft is no longer readable", async () => {
    const io = adapters({ execute: vi.fn(async () => lost), reconcile: vi.fn(async () => lost) });
    const machine = new PendingSaveMachine(io);
    expect(await machine.save(input)).toEqual({ kind: "uncertain", draft, message: CHECK_FAILED_MESSAGE });
    vi.mocked(io.reconcile).mockResolvedValueOnce(rejected(404, "missing", "Draft not found"));
    expect(await machine.reconcile()).toEqual({ kind: "uncertain", draft, message: DRAFT_UNAVAILABLE_MESSAGE });
    vi.mocked(io.reconcile).mockResolvedValueOnce(ok({ outcome: "unsaved", draft }));
    expect((await machine.reconcile()).kind).toBe("unsaved");
  });
});

describe("offline and discard", () => {
  it("is offline with the work explicitly not saved when the draft cannot reach the server", async () => {
    const io = adapters({ saveDraft: vi.fn(async () => lost) });
    const machine = new PendingSaveMachine(io);
    const kinds = record(machine);
    expect(await machine.save(input)).toEqual({ kind: "offline", saved: false, message: OFFLINE_MESSAGE });
    expect(kinds).toEqual(["saving_draft", "offline"]);
    expect(io.execute).not.toHaveBeenCalled();
    // Reached but unconfirmed reads differently from unreachable; both are explicitly not saved.
    const uncertainDraft = adapters({ saveDraft: vi.fn(async () => rejected(503, "uncertain", "Occurrence unavailable")) });
    expect(await new PendingSaveMachine(uncertainDraft).save(input)).toEqual({ kind: "offline", saved: false, message: OFFLINE_UNCONFIRMED_MESSAGE });
    expect(OFFLINE_UNCONFIRMED_MESSAGE).not.toBe(OFFLINE_MESSAGE);
  });

  it("keeps the draft and asks to sign in again when the session lapses, never discarding", async () => {
    const signIn = rejected(401, "denied", "Sign in again to continue.");
    const io = adapters({ execute: vi.fn(async () => signIn) });
    const machine = new PendingSaveMachine(io);
    expect(await machine.save(input)).toEqual({ kind: "uncertain", draft, message: SIGN_IN_AGAIN_MESSAGE });
    vi.mocked(io.reconcile).mockResolvedValueOnce(signIn);
    expect(await machine.reconcile()).toEqual({ kind: "uncertain", draft, message: SIGN_IN_AGAIN_MESSAGE });
    expect((await machine.reconcile()).kind).toBe("unsaved");
    vi.mocked(io.resume).mockResolvedValueOnce(signIn);
    expect(await machine.retry()).toEqual({ kind: "uncertain", draft, message: SIGN_IN_AGAIN_MESSAGE });
    expect(io.discard).not.toHaveBeenCalled();
  });

  it("reports a refused draft as rejected without a draft and without executing", async () => {
    const io = adapters({ saveDraft: vi.fn(async () => rejected(409, "conflict", "This request was already saved with different content")) });
    const state = await new PendingSaveMachine(io).save(input);
    expect(state).toEqual({ kind: "rejected", draft: null, outcome: "conflict", message: "This request was already saved with different content" });
    expect(io.execute).not.toHaveBeenCalled();
  });

  it("discards an unsaved draft on request and refuses to discard a saved record", async () => {
    const io = adapters({ execute: vi.fn(async () => lost) });
    const machine = new PendingSaveMachine(io);
    await machine.save(input);
    expect((await machine.discard()).kind).toBe("discarded");
    expect(io.discard).toHaveBeenCalledExactlyOnceWith(draftId);
    const saved = new PendingSaveMachine(adapters());
    await saved.save(input);
    expect((await saved.discard()).kind).toBe("saved");
    expect((await saved.retry()).kind).toBe("saved");
  });
});

describe("adoption and reset", () => {
  it("adopts a listed pending draft as uncertain and reconciles it", async () => {
    const io = adapters();
    const machine = new PendingSaveMachine(io);
    const kinds = record(machine);
    expect((await machine.adopt(draft)).kind).toBe("unsaved");
    expect(kinds).toEqual(["uncertain", "reconciling", "unsaved"]);
    expect(io.reconcile).toHaveBeenCalledExactlyOnceWith(draftId);
  });

  it("drops everything on reset and ignores the old person's answer when it lands", async () => {
    let release!: (value: AdapterAnswer<Record<string, unknown>>) => void;
    const io = adapters({ execute: vi.fn(() => new Promise<AdapterAnswer<Record<string, unknown>>>((resolve) => { release = resolve; })) });
    const machine = new PendingSaveMachine(io);
    const pending = machine.save(input);
    await vi.waitFor(() => expect(machine.getState().kind).toBe("submitting"));
    machine.reset();
    expect(machine.getState()).toEqual({ kind: "idle" });
    release(ok(receiptReply));
    expect((await pending).kind).toBe("idle");
    expect(machine.getState().kind).toBe("idle");
    expect(io.reconcile).not.toHaveBeenCalled();
  });

  it("refuses a second save while one is in flight", async () => {
    let release!: (value: AdapterAnswer<Record<string, unknown>>) => void;
    const io = adapters({ execute: vi.fn(() => new Promise<AdapterAnswer<Record<string, unknown>>>((resolve) => { release = resolve; })) });
    const machine = new PendingSaveMachine(io);
    const first = machine.save(input);
    await vi.waitFor(() => expect(machine.getState().kind).toBe("submitting"));
    expect((await machine.save(input)).kind).toBe("submitting");
    expect(io.saveDraft).toHaveBeenCalledTimes(1);
    release(ok(receiptReply));
    expect((await first).kind).toBe("saved");
  });
});

describe("records and requests", () => {
  it("extracts a record only when the server named one", () => {
    expect(extractRecord(receiptReply)).toEqual({ kind: "receipt", id: receiptId, replayed: false });
    expect(extractRecord({ outcome: "receipt", issue: { id: draftId }, replayed: true })).toEqual({ kind: "issue", id: draftId, replayed: true });
    expect(extractRecord({ outcome: "saved", draft, record: { kind: "issue", id: draftId, replayed: false } })).toEqual({ kind: "issue", id: draftId, replayed: false });
    expect(extractRecord({ outcome: "saved", draft, reply: receiptReply })).toEqual({ kind: "receipt", id: receiptId, replayed: false });
    expect(extractRecord({ outcome: "saved", draft })).toBeNull();
    expect(extractRecord({ receipt: { completion_state: "completed" } })).toBeNull();
    expect(extractRecord(null)).toBeNull();
  });

  it("derives the kind of a bare record row from the draft's command", () => {
    const bareReceipt = { id: receiptId, completion_state: "completed", recorded_at: "2026-09-10T15:00:00Z" };
    const bareIssue = { id: draftId, status: "open", summary: "Leak" };
    expect(extractRecord({ outcome: "saved", draft, record: bareReceipt }, "record_work")).toEqual({ kind: "receipt", id: receiptId, replayed: false });
    expect(extractRecord({ outcome: "saved", draft, record: bareReceipt }, "correct_work")).toEqual({ kind: "receipt", id: receiptId, replayed: false });
    expect(extractRecord({ outcome: "saved", draft, record: bareIssue }, "report_issue")).toEqual({ kind: "issue", id: draftId, replayed: false });
    expect(extractRecord({ outcome: "saved", draft, record: { kind: "issue", id: draftId, replayed: true } }, "record_work")).toEqual({ kind: "issue", id: draftId, replayed: true });
    // Without a command a bare row is not a record; without an id nothing is.
    expect(extractRecord({ outcome: "saved", draft, record: bareReceipt })).toBeNull();
    expect(extractRecord({ outcome: "saved", draft, record: { status: "open" } }, "report_issue")).toBeNull();
  });

  it("lands in saved when reconciliation returns a bare receipt or issue row", async () => {
    const receiptDraft = adapters({ execute: vi.fn(async () => lost), reconcile: vi.fn(async () => ok({ outcome: "saved" as const, draft: { ...draft, state: "reconciled" }, record: { id: receiptId, completion_state: "completed" } })) });
    const receiptState = await new PendingSaveMachine(receiptDraft).save(input);
    expect(receiptState.kind).toBe("saved");
    expect(receiptState.kind === "saved" && receiptState.record).toEqual({ kind: "receipt", id: receiptId, replayed: false });
    const issueDraft: DraftSummary = { ...draft, command: "report_issue", target_id: null };
    const issueInput: SaveDraftInput = { request_key: key, command: "report_issue", arguments: { payload: { kind: "problem", summary: "Leak" } } };
    const issueAdapters = adapters({ saveDraft: vi.fn(async () => ok({ draft: issueDraft, replayed: false })), execute: vi.fn(async () => lost), reconcile: vi.fn(async () => ok({ outcome: "saved" as const, draft: { ...issueDraft, state: "reconciled" }, record: { id: draftId, status: "open" } })) });
    const issueState = await new PendingSaveMachine(issueAdapters).save(issueInput);
    expect(issueState.kind).toBe("saved");
    expect(issueState.kind === "saved" && issueState.record).toEqual({ kind: "issue", id: draftId, replayed: false });
  });

  it("addresses each command's own route with exactly the drafted arguments", () => {
    expect(commandRequest(input)).toEqual({ url: `/api/admin/operations/occurrences/${occurrenceId}/record`, body: { request_key: key, payload: input.arguments.payload } });
    expect(commandRequest({ ...input, command: "verify_work" }).url).toBe(`/api/admin/operations/occurrences/${occurrenceId}/verify`);
    const correction = { request_key: key, command: "correct_work" as const, target_id: occurrenceId, arguments: { expected_receipt_id: receiptId, expected_receipt_revision: "a".repeat(64), payload: { outcome: "performed", reason: "Wrong reading" } } };
    expect(commandRequest(correction)).toEqual({ url: `/api/admin/operations/occurrences/${occurrenceId}/correct`, body: { request_key: key, ...correction.arguments } });
    expect(commandRequest({ ...correction, command: "reverse_work" }).url).toBe(`/api/admin/operations/occurrences/${occurrenceId}/reverse`);
    expect(commandRequest({ request_key: key, command: "report_issue", arguments: { payload: { kind: "problem" } } })).toEqual({ url: "/api/admin/operations/issues", body: { request_key: key, payload: { kind: "problem" } } });
  });
});

describe("fetch adapters", () => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("returns usable answers for JSON bodies and lost answers for network failures, timeouts and non-JSON server failures", async () => {
    const fetchImpl = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();
    const io = createFetchAdapters({ fetch: fetchImpl, timeoutMs: 50 });
    fetchImpl.mockResolvedValueOnce(json(200, { draft, replayed: false }));
    expect(await io.saveDraft(input)).toEqual({ kind: "ok", body: { draft, replayed: false } });
    expect(fetchImpl).toHaveBeenLastCalledWith("/api/admin/operations/drafts", expect.objectContaining({ method: "POST", body: JSON.stringify(input), credentials: "same-origin" }));
    fetchImpl.mockResolvedValueOnce(json(409, { error: "Work is already recorded", outcome: "conflict", current_receipt_id: receiptId }));
    expect(await io.execute(input, draft)).toEqual({ kind: "rejected", status: 409, body: { error: "Work is already recorded", outcome: "conflict", current_receipt_id: receiptId } });
    expect(fetchImpl).toHaveBeenLastCalledWith(`/api/admin/operations/occurrences/${occurrenceId}/record`, expect.objectContaining({ method: "POST" }));
    fetchImpl.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await io.reconcile(draftId)).toEqual({ kind: "lost", reason: "network" });
    expect(fetchImpl).toHaveBeenLastCalledWith(`/api/admin/operations/drafts/${draftId}`, expect.objectContaining({ method: "GET" }));
    fetchImpl.mockResolvedValueOnce(new Response("<html>Bad gateway</html>", { status: 502 }));
    expect(await io.resume(draftId)).toEqual({ kind: "lost", reason: "unparseable" });
    fetchImpl.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))));
    expect(await io.discard(draftId)).toEqual({ kind: "lost", reason: "timeout" });
    fetchImpl.mockResolvedValueOnce(json(500, { error: "Record could not be confirmed; check the occurrence before retrying", outcome: "uncertain" }));
    expect(await io.execute(input, draft)).toMatchObject({ kind: "rejected", body: { outcome: "uncertain" } });
  });

  it("treats a 2xx that cannot be read and any non-JSON refusal as lost answers, so a committed save is never shown rejected", async () => {
    const fetchImpl = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();
    const io = createFetchAdapters({ fetch: fetchImpl });
    fetchImpl.mockResolvedValueOnce(new Response('{"outcome":"receipt","receipt":{"id":"', { status: 200, headers: { "content-type": "application/json" } }));
    expect(await io.execute(input, draft)).toEqual({ kind: "lost", reason: "unparseable" });
    fetchImpl.mockResolvedValueOnce(new Response("", { status: 200 }));
    expect(await io.execute(input, draft)).toEqual({ kind: "lost", reason: "unparseable" });
    fetchImpl.mockResolvedValueOnce(new Response("<html>Forbidden</html>", { status: 403, headers: { "content-type": "text/html" } }));
    expect(await io.execute(input, draft)).toEqual({ kind: "lost", reason: "unparseable" });
    fetchImpl.mockResolvedValueOnce(json(400, { detail: "no error field" }));
    expect(await io.execute(input, draft)).toEqual({ kind: "lost", reason: "unparseable" });
    // Driven through the machine: the lost answer reconciles instead of discarding.
    const machine = new PendingSaveMachine({ ...adapters(), execute: io.execute });
    fetchImpl.mockResolvedValueOnce(new Response("", { status: 200 }));
    expect((await machine.save(input)).kind).toBe("unsaved");
  });

  it("lists the actor's own pending drafts", async () => {
    const fetchImpl = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>().mockResolvedValueOnce(json(200, { drafts: [draft] }));
    expect(await listPendingDrafts({ fetch: fetchImpl })).toEqual({ kind: "ok", body: { drafts: [draft] } });
    expect(fetchImpl).toHaveBeenCalledWith("/api/admin/operations/drafts?state=pending", expect.objectContaining({ method: "GET" }));
    fetchImpl.mockResolvedValueOnce(json(401, { error: "Sign in again to continue." }));
    expect(await listPendingDrafts({ fetch: fetchImpl })).toMatchObject({ kind: "rejected", status: 401 });
    fetchImpl.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await listPendingDrafts({ fetch: fetchImpl })).toEqual({ kind: "lost", reason: "network" });
  });
});

describe("no browser storage", () => {
  const root = path.resolve(__dirname, "../..");
  const files = [
    "lib/operations/recovery.ts",
    "lib/operations/recovery-client.ts",
    "hooks/use-pending-save.ts",
    "app/(admin)/admin/operations/_components/save-state-notice.tsx",
    "app/api/admin/operations/drafts/route.ts",
    "app/api/admin/operations/drafts/[id]/route.ts",
    "app/api/admin/operations/drafts/[id]/resume/route.ts",
    "app/api/admin/operations/drafts/[id]/discard/route.ts",
  ];
  const forbidden = ["local" + "Storage", "session" + "Storage", "indexed" + "DB", "document." + "cookie", "navigator." + "storage", "caches."];

  it.each(files)("%s keeps nothing on the device", (file) => {
    const source = readFileSync(path.join(root, file), "utf8");
    for (const word of forbidden) expect(source, `${file} mentions ${word}`).not.toContain(word);
  });
});

describe("state invariants", () => {
  it("has no saved state without a record identifier", async () => {
    const io = adapters({
      execute: vi.fn(async () => ok({ outcome: "receipt", receipt: { completion_state: "completed" }, replayed: false })),
      reconcile: vi.fn(async () => ok({ outcome: "saved" as const, draft, record: { kind: "receipt" } })),
    });
    const machine = new PendingSaveMachine(io);
    const seen: SaveState[] = [];
    machine.subscribe((state) => seen.push(state));
    await machine.save(input);
    expect(seen.map((state) => state.kind)).not.toContain("saved");
    expect(machine.getState()).toEqual({ kind: "uncertain", draft, message: CHECK_FAILED_MESSAGE });
  });
});
