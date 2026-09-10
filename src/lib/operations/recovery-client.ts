import type { DraftCommand, DraftOutcome } from "@/lib/operations/recovery";

/**
 * COL-146 client machine for one save on a shared device. Framework-free:
 * the adapters are injected, every transition is synchronous and observable,
 * and the browser keeps nothing but this object's memory. A save runs
 * `saveDraft` → `execute`; a usable answer ends in `saved` (only when the
 * server returned the record) or `rejected` (the draft is discarded); a lost
 * answer ends in `uncertain` and reconciles against the database, which
 * answers `saved`, `unsaved` (retry offered: the server resumes the stored
 * arguments, never edited content), `expired` or `discarded`. When the draft
 * itself cannot reach the server the state is `offline` and the work is
 * explicitly not saved. Nothing here writes to browser storage of any kind.
 */

export type SaveDraftInput = {
  request_key: string;
  command: DraftCommand;
  target_id?: string;
  facility_id?: string;
  arguments: Record<string, unknown>;
};

export type DraftSummary = {
  id: string;
  command: DraftCommand;
  target_id: string | null;
  request_key: string;
  state: string;
  expires_at: string | null;
  created_at?: string;
};

export type SavedRecord = { kind: "receipt" | "issue"; id: string; replayed: boolean };

export type RejectedBody = { error: string; outcome: string; current_receipt_id?: string; [key: string]: unknown };

/** What an adapter learned: a usable success, a usable refusal, or a lost answer. */
export type AdapterAnswer<T> =
  | { kind: "ok"; body: T }
  | { kind: "rejected"; status: number; body: RejectedBody }
  | { kind: "lost"; reason: "network" | "timeout" | "unparseable" };

export type SaveDraftAnswer = { draft: DraftSummary; replayed: boolean };
export type ReconcileAnswer = { outcome: DraftOutcome; draft: DraftSummary; record?: Record<string, unknown> | null };
export type ResumeAnswer = { outcome: "saved"; draft: DraftSummary; reply: Record<string, unknown> };
export type DiscardAnswer = { outcome: "discarded"; draft: DraftSummary };

export type SaveAdapters = {
  saveDraft(input: SaveDraftInput): Promise<AdapterAnswer<SaveDraftAnswer>>;
  execute(input: SaveDraftInput, draft: DraftSummary): Promise<AdapterAnswer<Record<string, unknown>>>;
  reconcile(draftId: string): Promise<AdapterAnswer<ReconcileAnswer>>;
  resume(draftId: string): Promise<AdapterAnswer<ResumeAnswer>>;
  discard(draftId: string): Promise<AdapterAnswer<DiscardAnswer>>;
};

export type SaveState =
  | { kind: "idle" }
  | { kind: "saving_draft"; input: SaveDraftInput }
  | { kind: "submitting"; draft: DraftSummary }
  | { kind: "saved"; draft: DraftSummary | null; record: SavedRecord; reply: Record<string, unknown> }
  | { kind: "rejected"; draft: DraftSummary | null; outcome: string; message: string; current_receipt_id?: string }
  | { kind: "uncertain"; draft: DraftSummary; message: string | null }
  | { kind: "reconciling"; draft: DraftSummary }
  | { kind: "unsaved"; draft: DraftSummary }
  | { kind: "resuming"; draft: DraftSummary }
  | { kind: "offline"; saved: false; message: string }
  | { kind: "expired"; draft: DraftSummary }
  | { kind: "discarded"; draft: DraftSummary };

export type SaveStateKind = SaveState["kind"];

export const OFFLINE_MESSAGE = "Not saved. The server could not be reached and nothing was stored on this device.";
export const OFFLINE_UNCONFIRMED_MESSAGE = "Not saved. The server was reached but did not confirm the request, and nothing was stored on this device.";
export const CHECK_FAILED_MESSAGE = "Could not confirm whether this save landed. Check again before doing anything else.";
export const DRAFT_UNAVAILABLE_MESSAGE = "This save is no longer available to you.";
export const SIGN_IN_AGAIN_MESSAGE = "Sign in again to continue. This save is kept with the server and can be checked after you sign in.";

/** The busy states: an answer is outstanding and no action is offered. */
export const BUSY_STATE_KINDS: readonly SaveStateKind[] = ["saving_draft", "submitting", "reconciling", "resuming"];

