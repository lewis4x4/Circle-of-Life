import {
  type AggregateWorkspace,
  buildSourcePayload,
  type DurablePending,
  METRIC_KEYS,
  PublisherError,
  type PublisherLease,
  type PublisherStore,
  reportingWeek,
  runPublisher,
  sha256Hex,
  signIngest,
  stableStringify,
  type StorePendingInput,
} from "./publisher.ts";
import { handleStandUpPublisher } from "./handler.ts";
import { type RpcClient, SupabasePublisherStore } from "./rpc.ts";

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
  batch: "00000000-0000-4000-8000-000000000301",
} as const;

const FACILITY_ROWS = [
  { id: IDS.homewood, name: "Homewood Lodge, ALF" },
  { id: IDS.oakridge, name: "Oakridge ALF" },
  { id: IDS.rising, name: "Rising Oaks ALF" },
  { id: IDS.plantation, name: "The Plantation on Summers" },
  { id: IDS.grande, name: "Grande Cypress ALF" },
];

const MAP = {
  Homewood: IDS.homewood,
  Oakridge: IDS.oakridge,
  "Rising Oaks": IDS.rising,
  Plantation: IDS.plantation,
  "Grande Cypress": IDS.grande,
};

function values(
  changes: Record<string, number | null> = {},
): AggregateWorkspace["reports"][number]["values"] {
  return {
    ...Object.fromEntries(METRIC_KEYS.map((key) => [key, null])),
    ...changes,
  } as AggregateWorkspace["reports"][number]["values"];
}

function workspace(
  reportChanges: Record<string, unknown> = {},
): AggregateWorkspace {
  return {
    facilities: FACILITY_ROWS,
    reports: [{
      facility_id: IDS.homewood,
      week_start: "2026-09-07",
      status: "draft",
      version: 2,
      values: values({ current_total_census: 0, overtime_reported: 17.15 }),
      source_as_of: "2026-09-07T12:00:00Z",
      overtime_minutes: 1035,
      overtime_issue: false,
      ...reportChanges,
    }],
  } as AggregateWorkspace;
}

function rows(payload: ReturnType<typeof buildSourcePayload>) {
  return Object.fromEntries(payload.rows.map((row) => [row.metric, row.value]));
}

Deno.test("source payload matches current contract, preserves zero, and computes HH.MM overtime", () => {
  const payload = buildSourcePayload(
    workspace(),
    MAP,
    "2026-09-07",
    7,
    new Date("2026-09-13T12:00:00Z"),
    IDS.batch,
  );
  const actual = rows(payload);
  assert(
    payload.source === "col" && payload.dataset === "standup_weekly" &&
      payload.contractVersion === 1,
    "Envelope contract must match",
  );
  assert(
    payload.sourceAsOf === "2026-09-07T12:00:00.000Z",
    "Oldest source observation must be retained",
  );
  assert(
    actual.week_of_day === 20703 && actual.expected_facilities === 5,
    "Week and facility dimensions must match",
  );
  assert(
    actual.homewood_current_total_census === 0,
    "A reported zero may not be omitted",
  );
  assert(
    actual.homewood_overtime_minutes === 1035 &&
      actual.homewood_overtime_issue === 0,
    "HH.MM must become exact minutes",
  );
  assert(
    !("homewood_monthly_rent_roll_cents" in actual),
    "Null values must remain absent",
  );
  assert(
    actual.oakridge_reported === 0 && actual.oakridge_ready === 0,
    "Missing reports are explicit",
  );
  assert(
    !stableStringify(payload).includes("updated_at"),
    "Unapproved source metadata must not leak",
  );
});

Deno.test("invalid overtime stays raw and is explicitly marked for review", () => {
  const report = workspace({
    values: values({ current_total_census: 12, overtime_reported: 15.65 }),
    overtime_minutes: null,
    overtime_issue: true,
    field_dispositions: {},
  });
  const actual = rows(
    buildSourcePayload(
      report,
      MAP,
      "2026-09-07",
      1,
      new Date("2026-09-13T12:00:00Z"),
      IDS.batch,
    ),
  );
  assert(
    actual.homewood_overtime_reported === 15.65,
    "Held raw value must remain visible",
  );
  assert(
    actual.homewood_overtime_issue === 1,
    "Invalid minute component must be explicit",
  );
  assert(
    actual.homewood_overtime_reported_state === 3,
    "Field state must require duration review",
  );
  assert(
    !("homewood_overtime_minutes" in actual),
    "Invalid HH.MM must never become minutes",
  );
  let refused = false;
  try {
    buildSourcePayload(
      workspace({ overtime_minutes: 1029 }),
      MAP,
      "2026-09-07",
      1,
      new Date(),
      IDS.batch,
    );
  } catch {
    refused = true;
  }
  assert(refused, "Canonical/source overtime disagreement must fail closed");
});

