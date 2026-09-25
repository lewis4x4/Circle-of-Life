import {
  buildSourcePayload,
  FACILITIES,
  PublisherError,
  reportingWeek,
  sha256Hex,
  signIngest,
  type SourcePayload,
  stableStringify,
} from "../stand-up-publisher/publisher.ts";

export const HISTORY_REFRESH_MILLISECONDS = 6 * 60 * 60 * 1000;
export const HISTORY_WEEKS = 52;
export const MAX_HISTORY_ITEMS = HISTORY_WEEKS * 3;
export const MAX_SENDS_PER_RUN = 2;

export type HistoryPayload = Omit<SourcePayload, "dataset"> & {
  dataset: "standup_weekly_history";
};

export type HistoryPending = {
  identity: string;
  body: string;
  fingerprint: string;
  sequence: number;
  source_as_of: string;
  first_sent_at: string;
};

export type HistoryFingerprint = {
  fingerprint: string;
  published_at: string;
};

export type HistoryLease = {
  leaseToken?: string;
  generation?: number;
  sequence: number;
  lastSourceAsOf: string | null;
  facilityMap: Record<(typeof FACILITIES)[number], string>;
  fingerprints: Record<string, HistoryFingerprint>;
  pending: HistoryPending[];
};

export interface HistoryStore {
  acquire(runId: string): Promise<HistoryLease | null>;
  loadArchive(fromWeek: string, toWeek: string): Promise<unknown>;
  storeQueue(runId: string, items: HistoryPending[]): Promise<void>;
  completeHead(
    runId: string,
    identity: string,
    sequence: number,
    fingerprint: string,
    receiptId: string,
  ): Promise<void>;
  rejectHead(
    runId: string,
    identity: string,
    sequence: number,
    fingerprint: string,
    status: number,
  ): Promise<void>;
  release(runId: string, outcome: string, errorCode?: string): Promise<void>;
}

export type HistoryConfig = {
  ingestUrl: string;
  ingestKeyId: string;
  ingestSecret: string;
};

export type HistoryResult = {
  outcome: "accepted" | "unchanged" | "busy" | "backlog";
  accepted: number;
  pending?: number;
};

type JsonObject = Record<string, unknown>;

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PublisherError(`Invalid ${label}`);
  }
  return value as JsonObject;
}

function explicitTimestamp(value: unknown, label: string): Date {
  if (
    typeof value !== "string" ||
    !/(?:Z|[+-][0-9]{2}:[0-9]{2})$/i.test(value)
  ) throw new PublisherError(`Explicit timezone ${label} required`);
  const stamp = new Date(value);
  if (!Number.isFinite(stamp.getTime())) {
    throw new PublisherError(`Invalid ${label}`);
  }
  return stamp;
}

function monday(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new PublisherError("Invalid history reporting week");
  }
  const stamp = new Date(`${value}T00:00:00.000Z`);
  if (stamp.toISOString().slice(0, 10) !== value || stamp.getUTCDay() !== 1) {
    throw new PublisherError("Invalid history Monday");
  }
  return value;
}

function subtractDays(value: string, days: number): string {
  const stamp = new Date(`${value}T00:00:00.000Z`);
  stamp.setUTCDate(stamp.getUTCDate() - days);
  return stamp.toISOString().slice(0, 10);
}

export function historyRange(
  now = new Date(),
): { fromWeek: string; toWeek: string } {
  const toWeek = reportingWeek(now);
  return { fromWeek: subtractDays(toWeek, (HISTORY_WEEKS - 1) * 7), toWeek };
}

/**
 * COL-805: the Monday call comes from the meeting schedule. The archive states
 * the call it used (`monday_call_local`, "HH:MM" Eastern); an archive from
 * before that key existed was taken at the seeded 09:15.
 */
export const SEEDED_MONDAY_CALL = "09:15";
export function archiveMondayCall(value: unknown): string {
  if (value === undefined || value === null) return SEEDED_MONDAY_CALL;
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new PublisherError("Invalid Monday call time in history archive");
  }
  return value;
}

export function meetingSnapshotAvailable(week: string, generated: Date, mondayCall = SEEDED_MONDAY_CALL): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(generated);
  const part = (name: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === name)?.value ?? "";
  const localDate = `${part("year")}-${part("month")}-${part("day")}`;
  if (localDate !== week) return localDate > week;
  return `${part("hour")}:${part("minute")}` >= mondayCall;
}

function checkedArchive(value: unknown): {
  generated: Date;
  mondayCall: string;
  snapshots: JsonObject[];
} {
  const archive = object(value, "history archive");
  const generated = explicitTimestamp(
    archive.archive_as_of,
    "archive timestamp",
  );
  if (
    !Array.isArray(archive.snapshots) ||
    archive.snapshots.length > MAX_HISTORY_ITEMS
  ) {
    throw new PublisherError(
      "History archive exceeds 52 weeks and three snapshot kinds",
    );
  }
  return {
    generated,
    mondayCall: archiveMondayCall(archive.monday_call_local),
    snapshots: archive.snapshots.map((item) =>
      object(item, "history snapshot")
    ),
  };
}