export function isBusy(state: SaveState) {
  return BUSY_STATE_KINDS.includes(state.kind);
}

export function draftOf(state: SaveState): DraftSummary | null {
  return "draft" in state ? state.draft : null;
}

function hasId(value: unknown): value is Record<string, unknown> & { id: string } {
  return !!value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string";
}

/**
 * The record a server reply carries: a receipt or an issue in a command
 * reply, a reconciled record `{ kind, id, replayed }`, or the reply nested
 * under a resume. Anything without an identifier is not a record.
 */
export function extractRecord(body: unknown, command?: DraftCommand): SavedRecord | null {
  if (!body || typeof body !== "object") return null;
  const candidate = body as { record?: unknown; reply?: unknown; receipt?: unknown; issue?: unknown; kind?: unknown; id?: unknown; replayed?: unknown };
  if (candidate.record) return extractRecord(candidate.record, command);
  if (candidate.reply) return extractRecord(candidate.reply, command);
  const replayed = candidate.replayed === true;
  if (hasId(candidate.receipt)) return { kind: "receipt", id: candidate.receipt.id, replayed };
  if (hasId(candidate.issue)) return { kind: "issue", id: candidate.issue.id, replayed };
  if ((candidate.kind === "receipt" || candidate.kind === "issue") && typeof candidate.id === "string") return { kind: candidate.kind, id: candidate.id, replayed };
  // A bare receipt or issue row: the draft's command says which kind it is.
  if (command && typeof candidate.id === "string") return { kind: command === "report_issue" ? "issue" : "receipt", id: candidate.id, replayed };
  return null;
}

type Listener = (state: SaveState) => void;

async function answer<T>(call: () => Promise<AdapterAnswer<T>>): Promise<AdapterAnswer<T>> {
  try {
    return await call();
  } catch {
    return { kind: "lost", reason: "network" };
  }
}

/** A refusal the server itself could not vouch for is a lost answer, not a decision. */
function isUsableRefusal(result: AdapterAnswer<unknown>): result is { kind: "rejected"; status: number; body: RejectedBody } {
  return result.kind === "rejected" && result.body.outcome !== "uncertain";
}

/** The session lapsed: no decision on the content was made and the draft survives with the server. */
function isSignInRefusal(result: AdapterAnswer<unknown>): result is { kind: "rejected"; status: 401; body: RejectedBody } {
  return result.kind === "rejected" && result.status === 401;
}

export class PendingSaveMachine {
  private state: SaveState = { kind: "idle" };
  private generation = 0;
  private readonly listeners = new Set<Listener>();

  constructor(private readonly adapters: SaveAdapters) {}

  getState(): SaveState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Drops everything in memory; answers still in flight are ignored when they land. */
  reset() {
    this.generation += 1;
    this.set({ kind: "idle" });
  }

  /** Surface a pending draft the server listed for this actor and check it against the database. */
  async adopt(draft: DraftSummary): Promise<SaveState> {
    if (isBusy(this.state)) return this.state;
    this.set({ kind: "uncertain", draft, message: null });
    return this.reconcile();
  }

  async save(input: SaveDraftInput): Promise<SaveState> {
    if (isBusy(this.state)) return this.state;
    const generation = this.generation;
    this.set({ kind: "saving_draft", input });
    const drafted = await answer(() => this.adapters.saveDraft(input));
    if (!this.current(generation)) return this.state;
    if (drafted.kind === "lost") return this.set({ kind: "offline", saved: false, message: OFFLINE_MESSAGE });
    if (drafted.kind === "rejected" && !isUsableRefusal(drafted)) return this.set({ kind: "offline", saved: false, message: OFFLINE_UNCONFIRMED_MESSAGE });
    if (drafted.kind === "rejected") return this.set(this.rejection(null, drafted.body));
    const draft = drafted.body.draft;
    this.set({ kind: "submitting", draft });
    const executed = await answer(() => this.adapters.execute(input, draft));
    if (!this.current(generation)) return this.state;
    if (isSignInRefusal(executed)) return this.set({ kind: "uncertain", draft, message: SIGN_IN_AGAIN_MESSAGE });
    if (isUsableRefusal(executed)) return this.rejectAndDiscard(generation, draft, executed.body);
    if (executed.kind === "ok") {
      const record = extractRecord(executed.body, draft.command);
      if (record) return this.set({ kind: "saved", draft, record, reply: executed.body });
    }
    this.set({ kind: "uncertain", draft, message: null });
    return this.reconcile();
  }