Deno.test("field dispositions are all-or-none and held unit stays unconverted", () => {
  const report = workspace({
    values: values({ current_total_census: 12 }),
    overtime_minutes: null,
    overtime_issue: false,
    field_dispositions: { overtime_reported: "historical_unit_unconfirmed" },
  });
  const actual = rows(
    buildSourcePayload(
      report,
      MAP,
      "2026-09-07",
      1,
      new Date("2026-09-13T12:00:00Z"),
      IDS.batch,
    ),
  );
  assert(
    actual.field_state_version === 1,
    "Versioned state vocabulary must be declared",
  );
  assert(
    actual.homewood_overtime_reported_state === 2,
    "Held historic unit must stay unconfirmed",
  );
  assert(
    !("homewood_overtime_reported" in actual),
    "Held null source has no invented numeric value",
  );
  assert(
    METRIC_KEYS.every((key) => `${"homewood"}_${key}_state` in actual),
    "Every reported facility field needs state",
  );
});

Deno.test("protected source-header mapping is required and never inferred from live display names", () => {
  const wrong = { ...MAP, Homewood: IDS.oakridge };
  let refused = false;
  try {
    buildSourcePayload(
      workspace(),
      wrong,
      "2026-09-07",
      1,
      new Date("2026-09-13T12:00:00Z"),
      IDS.batch,
    );
  } catch {
    refused = true;
  }
  assert(refused, "Duplicate or unreviewed facility mapping must fail closed");
});

Deno.test("Sunday and Monday reporting week follows America/New_York", () => {
  assert(
    reportingWeek(new Date("2026-09-13T23:00:00Z")) === "2026-09-14",
    "Sunday must prepare Monday",
  );
  assert(
    reportingWeek(new Date("2026-09-14T04:00:00Z")) === "2026-09-14",
    "Monday must remain current",
  );
  assert(
    reportingWeek(new Date("2026-11-01T06:00:00Z")) === "2026-11-02",
    "DST Sunday must prepare Monday",
  );
});

Deno.test("canonical JSON and HMAC match the existing worker byte contract", async () => {
  assert(
    stableStringify({ z: [3, { b: 2, a: 1 }], a: true }) ===
      '{"a":true,"z":[3,{"a":1,"b":2}]}',
    "Keys must sort recursively",
  );
  const signature = await signIngest(
    "s".repeat(32),
    "current-key",
    "1000",
    '{"a":1}',
  );
  assert(
    signature ===
      "57a78049f056c4624240f2443fa4c4ee6031c0a4c86467b022bc5cf37eef5727",
    "HMAC vector must match Python worker",
  );
});

class FakeStore implements PublisherStore {
  lease: PublisherLease | null = {
    facilityMap: MAP,
    sequence: 0,
    lastFingerprint: null,
    lastAdmittedAt: null,
    pending: null,
  };
  workspace = workspace();
  saved: StorePendingInput[] = [];
  completed: Array<
    { receiptId: string; replayed: boolean; admittedAt: string | null }
  > = [];
  rejected: Array<{ status: number; definite: boolean }> = [];
  releases: Array<{ outcome: string; error?: string }> = [];

  acquire(): Promise<PublisherLease | null> {
    return Promise.resolve(this.lease);
  }
  loadWorkspace(): Promise<AggregateWorkspace> {
    return Promise.resolve(this.workspace);
  }
  storePending(
    _runId: string,
    pending: StorePendingInput,
  ): Promise<DurablePending> {
    this.saved.push(structuredClone(pending));
    return Promise.resolve({
      body: pending.body,
      fingerprint: pending.fingerprint,
      sequence: pending.sequence,
      first_sent_at: pending.firstSentAt,
    });
  }
  complete(
    _runId: string,
    receiptId: string,
    replayed: boolean,
    admittedAt: string | null,
  ): Promise<void> {
    this.completed.push({ receiptId, replayed, admittedAt });
    return Promise.resolve();
  }
  reject(_runId: string, status: number, definite: boolean): Promise<void> {
    this.rejected.push({ status, definite });
    return Promise.resolve();
  }
  release(_runId: string, outcome: string, error?: string): Promise<void> {
    this.releases.push({ outcome, error });
    return Promise.resolve();
  }
}

