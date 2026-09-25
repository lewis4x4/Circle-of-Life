/**
 * Calls to /api/admin/document-intake. Every write carries a request key the
 * caller keeps for the life of one user action, so "Try again" replays the
 * same request instead of making a second one.
 */
import type { FilingRow, IntakeCommand, IntakeItem } from "@/lib/document-intake/contracts";

export const INTAKE_API = "/api/admin/document-intake";

export type IntakeOutcome = "validation" | "forbidden" | "missing" | "conflict" | "state" | "retryable" | "unknown";

export class IntakeRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public outcome: IntakeOutcome,
    /** Set by /file failures after prepare: the unfinished filing that can be abandoned. */
    public filingId: string | null = null,
  ) {
    super(message);
  }

  /** 409: the document changed under the reviewer; refetch and show the latest. */
  get isStale(): boolean {
    return this.status === 409;
  }

  get isRetryable(): boolean {
    return this.status === 503 || this.outcome === "retryable" || this.status === 0;
  }
}

export const STALE_MESSAGE = "This document changed — review the latest version.";

export async function intakeFetch<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json", ...init?.headers },
    });
  } catch {
    throw new IntakeRequestError("Haven could not be reached. Check the connection and try again.", 0, "retryable");
  }
  const body = (await response.json().catch(() => null)) as (Record<string, unknown> & { error?: string; outcome?: IntakeOutcome; filing_id?: string }) | null;
  if (!response.ok) {
    const outcome = body?.outcome ?? "unknown";
    const message =
      response.status === 401
        ? "Your session ended. Sign in again to continue."
        : response.status === 403
          ? (body?.error ?? "You do not have access to do this.")
          : (body?.error ?? "The request did not complete. Try again.");
    throw new IntakeRequestError(message, response.status, outcome, typeof body?.filing_id === "string" ? body.filing_id : null);
  }
  return body as T;
}

function post<T>(url: string, body: unknown): Promise<T> {
  return intakeFetch<T>(url, { method: "POST", body: JSON.stringify(body) });
}

export type PrepareUploadBody = {
  request_key: string;
  facility_id: string;
  file_name: string;
  declared_mime: string;
  declared_size_bytes: number;
  declared_sha256: string;
};

export function prepareUpload(body: PrepareUploadBody) {
  return post<{ item: IntakeItem; upload: { path: string; token: string; signedUrl: string } }>(`${INTAKE_API}/uploads`, body);
}

export function finalizeUpload(itemId: string, requestKey: string) {
  return post<{ item: IntakeItem; possible_duplicate_of: string | null }>(`${INTAKE_API}/uploads/${encodeURIComponent(itemId)}/finalize`, {
    request_key: requestKey,
  });
}

export type CommandPayload = {
  reason?: string;
  user_id?: string | null;
  duplicate_of?: string;
  facility_id?: string;
  title?: string;
  accept_possible_duplicate_charge?: boolean;
};

export function sendCommand(item: Pick<IntakeItem, "id" | "revision">, command: IntakeCommand, payload: CommandPayload, requestKey: string) {
  return post<{ item: IntakeItem }>(`${INTAKE_API}/items/${encodeURIComponent(item.id)}/commands`, {
    request_key: requestKey,
    expected_revision: item.revision,
    command,
    payload,
  });
}

/** Release on leave: fire-and-forget, survives page unload. */
export function releaseOnLeave(item: Pick<IntakeItem, "id" | "revision">) {
  try {
    void fetch(`${INTAKE_API}/items/${encodeURIComponent(item.id)}/commands`, {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request_key: crypto.randomUUID(), expected_revision: item.revision, command: "release", payload: {} }),
    }).catch(() => undefined);
  } catch {
    // The claim expires on its own (settings.claim_minutes).
  }
}

export function splitItem(
  item: Pick<IntakeItem, "id" | "revision">,
  plan: { parts: Array<{ pages: number[]; title?: string }>; excluded_pages: number[] },
  requestKey: string,
) {
  return post<{ item: IntakeItem }>(`${INTAKE_API}/items/${encodeURIComponent(item.id)}/split`, {
    request_key: requestKey,
    expected_revision: item.revision,
    ...plan,
  });
}

export type FileBody = {
  catalog_code: string;
  subject_id: string | null;
  requirement_id?: string | null;
  title: string;
  document_date?: string | null;
  expiration_date?: string | null;
};

export function fileItem(item: Pick<IntakeItem, "id" | "revision">, body: FileBody, requestKey: string) {
  return post<{ filing: FilingRow; href: string }>(`${INTAKE_API}/items/${encodeURIComponent(item.id)}/file`, {
    request_key: requestKey,
    expected_revision: item.revision,
    ...body,
  });
}

export function correctFiling(filingId: string, reason: string, requestKey: string) {
  return post<unknown>(`${INTAKE_API}/filings/${encodeURIComponent(filingId)}/correct`, { request_key: requestKey, reason });
}

export function abandonFiling(filingId: string, requestKey: string) {
  return post<unknown>(`${INTAKE_API}/filings/${encodeURIComponent(filingId)}/abandon`, { request_key: requestKey });
}

export function sourceUrl(item: Pick<IntakeItem, "id">, preview = false): string {
  return `${INTAKE_API}/items/${encodeURIComponent(item.id)}/source${preview ? "?preview=1" : ""}`;
}

export type IntakeSummary = {
  facilities: Array<{
    facility_id: string | null;
    pending: number;
    needs_attention: number;
    processing: number;
    overdue: number;
    unassigned: number;
    oldest_waiting: string | null;
  }>;
  /** Empty for anyone who is not a custodian. */
  mailboxes: Array<{
    address: string;
    active: boolean;
    last_sync_succeeded_at: string | null;
    last_error_code: string | null;
    last_error_at: string | null;
  }>;
  stuck_runs: number;
  pending_alert_hours: number;
};

export function loadSummary(signal?: AbortSignal) {
  return intakeFetch<IntakeSummary>(`${INTAKE_API}/summary`, { signal });
}