  /** Ask the database whether the draft's command landed. Read-only and idempotent. */
  async reconcile(): Promise<SaveState> {
    const draft = draftOf(this.state);
    if (!draft || isBusy(this.state) || this.state.kind === "saved" || this.state.kind === "discarded") return this.state;
    const generation = this.generation;
    this.set({ kind: "reconciling", draft });
    const result = await answer(() => this.adapters.reconcile(draft.id));
    if (!this.current(generation)) return this.state;
    if (result.kind === "ok") {
      const record = result.body.outcome === "saved" ? extractRecord(result.body, draft.command) : null;
      if (record) return this.set({ kind: "saved", draft: result.body.draft, record, reply: result.body });
      if (result.body.outcome === "unsaved") return this.set({ kind: "unsaved", draft: result.body.draft });
      if (result.body.outcome === "expired") return this.set({ kind: "expired", draft: result.body.draft });
      if (result.body.outcome === "discarded") return this.set({ kind: "discarded", draft: result.body.draft });
      return this.set({ kind: "uncertain", draft, message: CHECK_FAILED_MESSAGE });
    }
    if (isSignInRefusal(result)) return this.set({ kind: "uncertain", draft, message: SIGN_IN_AGAIN_MESSAGE });
    if (isUsableRefusal(result)) {
      if (result.body.outcome === "expired") return this.set({ kind: "expired", draft });
      if (result.body.outcome === "discarded") return this.set({ kind: "discarded", draft });
      return this.set({ kind: "uncertain", draft, message: result.status === 404 ? DRAFT_UNAVAILABLE_MESSAGE : result.body.error });
    }
    return this.set({ kind: "uncertain", draft, message: CHECK_FAILED_MESSAGE });
  }

  /** Retry the same save: the server executes the stored arguments; edited content is never sent. */
  async retry(): Promise<SaveState> {
    if (this.state.kind !== "unsaved") return this.state;
    const { draft } = this.state;
    const generation = this.generation;
    this.set({ kind: "resuming", draft });
    const result = await answer(() => this.adapters.resume(draft.id));
    if (!this.current(generation)) return this.state;
    if (result.kind === "ok") {
      const record = extractRecord(result.body, draft.command);
      if (record) return this.set({ kind: "saved", draft: result.body.draft, record, reply: result.body.reply });
    } else if (isSignInRefusal(result)) {
      return this.set({ kind: "uncertain", draft, message: SIGN_IN_AGAIN_MESSAGE });
    } else if (isUsableRefusal(result)) {
      if (result.body.outcome === "expired") return this.set({ kind: "expired", draft });
      if (result.body.outcome === "discarded") return this.set({ kind: "discarded", draft });
      // The refusal may be the command's own or a draft-level one (another tab resumed first).
      // The database decides what stands: only an unsaved answer makes it a rejection.
      this.set({ kind: "uncertain", draft, message: null });
      const checked = await this.reconcile();
      if (!this.current(generation)) return this.state;
      return checked.kind === "unsaved" ? this.rejectAndDiscard(generation, draft, result.body) : checked;
    }
    this.set({ kind: "uncertain", draft, message: null });
    return this.reconcile();
  }

  /** Give the draft up. Only a pending draft can be discarded; a saved record stands. */
  async discard(): Promise<SaveState> {
    const draft = draftOf(this.state);
    if (!draft || !(this.state.kind === "uncertain" || this.state.kind === "unsaved" || this.state.kind === "rejected")) return this.state;
    const generation = this.generation;
    const result = await answer(() => this.adapters.discard(draft.id));
    if (!this.current(generation)) return this.state;
    if (result.kind === "ok" || (isUsableRefusal(result) && result.body.outcome === "discarded")) return this.set({ kind: "discarded", draft });
    if (isUsableRefusal(result) && result.body.outcome === "expired") return this.set({ kind: "expired", draft });
    if (isUsableRefusal(result) && this.state.kind === "rejected") return this.state;
    return this.set({ kind: "uncertain", draft, message: isUsableRefusal(result) ? result.body.error : CHECK_FAILED_MESSAGE });
  }