export async function buildHistoryItems(
  archiveValue: unknown,
  facilityMap: Record<string, unknown>,
  firstSequence: number,
): Promise<{ generated: Date; items: HistoryPending[] }> {
  if (!Number.isSafeInteger(firstSequence) || firstSequence <= 0) {
    throw new PublisherError("Invalid first history sequence");
  }
  const { generated, mondayCall, snapshots } = checkedArchive(archiveValue);
  const identities = new Set<string>();
  const mappedIds = new Set(Object.values(facilityMap));
  const sorted = [...snapshots].sort((left, right) => {
    const a = `${String(left.week_start)}:${
      String(left.kind).padStart(2, "0")
    }`;
    const b = `${String(right.week_start)}:${
      String(right.kind).padStart(2, "0")
    }`;
    return a.localeCompare(b);
  });
  const items: HistoryPending[] = [];
  for (const snapshot of sorted) {
    const week = monday(snapshot.week_start);
    const kind = snapshot.kind;
    if (
      typeof kind !== "number" || !Number.isInteger(kind) ||
      ![0, 1, 2].includes(kind)
    ) {
      throw new PublisherError("Invalid history snapshot kind");
    }
    if (kind === 2 && !meetingSnapshotAvailable(week, generated, mondayCall)) {
      throw new PublisherError(
        `Meeting snapshot is unavailable before Monday ${mondayCall} Eastern`,
      );
    }
    const identity = `${week}:${kind}`;
    if (identities.has(identity)) {
      throw new PublisherError("Duplicate history week and snapshot kind");
    }
    identities.add(identity);
    if (
      !Array.isArray(snapshot.reports) || snapshot.reports.some((report) => {
        if (
          !report || typeof report !== "object" || Array.isArray(report)
        ) return true;
        const row = report as JsonObject;
        return !mappedIds.has(row.facility_id) || row.week_start !== week;
      })
    ) throw new PublisherError("Unexpected history facility or reporting week");

    const base = buildSourcePayload(
      snapshot,
      facilityMap,
      week,
      firstSequence + items.length,
      generated,
    );
    const rows = [
      ...base.rows,
      { metric: "snapshot_kind", value: kind },
      {
        metric: "archive_as_of_epoch",
        value: Math.floor(generated.getTime() / 1000),
      },
    ];
    const payload: HistoryPayload = {
      ...base,
      dataset: "standup_weekly_history",
      sourceAsOf: generated.toISOString(),
      rows,
    };
    const comparable = rows.filter((row) =>
      row.metric !== "archive_as_of_epoch"
    );
    items.push({
      identity,
      body: stableStringify(payload),
      fingerprint: await sha256Hex(stableStringify(comparable)),
      sequence: payload.sequence,
      source_as_of: payload.sourceAsOf,
      first_sent_at: generated.toISOString(),
    });
  }
  return { generated, items };
}

async function boundedReceipt(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > 65_536) {
    await response.body?.cancel();
    throw new PublisherError(
      "History receipt exceeds size limit",
      "invalid_receipt",
    );
  }
  const reader = response.body?.getReader();
  if (!reader) {
    throw new PublisherError(
      "Missing Front Office history receipt",
      "invalid_receipt",
    );
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 65_536) {
      await reader.cancel();
      throw new PublisherError(
        "History receipt exceeds size limit",
        "invalid_receipt",
      );
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const parsed = object(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    "history receipt",
  );
  if (typeof parsed.receiptId !== "string" || !parsed.receiptId) {
    throw new PublisherError(
      "Missing Front Office history receipt",
      "invalid_receipt",
    );
  }
  return parsed.receiptId;
}

function definiteRejection(status: number): boolean {
  return [400, 401, 403, 404, 409, 413, 415, 422].includes(status);
}

async function sendHead(
  store: HistoryStore,
  config: HistoryConfig,
  runId: string,
  pending: HistoryPending,
  now: Date,
  transport: typeof fetch,
): Promise<string> {
  const sentAt = Math.floor(now.getTime() / 1000).toString();
  const signature = await signIngest(
    config.ingestSecret,
    config.ingestKeyId,
    sentAt,
    pending.body,
  );
  let response: Response;
  try {
    response = await transport(config.ingestUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ingest-key-id": config.ingestKeyId,
        "x-ingest-sent-at": sentAt,
        "x-ingest-signature": signature,
      },
      body: pending.body,
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new PublisherError(
      "Front Office history outcome unknown; pending queue retained",
      "front_office_outcome_unknown",
    );
  }
  if (!response.ok) {
    await store.rejectHead(
      runId,
      pending.identity,
      pending.sequence,
      pending.fingerprint,
      response.status,
    );
    throw new PublisherError(
      "Front Office history publication failed",
      definiteRejection(response.status)
        ? "front_office_rejected"
        : "front_office_retryable",
    );
  }
  let receiptId: string;
  try {
    receiptId = await boundedReceipt(response);
  } catch {
    throw new PublisherError(
      "Invalid Front Office history receipt",
      "invalid_receipt",
    );
  }
  await store.completeHead(
    runId,
    pending.identity,
    pending.sequence,
    pending.fingerprint,
    receiptId,
  );
  return receiptId;
}

