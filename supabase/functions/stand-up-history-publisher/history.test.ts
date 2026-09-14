import {
  buildHistoryItems,
  HISTORY_REFRESH_MILLISECONDS,
  HISTORY_WEEKS,
  type HistoryLease,
  type HistoryPending,
  historyRange,
  type HistoryStore,
  MAX_SENDS_PER_RUN,
  runHistoryPublisher,
} from "./history.ts";
import { handleStandUpHistoryPublisher } from "./handler.ts";
import { type HistoryRpcClient, SupabaseHistoryStore } from "./rpc.ts";
import {
  METRIC_KEYS,
  PublisherError,
  signIngest,
  stableStringify,
} from "../stand-up-publisher/publisher.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, message: string) {
  if (stableStringify(actual) !== stableStringify(expected)) {
    throw new Error(
      `${message}: ${stableStringify(actual)} !== ${stableStringify(expected)}`,
    );
  }
}

const IDS = {
  org: "00000000-0000-4000-8000-000000000001",
  homewood: "00000000-0000-4000-8000-000000000101",
  oakridge: "00000000-0000-4000-8000-000000000102",
  rising: "00000000-0000-4000-8000-000000000103",
  plantation: "00000000-0000-4000-8000-000000000104",
  grande: "00000000-0000-4000-8000-000000000105",
  run: "00000000-0000-4000-8000-000000000201",
  token: "00000000-0000-4000-8000-000000000202",
} as const;

const MAP = {
  Homewood: IDS.homewood,
  Oakridge: IDS.oakridge,
  "Rising Oaks": IDS.rising,
  Plantation: IDS.plantation,
  "Grande Cypress": IDS.grande,
};

const FACILITY_ROWS = [
  { id: IDS.homewood, name: "Homewood Lodge, ALF" },
  { id: IDS.oakridge, name: "Oakridge ALF" },
  { id: IDS.rising, name: "Rising Oaks ALF" },
  { id: IDS.plantation, name: "The Plantation on Summers" },
  { id: IDS.grande, name: "Grande Cypress ALF" },
];

function values(changes: Record<string, number | null> = {}) {
  return {
    ...Object.fromEntries(METRIC_KEYS.map((key) => [key, null])),
    ...changes,
  };
}

function snapshot(week: string, kind: 0 | 1 | 2, census = 12) {
  return {
    week_start: week,
    kind,
    facilities: FACILITY_ROWS,
    reports: [{
      facility_id: IDS.homewood,
      week_start: week,
      status: "submitted",
      version: 3,
      values: values({
        current_total_census: census,
        overtime_reported: 2.3,
      }),
      source_as_of: `${week}T13:00:00Z`,
      overtime_minutes: 150,
      overtime_issue: false,
    }],
  };
}

function archive(
  snapshots: unknown[],
  archiveAsOf = "2026-09-13T18:00:00Z",
) {
  return { archive_as_of: archiveAsOf, snapshots };
}

function lease(changes: Partial<HistoryLease> = {}): HistoryLease {
  return {
    leaseToken: IDS.token,
    generation: 7,
    sequence: 0,
    lastSourceAsOf: null,
    facilityMap: MAP,
    fingerprints: {},
    pending: [],
    ...changes,
  };
}

class FakeStore implements HistoryStore {
  stored: HistoryPending[][] = [];
  completed: Array<{
    identity: string;
    sequence: number;
    fingerprint: string;
    receiptId: string;
  }> = [];
  rejected: Array<{ identity: string; sequence: number; status: number }> = [];
  released: Array<{ outcome: string; errorCode?: string }> = [];
  loadCount = 0;

  constructor(
    public currentLease: HistoryLease | null,
    public archiveValue: unknown,
  ) {}

  acquire(_runId: string): Promise<HistoryLease | null> {
    return Promise.resolve(this.currentLease);
  }