  private async rejectAndDiscard(generation: number, draft: DraftSummary, body: RejectedBody): Promise<SaveState> {
    const rejected = this.set(this.rejection(draft, body));
    await answer(() => this.adapters.discard(draft.id));
    return this.current(generation) ? rejected : this.state;
  }

  private rejection(draft: DraftSummary | null, body: RejectedBody): SaveState {
    return { kind: "rejected", draft, outcome: body.outcome, message: body.error, ...(body.current_receipt_id ? { current_receipt_id: body.current_receipt_id } : {}) };
  }

  private current(generation: number) {
    return generation === this.generation;
  }

  private set(next: SaveState): SaveState {
    this.state = next;
    for (const listener of this.listeners) listener(next);
    return next;
  }
}

export const DRAFTS_PATH = "/api/admin/operations/drafts";

/** The request each command's own route expects; drafts carry exactly these arguments. */
export function commandRequest(input: SaveDraftInput): { url: string; body: Record<string, unknown> } {
  const body = { request_key: input.request_key, ...input.arguments };
  if (input.command === "report_issue") return { url: "/api/admin/operations/issues", body };
  const action = { record_work: "record", verify_work: "verify", correct_work: "correct", reverse_work: "reverse" }[input.command];
  return { url: `/api/admin/operations/occurrences/${input.target_id}/${action}`, body };
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type FetchAdapterOptions = {
  fetch?: FetchLike;
  timeoutMs?: number;
  commandRequest?: typeof commandRequest;
};

/**
 * Adapters over fetch: a network failure or timeout is a lost answer; a
 * JSON body decides; a body that cannot be read is a lost answer on a
 * server failure and a plain refusal otherwise.
 */
export function createFetchAdapters(options: FetchAdapterOptions = {}): SaveAdapters {
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? 15_000;
  const toCommandRequest = options.commandRequest ?? commandRequest;

  async function call<T>(url: string, init: RequestInit): Promise<AdapterAnswer<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(url, { ...init, signal: controller.signal, headers: { "content-type": "application/json", ...(init.headers ?? {}) }, credentials: "same-origin" });
    } catch (error) {
      return { kind: "lost", reason: (error as { name?: string })?.name === "AbortError" ? "timeout" : "network" };
    } finally {
      clearTimeout(timer);
    }
    // Only a JSON body decides. A 2xx that cannot be read may have committed; a non-JSON
    // refusal of any status is not the server's decision on the content. Both are lost answers.
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { kind: "lost", reason: "unparseable" };
    }
    if (response.ok) return { kind: "ok", body: body as T };
    const refusal = body as { error?: unknown; outcome?: unknown };
    if (typeof refusal?.error === "string") {
      return { kind: "rejected", status: response.status, body: { ...(body as Record<string, unknown>), error: refusal.error, outcome: typeof refusal.outcome === "string" ? refusal.outcome : "uncertain" } };
    }
    return { kind: "lost", reason: "unparseable" };
  }

  return {
    saveDraft: (input) => call(DRAFTS_PATH, { method: "POST", body: JSON.stringify(input) }),
    execute: (input) => {
      const request = toCommandRequest(input);
      return call(request.url, { method: "POST", body: JSON.stringify(request.body) });
    },
    reconcile: (draftId) => call(`${DRAFTS_PATH}/${draftId}`, { method: "GET" }),
    resume: (draftId) => call(`${DRAFTS_PATH}/${draftId}/resume`, { method: "POST" }),
    discard: (draftId) => call(`${DRAFTS_PATH}/${draftId}/discard`, { method: "POST" }),
  };
}

/** The actor's own pending drafts, for surfacing an earlier unsaved save after a reload or a new session. */
export async function listPendingDrafts(options: FetchAdapterOptions = {}): Promise<AdapterAnswer<{ drafts: DraftSummary[] }>> {
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  try {
    const response = await fetchImpl(`${DRAFTS_PATH}?state=pending`, { method: "GET", credentials: "same-origin" });
    const body = (await response.json()) as { drafts?: unknown; error?: unknown; outcome?: unknown };
    if (response.ok && Array.isArray(body.drafts)) return { kind: "ok", body: { drafts: body.drafts as DraftSummary[] } };
    return { kind: "rejected", status: response.status, body: { error: typeof body.error === "string" ? body.error : "Drafts unavailable", outcome: typeof body.outcome === "string" ? body.outcome : "uncertain" } };
  } catch {
    return { kind: "lost", reason: "network" };
  }
}