function acceptedReceipt(replayed = false) {
  return new Response(JSON.stringify({ receiptId: "receipt-1", replayed }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

Deno.test("unchanged content is suppressed for 240 seconds and renewed without freshening source", async () => {
  const store = new FakeStore();
  let firstBody = "";
  const first = await runPublisher(store, {
    ingestUrl: "https://front.invalid/ingest",
    ingestKeyId: "current-key",
    ingestSecret: "s".repeat(32),
  }, {
    now: new Date("2026-09-13T12:00:00Z"),
    runId: IDS.run,
    week: "2026-09-07",
    batchId: IDS.batch,
    fetch: (_input, init) => {
      firstBody = String((init as { body?: BodyInit } | undefined)?.body);
      return Promise.resolve(acceptedReceipt());
    },
  });
  assert(first.outcome === "accepted", "First batch must publish");
  const firstPending = store.saved[0];
  store.lease = {
    facilityMap: MAP,
    sequence: 1,
    lastFingerprint: firstPending.fingerprint,
    lastAdmittedAt: new Date("2026-09-13T12:00:00Z").toISOString(),
    pending: null,
  };
  const suppressed = await runPublisher(store, {
    ingestUrl: "https://front.invalid/ingest",
    ingestKeyId: "current-key",
    ingestSecret: "s".repeat(32),
  }, {
    now: new Date("2026-09-13T12:03:59Z"),
    runId: IDS.run,
    week: "2026-09-07",
    fetch: () => {
      throw new Error("Must not fetch");
    },
  });
  assert(
    suppressed.outcome === "unchanged" && store.saved.length === 1,
    "Unchanged fresh feed must skip transport",
  );
  const renewedBatch = "00000000-0000-4000-8000-000000000302";
  let renewedBody = "";
  await runPublisher(store, {
    ingestUrl: "https://front.invalid/ingest",
    ingestKeyId: "current-key",
    ingestSecret: "s".repeat(32),
  }, {
    now: new Date("2026-09-13T12:04:00Z"),
    runId: IDS.run,
    week: "2026-09-07",
    batchId: renewedBatch,
    fetch: (_input, init) => {
      renewedBody = String((init as { body?: BodyInit } | undefined)?.body);
      return Promise.resolve(acceptedReceipt());
    },
  });
  const firstPayload = JSON.parse(firstBody);
  const renewedPayload = JSON.parse(renewedBody);
  equal(
    renewedPayload.rows,
    firstPayload.rows,
    "Renewal rows must remain identical",
  );
  assert(
    renewedPayload.sourceAsOf === firstPayload.sourceAsOf,
    "Renewal may not freshen source observation",
  );
  assert(
    renewedPayload.sequence === 2 &&
      renewedPayload.batchId !== firstPayload.batchId,
    "Renewal needs a new idempotency identity",
  );
});

Deno.test("unknown outcome retains and replays exact durable body", async () => {
  const store = new FakeStore();
  let firstBody = "";
  let failed = false;
  try {
    await runPublisher(store, {
      ingestUrl: "https://front.invalid/ingest",
      ingestKeyId: "key",
      ingestSecret: "s".repeat(32),
    }, {
      now: new Date("2026-09-13T12:00:00Z"),
      runId: IDS.run,
      week: "2026-09-07",
      batchId: IDS.batch,
      fetch: (_input, init) => {
        firstBody = String((init as { body?: BodyInit } | undefined)?.body);
        throw new TypeError("network unknown");
      },
    });
  } catch {
    failed = true;
  }
  assert(
    failed && store.saved.length === 1 && store.completed.length === 0,
    "Unknown result must retain pending without advancing",
  );
  const saved = store.saved[0];
  store.lease = {
    facilityMap: MAP,
    sequence: 0,
    lastFingerprint: null,
    lastAdmittedAt: null,
    pending: {
      body: saved.body,
      fingerprint: saved.fingerprint,
      sequence: saved.sequence,
      first_sent_at: saved.firstSentAt,
    },
  };
  let replayBody = "";
  await runPublisher(store, {
    ingestUrl: "https://front.invalid/ingest",
    ingestKeyId: "key",
    ingestSecret: "s".repeat(32),
  }, {
    now: new Date("2026-09-13T12:10:00Z"),
    runId: IDS.run,
    fetch: (_input, init) => {
      replayBody = String((init as { body?: BodyInit } | undefined)?.body);
      return Promise.resolve(acceptedReceipt(true));
    },
  });
  assert(
    replayBody === firstBody,
    "Retry must sign and send byte-identical saved body",
  );
  assert(
    store.completed[0].admittedAt === "2026-09-13T12:00:00.000Z",
    "Replay uses conservative first-attempt admission bound",
  );
});

Deno.test("lease release failure never masks the primary provider failure", async () => {
  const store = new FakeStore();
  store.release = () => Promise.reject(new Error("database lease detail"));
  let failure: unknown;
  try {
    await runPublisher(store, {
      ingestUrl: "https://front.invalid/ingest",
      ingestKeyId: "key",
      ingestSecret: "s".repeat(32),
    }, {
      now: new Date("2026-09-13T12:00:00Z"),
      runId: IDS.run,
      week: "2026-09-07",
      batchId: IDS.batch,
      fetch: () => {
        throw new TypeError("provider transport detail");
      },
    });
  } catch (error) {
    failure = error;
  }
  assert(
    failure instanceof PublisherError &&
      failure.code === "front_office_outcome_unknown",
    "Primary unknown outcome classification must survive release cleanup failure",
  );
});

Deno.test("definite receiver rejection clears via rejection RPC while 5xx remains retryable", async () => {
  for (const [status, definite] of [[422, true], [503, false]] as const) {
    const store = new FakeStore();
    let failed = false;
    try {
      await runPublisher(store, {
        ingestUrl: "https://front.invalid/ingest",
        ingestKeyId: "key",
        ingestSecret: "s".repeat(32),
      }, {
        now: new Date("2026-09-13T12:00:00Z"),
        runId: IDS.run,
        week: "2026-09-07",
        batchId: IDS.batch,
        fetch: () => Promise.resolve(new Response("refused", { status })),
      });
    } catch {
      failed = true;
    }
    assert(failed, "Receiver rejection must fail the run");
    equal(
      store.rejected,
      [{ status, definite }],
      "Rejection classification must match worker",
    );
  }
});

Deno.test("RPC adapter passes lease token to every publisher mutation and never to aggregate export", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const pendingPayload = buildSourcePayload(
    workspace(),
    MAP,
    "2026-09-07",
    1,
    new Date("2026-09-13T12:00:00Z"),
    IDS.batch,
  );
  const pendingBody = stableStringify(pendingPayload);
  const fingerprint = await sha256Hex(
    stableStringify({
      rows: pendingPayload.rows,
      sourceAsOf: pendingPayload.sourceAsOf,
    }),
  );
  const client: RpcClient = {
    rpc(name, args) {
      calls.push({ name, args });
      if (name === "stand_up_publisher_acquire") {
        return Promise.resolve({
          data: {
            acquired: true,
            lease_token: "lease-secret",
            generation: 7,
            facility_map: MAP,
            sequence: 0,
            last_fingerprint: null,
            last_admitted_at: null,
            pending: null,
          },
          error: null,
        });
      }
      if (name === "stand_up_export_aggregate") {
        return Promise.resolve({ data: workspace(), error: null });
      }
      if (name === "stand_up_publisher_store_pending") {
        return Promise.resolve({
          data: { stored: true, sequence: 1 },
          error: null,
        });
      }
      return Promise.resolve({ data: {}, error: null });
    },
  };
  const adapter = new SupabasePublisherStore(client, IDS.org);
  await adapter.acquire(IDS.run);
  await adapter.loadWorkspace("2026-09-07");
  await adapter.storePending(IDS.run, {
    body: pendingBody,
    fingerprint,
    sequence: 1,
    firstSentAt: "2026-09-13T12:00:00Z",
  });
  await adapter.complete(IDS.run, "receipt", false, "2026-09-13T12:00:00Z");
  await adapter.reject(IDS.run, 503, false);
  await adapter.release(IDS.run, "failed", "test");
  for (
    const call of calls.filter((call) =>
      call.name.startsWith("stand_up_publisher_") &&
      call.name !== "stand_up_publisher_acquire"
    )
  ) {
    assert(
      call.args.p_lease_token === "lease-secret",
      `${call.name} must carry the acquired lease token`,
    );
    assert(
      call.args.p_generation === 7,
      `${call.name} must carry the acquired generation fence`,
    );
  }
  const aggregate = calls.find((call) =>
    call.name === "stand_up_export_aggregate"
  )!;
  assert(
    aggregate.args.p_organization_id === IDS.org &&
      !("p_lease_token" in aggregate.args),
    "Only fixed server organization reaches export RPC",
  );
});

Deno.test("HTTP handler enforces dedicated cron secret before constructing service store", async () => {
  const environment = {
    cronSecret: "cron-secret",
    ingestUrl: "https://front.invalid/ingest",
    ingestKeyId: "key",
    ingestSecret: "s".repeat(32),
  };
  let constructed = 0;
  const factory = () => {
    constructed++;
    throw new Error("must not construct");
  };
  const unauthorized = await handleStandUpPublisher(
    new Request("https://haven.invalid", { method: "POST" }),
    environment,
    factory,
  );
  assert(
    unauthorized.status === 401 && constructed === 0,
    "Missing secret must stop before service role construction",
  );
  const selected = await handleStandUpPublisher(
    new Request("https://haven.invalid", {
      method: "POST",
      headers: { "x-cron-secret": "cron-secret" },
      body: JSON.stringify({ organization_id: IDS.org }),
    }),
    environment,
    factory,
  );
  assert(
    selected.status === 400 && constructed === 0,
    "Request may not select organization or publisher config",
  );
});
