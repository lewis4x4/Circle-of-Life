import { createHash } from "node:crypto";
import { captureQboRead, type QboReadInput } from "./qbo-read.ts";
const encoder = new TextEncoder();
function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function equal(a: unknown, b: unknown) {
  assert(
    JSON.stringify(a) === JSON.stringify(b),
    `${JSON.stringify(a)} != ${JSON.stringify(b)}`,
  );
}
function input(change: Partial<QboReadInput> = {}): QboReadInput {
  return {
    environment: "sandbox",
    companyId: "9341455327810551",
    expectedCompanyId: "9341455327810551",
    minorversion: 75,
    accessToken: "SYNTHETIC_TOKEN_PRIVATE",
    operation: { kind: "account_page", startPosition: 1, maxResults: 1000 },
    ...change,
  };
}
const account = {
  Id: "42",
  SyncToken: "0",
  Active: false,
  Name: "PRIVATE_RESIDENT_CANARY",
  CurrentBalance: 5.25,
};
function page(rows = [account], extra = {}) {
  return {
    QueryResponse: {
      startPosition: 1,
      maxResults: rows.length,
      Account: rows,
      ...extra,
    },
  };
}
function report() {
  return {
    Header: {
      Time: "2026-09-09T01:00:00Z",
      ReportName: "GeneralLedger",
      StartPeriod: "2026-08-01",
      EndPeriod: "2026-08-31",
      ReportBasis: "Accrual",
      Currency: "USD",
      Option: [{ Name: "NoReportData", Value: "false" }],
    },
    Columns: {
      Column: [{ ColTitle: "Account", ColType: "Account" }, {
        ColTitle: "Amount",
        ColType: "Money",
      }],
    },
    Rows: {
      Row: [{
        type: "Section",
        Header: {
          ColData: [{ value: "PRIVATE_RESIDENT_CANARY", id: "42" }, {
            value: "",
          }],
        },
        Rows: {
          Row: [{
            type: "Data",
            ColData: [{ value: "entry", id: "9" }, {
              value: "999999999999999999999.01",
            }],
          }],
        },
        Summary: {
          ColData: [{ value: "Total" }, { value: "999999999999999999999.01" }],
        },
      }],
    },
  };
}
function ledger(): QboReadInput {
  return input({
    operation: {
      kind: "general_ledger",
      startDate: "2026-08-01",
      endDate: "2026-08-31",
      basis: "Accrual",
      currency: "USD",
    },
  });
}
function reply(
  value: unknown,
  status = 200,
  headers: Record<string, string> = {},
): typeof fetch {
  return (() =>
    Promise.resolve(
      new Response(typeof value === "string" ? value : JSON.stringify(value), {
        status,
        headers: { "content-type": "application/json", ...headers },
      }),
    )) as typeof fetch;
}
Deno.test("[HFA-028] Account request is GET fixed host encoded query including inactive", async () => {
  let calls = 0;
  const response = await captureQboRead(
    input(),
    ((url: URL | RequestInfo, init?: RequestInit) => {
      calls++;
      const parsed = new URL(String(url));
      equal(parsed.origin, "https://sandbox-quickbooks.api.intuit.com");
      equal(parsed.pathname, "/v3/company/9341455327810551/query");
      equal(
        parsed.searchParams.get("query"),
        "SELECT * FROM Account WHERE Active IN (true,false) STARTPOSITION 1 MAXRESULTS 1000",
      );
      equal(parsed.searchParams.get("minorversion"), "75");
      equal(init?.method, "GET");
      equal(init?.redirect, "manual");
      assert(!init?.body);
      return reply(page())(url, init);
    }) as typeof fetch,
  );
  assert(response.ok);
  equal(calls, 1);
  equal(response.privateMetadata?.accounts, [{ id: "42", syncToken: "0" }]);
  equal(response.logSummary.scan_complete, false);
});
Deno.test("[HFA-028] Count returns exact safe count and no money", async () => {
  const result = await captureQboRead(
    input({ operation: { kind: "account_count" } }),
    reply({ QueryResponse: { totalCount: 2505 } }),
  );
  assert(result.ok);
  equal(result.privateMetadata?.count, 2505);
});
Deno.test("[HFA-028] Empty page is a live observation only", async () => {
  const result = await captureQboRead(input(), reply({ QueryResponse: {} }));
  assert(result.ok);
  equal(result.privateMetadata?.count, 0);
  equal(result.privateMetadata?.scan_complete, false);
});
Deno.test("[HFA-028] Explicit later offset is retained", async () => {
  const result = await captureQboRead(
    input({
      operation: {
        kind: "account_page",
        startPosition: 1001,
        maxResults: 1000,
      },
    }),
    reply(page([account], { startPosition: 1001 })),
  );
  assert(result.ok);
});
for (
  const [name, change, code] of [
    ["wrong company", { expectedCompanyId: "99" }, "scope_mismatch"],
    [
      "production defaults disabled",
      { environment: "production" },
      "production_disabled",
    ],
    ["invalid environment", { environment: "other" }, "invalid_config"],
    ["company injection", { companyId: "1/query" }, "invalid_config"],
    ["token header injection", { accessToken: "x\r\ny" }, "invalid_config"],
    [
      "unknown operation",
      { operation: { kind: "trial_balance" } },
      "invalid_config",
    ],
    ["zero page", {
      operation: { kind: "account_page", startPosition: 0, maxResults: 1000 },
    }, "invalid_config"],
    ["oversized page", {
      operation: { kind: "account_page", startPosition: 1, maxResults: 1001 },
    }, "invalid_config"],
    ["invalid minorversion", { minorversion: NaN }, "invalid_config"],
    ["invalid byte bound", { maxBytes: Infinity }, "invalid_config"],
  ] as const
) {
  Deno.test(`[HFA-028] ${name} never fetches`, async () => {
    let calls = 0;
    const r = await captureQboRead(
      input(change as Partial<QboReadInput>),
      (() => {
        calls++;
        throw new Error("unexpected");
      }) as typeof fetch,
    );
    equal(r.code, code);
    equal(calls, 0);
  });
}
Deno.test("[HFA-028] Trusted explicit production read chooses production host", async () => {
  const r = await captureQboRead(
    input({ environment: "production", allowProductionRead: true }),
    ((url: URL | RequestInfo) => {
      equal(new URL(String(url)).hostname, "quickbooks.api.intuit.com");
      return reply(page())(url);
    }) as typeof fetch,
  );
  assert(r.ok);
});
for (const status of [301, 302, 307, 308]) {
  Deno.test(`[HFA-028] Redirect ${status} rejected without follow`, async () => {
    const r = await captureQboRead(
      input(),
      reply("PRIVATE_REDIRECT", status, {
        location: "https://example.invalid/",
      }),
    );
    equal(r.code, "redirect_rejected");
    assert(!r.privateEvidence);
  });
}
for (
  const [status, code] of [
    [401, "auth_required"],
    [403, "access_denied"],
    [404, "not_observed"],
    [429, "throttled"],
    [500, "provider_unavailable"],
    [503, "provider_unavailable"],
    [400, "http_error"],
  ] as const
) {
  Deno.test(`[HFA-028] HTTP ${status} fixed classification no retry or error leakage`, async () => {
    let calls = 0;
    const r = await captureQboRead(
      input(),
      ((url: URL | RequestInfo, init?: RequestInit) => {
        calls++;
        return reply({
          Fault: { Error: [{ Message: "PRIVATE_PROVIDER_ERROR" }] },
        }, status)(url, init);
      }) as typeof fetch,
    );
    equal(r.code, code);
    equal(calls, 1);
    assert(!JSON.stringify(r).includes("PRIVATE_PROVIDER_ERROR"));
    assert(r.privateEvidence?.capture_complete);
  });
}
Deno.test("[HFA-028] HTTP200 Fault rejects even parseable successful envelope", async () => {
  const r = await captureQboRead(
    input(),
    reply({ ...page(), Fault: { Error: [] } }),
  );
  equal(r.code, "provider_fault");
});
Deno.test("[HFA-028] HTTP200 warning rejects", async () => {
  const r = await captureQboRead(input(), reply({ ...page(), Warnings: [] }));
  equal(r.code, "provider_partial");
});
for (
  const [name, value] of [
    ["duplicate key", '{"QueryResponse":{},"Query\\u0052esponse":{}}'],
    ["trailing comma", '{"QueryResponse":{},}'],
    ["trailing bytes", '{"QueryResponse":{}}x'],
    ["malformed number", '{"QueryResponse":{"totalCount":01}}'],
    ["wrong root", "[]"],
    ["literal control", '{"a":"\u0000"}'],
  ] as const
) {
  Deno.test(`[HFA-028] Invalid JSON ${name}`, async () => {
    equal(
      (await captureQboRead(input(), reply(value))).code,
      "invalid_response",
    );
  });
}
for (
  const [name, value] of [
    ["wrong offset", page([account], { startPosition: 2 })],
    ["wrong page length", page([account], { maxResults: 2 })],
    ["wrong count", page([account], { totalCount: 0 })],
    ["duplicate ID", page([account, account])],
    [
      "missing version",
      page([{ ...account, SyncToken: undefined } as unknown as typeof account]),
    ],
    ["numeric ID", page([{ ...account, Id: 42 } as unknown as typeof account])],
    ["unexpected entity", { QueryResponse: { JournalEntry: [] } }],
  ] as const
) {
  Deno.test(`[HFA-028] Page validation ${name}`, async () => {
    equal(
      (await captureQboRead(input(), reply(value))).code,
      "invalid_response",
    );
  });
}
Deno.test("[HFA-036] Huge monetary numeric lexemes survive bytes/hash with no parsed numbers returned", async () => {
  const raw = JSON.stringify(page()).replace(
    "5.25",
    "9007199254740993123456789.0100",
  );
  const bytes = encoder.encode(raw);
  const r = await captureQboRead(input(), reply(raw));
  assert(r.ok);
  equal(Array.from(r.privateEvidence!.copyCapturedBody()), Array.from(bytes));
  equal(
    r.privateEvidence!.captured_sha256,
    createHash("sha256").update(bytes).digest("hex"),
  );
  assert(!JSON.stringify(r).includes("PRIVATE_RESIDENT_CANARY"));
  assert(!JSON.stringify(r).includes("900719925"));
  assert(!JSON.stringify(r).includes("SYNTHETIC_TOKEN"));
  const copy = r.privateEvidence!.copyCapturedBody();
  copy.fill(0);
  equal(Array.from(r.privateEvidence!.copyCapturedBody()), Array.from(bytes));
});
Deno.test("[HFA-028] Oversize streaming evidence hash is prefix only", async () => {
  const raw = JSON.stringify(page());
  const r = await captureQboRead(input({ maxBytes: 25 }), reply(raw));
  equal(r.code, "body_too_large");
  equal(r.logSummary.capture_complete, false);
  equal(r.privateEvidence?.capture_complete, false);
  equal(r.privateEvidence?.copyCapturedBody().length, 25);
  assert(!("body_sha256" in r.privateEvidence!));
});
Deno.test("[HFA-028] Content length early refusal has no evidence digest", async () => {
  const r = await captureQboRead(
    input({ maxBytes: 25 }),
    reply(page(), 200, { "content-length": "1000" }),
  );
  equal(r.code, "body_too_large");
  assert(!r.privateEvidence);
});
Deno.test("[HFA-028] Short stream relative to length rejects complete hash claim", async () => {
  const r = await captureQboRead(
    input(),
    reply("{}", 200, { "content-length": "3" }),
  );
  equal(r.code, "body_incomplete");
  equal(r.privateEvidence?.capture_complete, false);
});
Deno.test("[HFA-028] Deadline applies to transport ignoring signal", async () => {
  const r = await captureQboRead(
    input({ timeoutMs: 5 }),
    (() => new Promise(() => {})) as typeof fetch,
  );
  equal(r.code, "timeout");
});
Deno.test("[HFA-028] Deadline applies to stalled body and retains captured prefix", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(encoder.encode('{"QueryResponse":'));
    },
  });
  const r = await captureQboRead(
    input({ timeoutMs: 5 }),
    (() =>
      Promise.resolve(
        new Response(stream, {
          headers: { "content-type": "application/json" },
        }),
      )) as typeof fetch,
  );
  equal(r.code, "timeout");
  equal(r.privateEvidence?.capture_complete, false);
  assert(r.logSummary.captured_bytes > 0);
});
Deno.test("[HFA-028] Pre-aborted signal never fetches", async () => {
  const c = new AbortController();
  c.abort();
  let n = 0;
  const r = await captureQboRead(
    input({ signal: c.signal }),
    (() => {
      n++;
      return Promise.reject();
    }) as typeof fetch,
  );
  equal(r.code, "aborted");
  equal(n, 0);
});
Deno.test("[HFA-028] Caller cancellation applies to transport ignoring signal", async () => {
  const c = new AbortController();
  const pending = captureQboRead(
    input({ signal: c.signal }),
    (() => new Promise(() => {})) as typeof fetch,
  );
  c.abort();
  equal((await pending).code, "aborted");
});
Deno.test("[HFA-028] Transport exception message remains private", async () => {
  const r = await captureQboRead(
    input(),
    (() => Promise.reject(new Error("PRIVATE_TOKEN"))) as typeof fetch,
  );
  equal(r.code, "transport_error");
  assert(!JSON.stringify(r).includes("PRIVATE_TOKEN"));
});
Deno.test("[HFA-028] GeneralLedger fixed request and raw hierarchy", async () => {
  const raw = JSON.stringify(report());
  const r = await captureQboRead(
    ledger(),
    ((url: URL | RequestInfo) => {
      const u = new URL(String(url));
      equal(u.pathname, "/v3/company/9341455327810551/reports/GeneralLedger");
      equal(u.searchParams.get("start_date"), "2026-08-01");
      equal(u.searchParams.get("end_date"), "2026-08-31");
      equal(u.searchParams.get("accounting_method"), "Accrual");
      return reply(raw)(url);
    }) as typeof fetch,
  );
  assert(r.ok);
  equal(new TextDecoder().decode(r.privateEvidence!.copyCapturedBody()), raw);
  equal(r.privateMetadata?.noReportData, false);
  assert(!JSON.stringify(r).includes("PRIVATE_RESIDENT"));
});
for (
  const key of [
    "StartPeriod",
    "EndPeriod",
    "ReportBasis",
    "Currency",
    "ReportName",
    "Time",
  ] as const
) {
  Deno.test(`[HFA-028] GeneralLedger ${key} mismatch rejects`, async () => {
    const value = report();
    value.Header[key] = "wrong";
    equal(
      (await captureQboRead(ledger(), reply(value))).code,
      "invalid_response",
    );
  });
}
Deno.test("[HFA-028] GeneralLedger explicit no-data declaration is not zero or completeness", async () => {
  const value = report();
  value.Header.Option[0].Value = "true";
  value.Rows.Row = [];
  const r = await captureQboRead(ledger(), reply(value));
  assert(r.ok);
  equal(r.privateMetadata, {
    kind: "general_ledger",
    noReportData: true,
    scan_complete: false,
  });
});
Deno.test("[HFA-028] GeneralLedger missing data contradicts declaration", async () => {
  const value = report();
  value.Rows.Row = [];
  equal(
    (await captureQboRead(ledger(), reply(value))).code,
    "invalid_response",
  );
});
Deno.test("[HFA-028] GeneralLedger truncation message anywhere rejects HTTP200", async () => {
  const value = report();
  value.Rows.Row[0].Header.ColData[0].value =
    "Unable to display more data. Please reduce the date range.";
  equal(
    (await captureQboRead(ledger(), reply(value))).code,
    "provider_partial",
  );
});
Deno.test("[HFA-028] GeneralLedger missing cells reject partial row", async () => {
  const value = report();
  value.Rows.Row[0].Rows.Row[0].ColData.pop();
  equal(
    (await captureQboRead(ledger(), reply(value))).code,
    "invalid_response",
  );
});
Deno.test("[HFA-028] Invalid calendar date refused before request", async () => {
  const value = ledger();
  assert(value.operation.kind === "general_ledger");
  value.operation.startDate = "2026-02-30";
  equal((await captureQboRead(value, reply(report()))).code, "invalid_config");
});
Deno.test("[HFA-028] Invalid UTF8 preserves evidence but rejects schema", async () => {
  const bytes = new Uint8Array([123, 34, 255, 34, 58, 49, 125]);
  const r = await captureQboRead(
    input(),
    (() =>
      Promise.resolve(
        new Response(bytes, {
          headers: { "content-type": "application/json" },
        }),
      )) as typeof fetch,
  );
  equal(r.code, "invalid_response");
  equal(r.privateEvidence?.capture_complete, true);
  equal(Array.from(r.privateEvidence!.copyCapturedBody()), Array.from(bytes));
});
Deno.test("[HFA-028] Content type mismatch is never an empty successful page", async () => {
  equal(
    (await captureQboRead(
      input(),
      reply(page(), 200, { "content-type": "text/html" }),
    )).code,
    "invalid_response",
  );
});
Deno.test("[HFA-028] Truncated JSON is complete byte capture but invalid response", async () => {
  const r = await captureQboRead(input(), reply('{"QueryResponse":'));
  equal(r.code, "invalid_response");
  equal(r.privateEvidence?.capture_complete, true);
  equal(r.logSummary.scan_complete, false);
});
Deno.test("[HFA-028] Early length rejection cancels response body", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  const r = await captureQboRead(
    input({ maxBytes: 20 }),
    (() =>
      Promise.resolve(
        new Response(stream, { headers: { "content-length": "21" } }),
      )) as typeof fetch,
  );
  equal(r.code, "body_too_large");
  assert(cancelled);
});
Deno.test("[HFA-028] Delayed transport resolution after cancellation discards body", async () => {
  const c = new AbortController();
  let finish: (r: Response) => void = () => {};
  let cancelled = false;
  const pending = captureQboRead(
    input({ signal: c.signal }),
    (() =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      })) as typeof fetch,
  );
  c.abort();
  equal((await pending).code, "aborted");
  finish(
    new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          cancelled = true;
        },
      }),
    ),
  );
  await Promise.resolve();
  await Promise.resolve();
  assert(cancelled);
});
Deno.test("[HFA-028] Mutable operation cannot change response expectation after dispatch", async () => {
  const value = ledger();
  let finish: (r: Response) => void = () => {};
  const pending = captureQboRead(
    value,
    (() =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      })) as typeof fetch,
  );
  assert(value.operation.kind === "general_ledger");
  value.operation.currency = "EUR";
  finish(
    new Response(JSON.stringify(report()), {
      headers: { "content-type": "application/json" },
    }),
  );
  assert((await pending).ok);
});
Deno.test("[HFA-028] Unsafe count never rounds to a nearby integer", async () => {
  const r = await captureQboRead(
    input({ operation: { kind: "account_count" } }),
    reply('{"QueryResponse":{"totalCount":9007199254740993}}'),
  );
  equal(r.code, "invalid_response");
});
Deno.test("[HFA-028] Excessive nesting fails closed", async () => {
  const r = await captureQboRead(
    input(),
    reply("[".repeat(42) + "0" + "]".repeat(42)),
  );
  equal(r.code, "invalid_response");
});
Deno.test("[HFA-028] Duplicate report declaration fails closed", async () => {
  const value = report();
  value.Header.Option.push({ ...value.Header.Option[0] });
  equal(
    (await captureQboRead(ledger(), reply(value))).code,
    "invalid_response",
  );
});
Deno.test("[HFA-028] Unknown report row type fails closed", async () => {
  const value = report();
  value.Rows.Row[0].type = "Unknown";
  equal(
    (await captureQboRead(ledger(), reply(value))).code,
    "invalid_response",
  );
});
Deno.test("[HFA-028] Continuously ready zero-byte chunks cannot starve absolute deadline", async () => {
  let pulled = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      if (++pulled <= 20000) c.enqueue(new Uint8Array());
      else {
        c.enqueue(encoder.encode(JSON.stringify(page())));
        c.close();
      }
    },
    cancel() {
      cancelled = true;
    },
  });
  const r = await captureQboRead(
    input({ timeoutMs: 1 }),
    (() =>
      Promise.resolve(
        new Response(stream, {
          headers: { "content-type": "application/json" },
        }),
      )) as typeof fetch,
  );
  equal(r.code, "timeout");
  equal(r.logSummary.capture_complete, false);
  assert(pulled < 20000);
  assert(cancelled);
});
Deno.test("[HFA-028] Ready stream yields so external timer cancellation is observed", async () => {
  const c = new AbortController();
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(target) {
      pulled++;
      target.enqueue(new Uint8Array());
    },
  });
  const timer = setTimeout(() => c.abort(), 1);
  try {
    const r = await captureQboRead(
      input({ signal: c.signal, timeoutMs: 1000 }),
      (() => Promise.resolve(new Response(stream))) as typeof fetch,
    );
    equal(r.code, "aborted");
    assert(pulled < 20000);
  } finally {
    clearTimeout(timer);
  }
});
Deno.test("[HFA-028] Tiny positive chunks preserve bytes within one bounded capture", async () => {
  const bytes = encoder.encode(JSON.stringify(page()));
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      if (offset < bytes.length) c.enqueue(bytes.slice(offset, ++offset));
      else c.close();
    },
  });
  const r = await captureQboRead(
    input(),
    (() =>
      Promise.resolve(
        new Response(stream, {
          headers: { "content-type": "application/json" },
        }),
      )) as typeof fetch,
  );
  assert(r.ok);
  equal(Array.from(r.privateEvidence!.copyCapturedBody()), Array.from(bytes));
});
for (
  const value of [
    "2026-02-30T12:00:00Z",
    "2026-06-01T24:00:00Z",
    "2026-06-01T12:60:00Z",
    "2026-06-01T12:00:60Z",
    "2026-06-01T12:00:00+24:00",
    "2026-06-01T12:00:00+00:60",
  ]
) {
  Deno.test(`[HFA-028] Strict report timestamp rejects ${value}`, async () => {
    const fixture = report();
    fixture.Header.Time = value;
    equal(
      (await captureQboRead(ledger(), reply(fixture))).code,
      "invalid_response",
    );
  });
}
Deno.test("[HFA-028] Strict report timestamp accepts real leap-day with nanoseconds and offset", async () => {
  const value = report();
  value.Header.Time = "2024-02-29T23:59:59.123456789-05:00";
  assert((await captureQboRead(ledger(), reply(value))).ok);
});
for (const encoding of ["identity", "IDENTITY", " identity ", ""]) {
  Deno.test(`[HFA-028] Content-length mismatch rejected with encoding ${JSON.stringify(encoding)}`, async () => {
    const r = await captureQboRead(
      input(),
      reply("{}", 200, { "content-length": "3", "content-encoding": encoding }),
    );
    equal(r.code, "body_incomplete");
    equal(r.privateEvidence?.capture_complete, false);
  });
}
for (
  const target of [
    "group",
    "data",
    "section",
    "header",
    "cell",
    "root",
    "columns",
  ] as const
) {
  Deno.test(`[HFA-028] Unknown report ${target} members cannot hide financial rows`, async () => {
    const value = report();
    const row = value.Rows.Row[0];
    const object = target === "group"
      ? value.Rows
      : target === "data"
      ? row.Rows.Row[0]
      : target === "section"
      ? row
      : target === "header"
      ? row.Header
      : target === "cell"
      ? row.Rows.Row[0].ColData[0]
      : target === "root"
      ? value
      : value.Columns;
    (object as Record<string, unknown>).HiddenRows = [{
      type: "Data",
      ColData: [{ value: "100000.00" }],
    }];
    equal(
      (await captureQboRead(ledger(), reply(value))).code,
      "invalid_response",
    );
  });
}
for (const signal of [{}, null, Object.create(AbortSignal.prototype)]) {
  Deno.test(`[HFA-028] Malformed cancellation value returns fixed invalid_config ${String(signal === null)}`, async () => {
    let calls = 0;
    const r = await captureQboRead(
      input({ signal: signal as AbortSignal }),
      (() => {
        calls++;
        return Promise.reject();
      }) as typeof fetch,
    );
    equal(r.code, "invalid_config");
    equal(calls, 0);
  });
}
const abortAwareFetch =
  ((_url: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("PRIVATE_ABORT_CANARY", "AbortError")),
        { once: true },
      );
    })) as typeof fetch;
Deno.test("[HFA-028] Abort-aware transport deadline always classified timeout", async () => {
  const r = await captureQboRead(input({ timeoutMs: 1 }), abortAwareFetch);
  equal(r.code, "timeout");
  assert(!JSON.stringify(r).includes("PRIVATE_ABORT_CANARY"));
});
Deno.test("[HFA-028] Abort-aware transport caller cancellation always classified aborted", async () => {
  const c = new AbortController();
  const pending = captureQboRead(input({ signal: c.signal }), abortAwareFetch);
  c.abort();
  equal((await pending).code, "aborted");
});