  loadArchive(_fromWeek: string, _toWeek: string): Promise<unknown> {
    this.loadCount++;
    return Promise.resolve(this.archiveValue);
  }

  storeQueue(_runId: string, items: HistoryPending[]): Promise<void> {
    this.stored.push(structuredClone(items));
    if (this.currentLease) this.currentLease.pending = structuredClone(items);
    return Promise.resolve();
  }

  completeHead(
    _runId: string,
    identity: string,
    sequence: number,
    fingerprint: string,
    receiptId: string,
  ): Promise<void> {
    this.completed.push({ identity, sequence, fingerprint, receiptId });
    if (this.currentLease) {
      this.currentLease.pending = this.currentLease.pending.slice(1);
      this.currentLease.sequence = sequence;
    }
    return Promise.resolve();
  }

  rejectHead(
    _runId: string,
    identity: string,
    sequence: number,
    _fingerprint: string,
    status: number,
  ): Promise<void> {
    this.rejected.push({ identity, sequence, status });
    return Promise.resolve();
  }

  release(
    _runId: string,
    outcome: string,
    errorCode?: string,
  ): Promise<void> {
    this.released.push({ outcome, errorCode });
    return Promise.resolve();
  }
}

const CONFIG = {
  ingestUrl: "https://front-office.example.test/ingest",
  ingestKeyId: "history-key",
  ingestSecret: "s".repeat(32),
};