export async function runHistoryPublisher(
  store: HistoryStore,
  config: HistoryConfig,
  options: { now?: Date; runId?: string; fetch?: typeof fetch } = {},
): Promise<HistoryResult> {
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new PublisherError("Invalid history publisher time");
  }
  let url: URL;
  try {
    url = new URL(config.ingestUrl);
  } catch {
    throw new PublisherError(
      "Invalid Front Office history URL",
      "invalid_config",
    );
  }
  if (
    url.protocol !== "https:" || url.username || url.password ||
    !config.ingestKeyId.trim()
  ) {
    throw new PublisherError(
      "Invalid Front Office history configuration",
      "invalid_config",
    );
  }
  const runId = options.runId ?? crypto.randomUUID();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      .test(runId)
  ) {
    throw new PublisherError("Invalid history publisher run ID");
  }
  const lease = await store.acquire(runId);
  if (!lease) return { outcome: "busy", accepted: 0 };
  let outcome = "failed";
  let errorCode: string | undefined;
  try {
    let sequence = lease.sequence;
    let lastSourceAsOf = lease.lastSourceAsOf;
    const fingerprints = structuredClone(lease.fingerprints);
    let queue = [...lease.pending];
    let accepted = 0;
    while (queue.length && accepted < MAX_SENDS_PER_RUN) {
      const head = queue[0];
      await sendHead(store, config, runId, head, now, options.fetch ?? fetch);
      sequence = head.sequence;
      lastSourceAsOf = head.source_as_of;
      fingerprints[head.identity] = {
        fingerprint: head.fingerprint,
        published_at: head.source_as_of,
      };
      queue.shift();
      accepted++;
    }
    if (queue.length) {
      outcome = "accepted";
      return { outcome: "backlog", accepted, pending: queue.length };
    }
    if (accepted === MAX_SENDS_PER_RUN) {
      outcome = "accepted";
      return { outcome: "accepted", accepted };
    }

    const range = historyRange(now);
    const archive = await store.loadArchive(range.fromWeek, range.toWeek);
    const built = await buildHistoryItems(
      archive,
      lease.facilityMap,
      sequence + 1,
    );
    if (
      lastSourceAsOf &&
      built.generated <
        explicitTimestamp(lastSourceAsOf, "prior archive timestamp")
    ) {
      throw new PublisherError(
        "Archive generation timestamp regressed; history publication refused",
      );
    }
    const due = built.items.filter((item) => {
      const prior = fingerprints[item.identity];
      if (!prior || prior.fingerprint !== item.fingerprint) return true;
      const published = explicitTimestamp(
        prior.published_at,
        "history publication timestamp",
      );
      return built.generated.getTime() - published.getTime() >=
        HISTORY_REFRESH_MILLISECONDS;
    }).map((item, index) => {
      const nextSequence = sequence + index + 1;
      const payload = object(JSON.parse(item.body), "history payload");
      return {
        ...item,
        sequence: nextSequence,
        body: stableStringify({ ...payload, sequence: nextSequence }),
        first_sent_at: now.toISOString(),
      };
    });
    if (!due.length) {
      outcome = accepted ? "accepted" : "unchanged";
      return { outcome: accepted ? "accepted" : "unchanged", accepted };
    }
    await store.storeQueue(runId, due);
    queue = due;
    while (queue.length && accepted < MAX_SENDS_PER_RUN) {
      const head = queue[0];
      await sendHead(store, config, runId, head, now, options.fetch ?? fetch);
      queue.shift();
      accepted++;
    }
    outcome = "accepted";
    return {
      outcome: queue.length ? "backlog" : "accepted",
      accepted,
      ...(queue.length ? { pending: queue.length } : {}),
    };
  } catch (error) {
    errorCode = error instanceof PublisherError
      ? error.code
      : "history_publisher_failed";
    outcome = errorCode === "front_office_outcome_unknown" ||
        errorCode === "front_office_retryable" ||
        errorCode === "invalid_receipt"
      ? "outcome_unknown"
      : errorCode === "front_office_rejected"
      ? "rejected"
      : "failed";
    throw error;
  } finally {
    try {
      await store.release(runId, outcome, errorCode);
    } catch {
      console.error(
        JSON.stringify({ event: "stand_up_history_release_failed" }),
      );
    }
  }
}