function receipt(id: string) {
  return new Response(JSON.stringify({ receiptId: id }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

Deno.test("history range is exactly the current reporting week plus 51 prior weeks", () => {
  const range = historyRange(new Date("2026-09-13T18:00:00Z"));
  equal(
    range,
    { fromWeek: "2025-09-22", toWeek: "2026-09-14" },
    "The hosted history export must retain the rolling 52-week window",
  );
  assert(HISTORY_WEEKS === 52, "History window constant must remain explicit");
});

Deno.test("history payload uses the distinct dataset and archive observation time", async () => {
  const built = await buildHistoryItems(
    archive([
      snapshot("2026-09-07", 1, 14),
      snapshot("2026-08-31", 0, 11),
    ]),
    MAP,
    364,
  );
  assert(built.items.length === 2, "Both snapshots must be queued");
  equal(
    built.items.map((item) => item.identity),
    ["2026-08-31:0", "2026-09-07:1"],
    "Snapshots must sort deterministically",
  );
  const payload = JSON.parse(built.items[0].body);
  assert(
    payload.dataset === "standup_weekly_history" && payload.sequence === 364,
    "History must use its distinct dataset and sequence lane",
  );
  assert(
    payload.sourceAsOf === "2026-09-13T18:00:00.000Z",
    "History sourceAsOf must identify the archive observation",
  );
  const rows = Object.fromEntries(
    payload.rows.map((row: { metric: string; value: number }) => [
      row.metric,
      row.value,
    ]),
  );
  assert(
    rows.snapshot_kind === 0 &&
      rows.archive_as_of_epoch === Date.parse("2026-09-13T18:00:00Z") / 1000,
    "Snapshot kind and archive epoch must be explicit",
  );
});

Deno.test("meeting history is unavailable until Monday 09:15 Eastern", async () => {
  let refused = false;
  try {
    await buildHistoryItems(
      archive(
        [snapshot("2026-09-14", 2)],
        "2026-09-14T13:14:59Z",
      ),
      MAP,
      1,
    );
  } catch {
    refused = true;
  }
  assert(refused, "Pre-meeting snapshots must fail closed");
  const built = await buildHistoryItems(
    archive([snapshot("2026-09-14", 2)], "2026-09-14T13:15:00Z"),
    MAP,
    1,
  );
  assert(built.items.length === 1, "The meeting snapshot opens at 09:15");
});

Deno.test("history validation rejects duplicate identities and unreviewed facility IDs", async () => {
  for (
    const bad of [
      archive([
        snapshot("2026-09-07", 0),
        snapshot("2026-09-07", 0),
      ]),
      archive([{
        ...snapshot("2026-09-07", 0),
        reports: [{
          ...snapshot("2026-09-07", 0).reports[0],
          facility_id: "00000000-0000-4000-8000-000000000999",
        }],
      }]),
    ]
  ) {
    let refused = false;
    try {
      await buildHistoryItems(bad, MAP, 1);
    } catch {
      refused = true;
    }
    assert(refused, "Malformed archive data must fail closed");
  }
});

Deno.test("unchanged history waits six hours and filtered rows are resequenced byte-consistently", async () => {
  const now = new Date("2026-09-13T18:00:00Z");
  const value = archive([
    snapshot("2026-08-31", 0, 10),
    snapshot("2026-09-07", 0, 20),
  ]);
  const preview = await buildHistoryItems(value, MAP, 11);
  const store = new FakeStore(
    lease({
      sequence: 10,
      fingerprints: {
        [preview.items[0].identity]: {
          fingerprint: preview.items[0].fingerprint,
          published_at: new Date(
            now.getTime() - HISTORY_REFRESH_MILLISECONDS + 1,
          ).toISOString(),
        },
      },
    }),
    value,
  );
  const sent: Array<{ body: string; signature: string }> = [];
  const result = await runHistoryPublisher(store, CONFIG, {
    now,
    runId: IDS.run,
    fetch: ((_url: string | URL | Request, init?: RequestInit) => {
      sent.push({
        body: String(init?.body),
        signature: new Headers(init?.headers).get("x-ingest-signature") ?? "",
      });
      return Promise.resolve(receipt("history-1"));
    }) as typeof fetch,
  });
  assert(result.accepted === 1, "Only the changed identity should publish");
  assert(
    store.stored.length === 1 && store.stored[0].length === 1,
    "Queue first",
  );
  const queued = store.stored[0][0];
  assert(
    queued.identity === "2026-09-07:0" && queued.sequence === 11,
    "A filtered due row must reuse the next contiguous durable sequence",
  );
  assert(
    JSON.parse(queued.body).sequence === 11 && sent[0].body === queued.body,
    "Stored, signed, and transmitted history bytes must agree on sequence",
  );
  const sentAt = Math.floor(now.getTime() / 1000).toString();
  assert(
    sent[0].signature ===
      await signIngest(
        CONFIG.ingestSecret,
        CONFIG.ingestKeyId,
        sentAt,
        queued.body,
      ),
    "HMAC must cover the exact queued TEXT body",
  );
  assert(
    queued.first_sent_at === now.toISOString(),
    "Queue audit time must be the first attempted run, not archive generation",
  );
});

Deno.test("unchanged identity renews only after the six-hour cadence", async () => {
  const now = new Date("2026-09-13T18:00:00Z");
  const value = archive([snapshot("2026-09-07", 0)]);
  const preview = await buildHistoryItems(value, MAP, 21);
  const fingerprint = preview.items[0].fingerprint;
  const recent = new FakeStore(
    lease({
      sequence: 20,
      fingerprints: {
        "2026-09-07:0": {
          fingerprint,
          published_at: new Date(now.getTime() - 60_000).toISOString(),
        },
      },
    }),
    value,
  );
  const unchanged = await runHistoryPublisher(recent, CONFIG, {
    now,
    runId: IDS.run,
    fetch: (() => {
      throw new Error("unchanged history must not call Front Office");
    }) as typeof fetch,
  });
  assert(
    unchanged.outcome === "unchanged" && recent.stored.length === 0,
    "Recent unchanged history must stay quiet",
  );

  const renewal = new FakeStore(
    lease({
      sequence: 20,
      fingerprints: {
        "2026-09-07:0": {
          fingerprint,
          published_at: new Date(
            now.getTime() - HISTORY_REFRESH_MILLISECONDS,
          ).toISOString(),
        },
      },
    }),
    value,
  );
  await runHistoryPublisher(renewal, CONFIG, {
    now,
    runId: IDS.run,
    fetch: (() => Promise.resolve(receipt("renewed"))) as typeof fetch,
  });
  assert(
    renewal.stored[0]?.length === 1,
    "The same fingerprint must renew at the exact six-hour boundary",
  );
});

Deno.test("unknown provider outcome retries the exact durable TEXT before reading new history", async () => {
  const body = '{"dataset":"standup_weekly_history","sequence":41,"z":1}';
  const pending: HistoryPending = {
    identity: "2026-09-07:0",
    body,
    fingerprint: "a".repeat(64),
    sequence: 41,
    source_as_of: "2026-09-13T18:00:00Z",
    first_sent_at: "2026-09-13T18:00:00Z",
  };
  const store = new FakeStore(
    lease({ sequence: 40, pending: [pending] }),
    archive([]),
  );
  const sent: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    let failed = false;
    try {
      await runHistoryPublisher(store, CONFIG, {
        now: new Date("2026-09-13T18:00:00Z"),
        runId: IDS.run,
        fetch: ((_url: string | URL | Request, init?: RequestInit) => {
          sent.push(String(init?.body));
          return Promise.reject(new Error("connection reset"));
        }) as typeof fetch,
      });
    } catch (error) {
      failed = error instanceof PublisherError &&
        error.code === "front_office_outcome_unknown";
    }
    assert(failed, "An unknown provider outcome must surface for retry");
  }
  equal(sent, [body, body], "Every replay must use byte-identical saved TEXT");
  assert(
    store.loadCount === 0,
    "Pending history must drain before archive export",
  );
  assert(
    store.released.every((item) => item.outcome === "outcome_unknown"),
    "Unknown sends must be auditable without clearing pending",
  );
});

Deno.test("a run drains at most two durable history items and leaves backlog", async () => {
  const pending = [0, 1, 2].map((offset): HistoryPending => {
    const sequence = 51 + offset;
    return {
      identity: `2026-08-${String(18 + offset * 7).padStart(2, "0")}:0`,
      body: stableStringify({
        dataset: "standup_weekly_history",
        sequence,
      }),
      fingerprint: String(offset + 1).repeat(64),
      sequence,
      source_as_of: "2026-09-13T18:00:00Z",
      first_sent_at: "2026-09-13T18:00:00Z",
    };
  });
  const store = new FakeStore(
    lease({ sequence: 50, pending }),
    archive([]),
  );
  const result = await runHistoryPublisher(store, CONFIG, {
    now: new Date("2026-09-13T18:00:00Z"),
    runId: IDS.run,
    fetch: (() => Promise.resolve(receipt("ok"))) as typeof fetch,
  });
  assert(
    result.outcome === "backlog" && result.accepted === MAX_SENDS_PER_RUN &&
      result.pending === 1,
    "A 50-second lease must bound provider sends per run",
  );
  assert(store.loadCount === 0, "A backlog must block loading newer history");
});

Deno.test("all provider HTTP failures retain and fence the history head", async () => {
  for (const status of [422, 503]) {
    const sequence = 61;
    const pending: HistoryPending = {
      identity: "2026-09-07:0",
      body: stableStringify({
        dataset: "standup_weekly_history",
        sequence,
      }),
      fingerprint: "b".repeat(64),
      sequence,
      source_as_of: "2026-09-13T18:00:00Z",
      first_sent_at: "2026-09-13T18:00:00Z",
    };
    const store = new FakeStore(
      lease({ sequence: 60, pending: [pending] }),
      archive([]),
    );
    let code = "";
    try {
      await runHistoryPublisher(store, CONFIG, {
        now: new Date("2026-09-13T18:00:00Z"),
        runId: IDS.run,
        fetch: (() =>
          Promise.resolve(new Response("no", { status }))) as typeof fetch,
      });
    } catch (error) {
      code = error instanceof PublisherError ? error.code : "wrong";
    }
    assert(
      store.rejected[0]?.status === status && store.completed.length === 0,
      `HTTP ${status} must record rejection without completing the head`,
    );
    assert(
      code ===
        (status === 422 ? "front_office_rejected" : "front_office_retryable"),
      "Definite and retryable HTTP outcomes must stay distinguishable",
    );
    assert(
      store.released[0]?.outcome ===
        (status === 422 ? "rejected" : "outcome_unknown"),
      "Release outcome must match the retained-head failure class",
    );
  }
});

Deno.test("history RPC adapter passes the acquired generation through every mutation", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client: HistoryRpcClient = {
    rpc(name, args) {
      calls.push({ name, args });
      if (name === "stand_up_history_publisher_acquire") {
        return Promise.resolve({
          data: {
            acquired: true,
            lease_token: IDS.token,
            generation: 9,
            sequence: 70,
            last_source_as_of: null,
            facility_map: MAP,
            fingerprints: {},
            pending: [],
          },
          error: null,
        });
      }
      if (name === "stand_up_history_publisher_store_queue") {
        return Promise.resolve({
          data: { stored: true, count: 1 },
          error: null,
        });
      }
      return Promise.resolve({ data: {}, error: null });
    },
  };
  const store = new SupabaseHistoryStore(client, IDS.org);
  const acquired = await store.acquire(IDS.run);
  assert(acquired?.generation === 9, "Acquire generation must be retained");
  const queued: HistoryPending = {
    identity: "2026-09-07:1",
    body: stableStringify({
      dataset: "standup_weekly_history",
      sequence: 71,
    }),
    fingerprint: "c".repeat(64),
    sequence: 71,
    source_as_of: "2026-09-13T18:00:00Z",
    first_sent_at: "2026-09-13T18:01:00Z",
  };
  await store.storeQueue(IDS.run, [queued]);
  await store.completeHead(
    IDS.run,
    queued.identity,
    queued.sequence,
    queued.fingerprint,
    "receipt",
  );
  await store.rejectHead(
    IDS.run,
    queued.identity,
    queued.sequence,
    queued.fingerprint,
    503,
  );
  await store.release(IDS.run, "accepted");
  for (const call of calls.slice(1)) {
    if (call.name === "stand_up_export_history") continue;
    assert(
      call.args.p_lease_token === IDS.token && call.args.p_generation === 9,
      `${call.name} must be fenced by the exact lease token and generation`,
    );
  }
  const items = calls.find((call) =>
    call.name === "stand_up_history_publisher_store_queue"
  )?.args.p_items as HistoryPending[];
  assert(
    items[0].body === queued.body && typeof items[0].body === "string",
    "RPC p_items must preserve the exact canonical body as TEXT",
  );
});

Deno.test("history cron secret gates service-role store creation and caller input", async () => {
  let created = 0;
  const response = await handleStandUpHistoryPublisher(
    new Request("https://host/functions/v1/stand-up-history-publisher", {
      method: "POST",
      headers: { "x-cron-secret": "wrong" },
    }),
    { cronSecret: "right", ...CONFIG },
    () => {
      created++;
      return new FakeStore(null, archive([]));
    },
  );
  assert(
    response.status === 401 && created === 0,
    "Auth must precede service role",
  );

  const accepted = await handleStandUpHistoryPublisher(
    new Request("https://host/functions/v1/stand-up-history-publisher", {
      method: "POST",
      headers: {
        "x-cron-secret": "right",
        "content-type": "application/json",
      },
      body: "{}",
    }),
    { cronSecret: "right", ...CONFIG },
    () => {
      created++;
      return new FakeStore(null, archive([]));
    },
  );
  assert(
    accepted.status === 202 && Number(created) === 1,
    "The only accepted caller body is empty scheduling input; scope stays server-side",
  );
});
