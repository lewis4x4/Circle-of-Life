/** Server-only capture primitive. Caller supplies live binding/authority; no importer. */
export type QboReadOperation =
  | { kind: "account_count" }
  | { kind: "account_page"; startPosition: number; maxResults: number }
  | {
    kind: "general_ledger";
    startDate: string;
    endDate: string;
    basis: "Cash" | "Accrual";
    currency: string;
  };
export type QboReadInput = {
  environment: "sandbox" | "production";
  companyId: string;
  expectedCompanyId: string;
  minorversion: number;
  accessToken: string;
  /** Trusted engine configuration, never a browser request flag. */
  allowProductionRead?: boolean;
  operation: QboReadOperation;
  maxBytes?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
};
export type QboReadCode =
  | "captured"
  | "invalid_config"
  | "scope_mismatch"
  | "production_disabled"
  | "aborted"
  | "timeout"
  | "transport_error"
  | "redirect_rejected"
  | "auth_required"
  | "access_denied"
  | "not_observed"
  | "throttled"
  | "provider_unavailable"
  | "http_error"
  | "body_too_large"
  | "body_incomplete"
  | "invalid_response"
  | "provider_fault"
  | "provider_partial";
export type QboReadResult = Readonly<{
  ok: boolean;
  code: QboReadCode;
  logSummary: Readonly<
    {
      code: QboReadCode;
      http_status: number | null;
      captured_bytes: number;
      capture_complete: boolean;
      scan_complete: false;
    }
  >;
  /** Restricted storage only. This accessor is not an authorization mechanism. */
  privateEvidence?: Readonly<
    {
      capture_complete: boolean;
      captured_sha256: string;
      copyCapturedBody: () => Uint8Array;
    }
  >;
  /** Identifiers are private financial metadata; never ordinary-log. */
  privateMetadata?: Readonly<
    {
      kind: QboReadOperation["kind"];
      count?: number;
      accounts?: readonly Readonly<{ id: string; syncToken: string }>[];
      noReportData?: boolean;
      scan_complete: false;
    }
  >;
}>;
const limits = { bytes: 8_388_608, depth: 40, nodes: 500_000 };
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
class Invalid extends Error {
  constructor(readonly code: QboReadCode) {
    super(code);
  }
}
function fail(code: QboReadCode): never {
  throw new Invalid(code);
}
class DecimalToken {
  constructor(readonly lexeme: string) {}
}
type Json = null | boolean | string | DecimalToken | Json[] | {
  [key: string]: Json;
};
/** Exact number tokens stay private; duplicate decoded keys and pathological nesting fail. */
class Parser {
  private i = 0;
  private nodes = 0;
  constructor(private readonly source: string) {}
  parse(): Json {
    const value = this.value(0);
    this.space();
    if (this.i !== this.source.length) fail("invalid_response");
    return value;
  }
  private space() {
    while (/^[\x20\t\r\n]$/.test(this.source[this.i] ?? "")) this.i++;
  }
  private string(): string {
    const start = this.i++;
    while (this.i < this.source.length) {
      const char = this.source[this.i++];
      if (char === '"') {
        try {
          return JSON.parse(this.source.slice(start, this.i));
        } catch {
          fail("invalid_response");
        }
      }
      if (char === "\\") this.i++;
    }
    return fail("invalid_response");
  }
  private value(depth: number): Json {
    if (depth > limits.depth || ++this.nodes > limits.nodes) {
      fail("invalid_response");
    }
    this.space();
    const c = this.source[this.i];
    if (c === '"') return this.string();
    if (c === "{" || c === "[") {
      this.i++;
      this.space();
      const object = c === "{";
      const close = object ? "}" : "]";
      const values: Json[] = [];
      const fields: { [key: string]: Json } = Object.create(null);
      if (this.source[this.i] === close) {
        this.i++;
        return object ? fields : values;
      }
      while (true) {
        this.space();
        if (object) {
          if (this.source[this.i] !== '"') fail("invalid_response");
          const key = this.string();
          if (Object.hasOwn(fields, key)) fail("invalid_response");
          this.space();
          if (this.source[this.i++] !== ":") fail("invalid_response");
          fields[key] = this.value(depth + 1);
        } else values.push(this.value(depth + 1));
        this.space();
        const next = this.source[this.i++];
        if (next === close) break;
        if (next !== ",") fail("invalid_response");
      }
      return object ? fields : values;
    }
    for (
      const [literal, value] of [["true", true], ["false", false], [
        "null",
        null,
      ]] as const
    ) {
      if (this.source.startsWith(literal, this.i)) {
        this.i += literal.length;
        return value;
      }
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
      this.source.slice(this.i),
    );
    if (!number) fail("invalid_response");
    this.i += number[0].length;
    return new DecimalToken(number[0]);
  }
}
function record(value: Json | undefined): { [key: string]: Json } {
  if (
    !value || typeof value !== "object" || Array.isArray(value) ||
    value instanceof DecimalToken
  ) fail("invalid_response");
  return value;
}
function integer(value: Json | undefined): number {
  if (
    !(value instanceof DecimalToken) || !/^(?:0|[1-9]\d*)$/.test(value.lexeme)
  ) fail("invalid_response");
  const result = Number(value.lexeme);
  if (!Number.isSafeInteger(result)) fail("invalid_response");
  return result;
}
function date(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
}
/** Strict civil RFC3339 profile: no normalized invalid days, 24:00 or leap seconds. */
function timestamp(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const match =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-](\d{2}):(\d{2}))$/
      .exec(value);
  return !!match && date(match[1]) && Number(match[2]) < 24 &&
    Number(match[3]) < 60 && Number(match[4]) < 60 &&
    (match[5] === "Z" || (Number(match[6]) < 24 && Number(match[7]) < 60));
}
function onlyKeys(
  value: { [key: string]: Json },
  allowed: readonly string[],
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    fail("invalid_response");
  }
}
function id(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d{0,39}$/.test(value);
}
function version(value: unknown): value is string {
  return typeof value === "string" && /^(?:0|[1-9]\d{0,39})$/.test(value);
}
function validate(
  input: QboReadInput,
): {
  url: string;
  operation: QboReadOperation;
  bytes: number;
  timeout: number;
  token: string;
} {
  if (
    !input || !["sandbox", "production"].includes(input.environment) ||
    !id(input.companyId) || !id(input.expectedCompanyId) ||
    !Number.isSafeInteger(input.minorversion) || input.minorversion < 1 ||
    input.minorversion > 999 || typeof input.accessToken !== "string" ||
    !/^[\x21-\x7e]{1,16384}$/.test(input.accessToken)
  ) fail("invalid_config");
  if (input.companyId !== input.expectedCompanyId) fail("scope_mismatch");
  if (
    input.environment === "production" && input.allowProductionRead !== true
  ) fail("production_disabled");
  const bytes = input.maxBytes ?? limits.bytes;
  const timeout = input.timeoutMs ?? 30_000;
  if (
    !Number.isSafeInteger(bytes) || bytes < 1 || bytes > limits.bytes ||
    !Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60_000
  ) fail("invalid_config");
  const operation = { ...input.operation } as QboReadOperation;
  const host = input.environment === "sandbox"
    ? "sandbox-quickbooks.api.intuit.com"
    : "quickbooks.api.intuit.com";
  const url = new URL(`https://${host}/v3/company/${input.companyId}/`);
  if (operation.kind === "account_count" || operation.kind === "account_page") {
    url.pathname += "query";
    let query = operation.kind === "account_count"
      ? "SELECT COUNT(*) FROM Account WHERE Active IN (true,false)"
      : "SELECT * FROM Account WHERE Active IN (true,false)";
    if (operation.kind === "account_page") {
      if (
        !Number.isSafeInteger(operation.startPosition) ||
        operation.startPosition < 1 ||
        !Number.isSafeInteger(operation.maxResults) ||
        operation.maxResults < 1 || operation.maxResults > 1000 ||
        !Number.isSafeInteger(operation.startPosition + operation.maxResults)
      ) fail("invalid_config");
      query +=
        ` STARTPOSITION ${operation.startPosition} MAXRESULTS ${operation.maxResults}`;
    }
    url.searchParams.set("query", query);
  } else if (operation.kind === "general_ledger") {
    if (
      !date(operation.startDate) || !date(operation.endDate) ||
      operation.startDate > operation.endDate ||
      !["Cash", "Accrual"].includes(operation.basis) ||
      !/^[A-Z]{3}$/.test(operation.currency)
    ) fail("invalid_config");
    url.pathname += "reports/GeneralLedger";
    url.searchParams.set("start_date", operation.startDate);
    url.searchParams.set("end_date", operation.endDate);
    url.searchParams.set("accounting_method", operation.basis);
  } else fail("invalid_config");
  url.searchParams.set("minorversion", String(input.minorversion));
  return { url: url.href, operation, bytes, timeout, token: input.accessToken };
}
function inspect(value: Json, depth = 0): void {
  if (depth > limits.depth) fail("invalid_response");
  if (
    typeof value === "string" &&
    /unable to display more data|please reduce the date range/i.test(value)
  ) fail("provider_partial");
  if (value && typeof value === "object" && !(value instanceof DecimalToken)) {
    for (const [key, child] of Object.entries(value)) {
      if (/^fault$/i.test(key)) fail("provider_fault");
      if (/^warnings?$/i.test(key)) fail("provider_partial");
      inspect(child, depth + 1);
    }
  }
}
function metadata(
  bytes: Uint8Array,
  operation: QboReadOperation,
): NonNullable<QboReadResult["privateMetadata"]> {
  const root = record(new Parser(decoder.decode(bytes)).parse());
  inspect(root);
  if (operation.kind === "account_count" || operation.kind === "account_page") {
    const query = record(root.QueryResponse);
    if (
      Object.keys(root).some((key) =>
        !["QueryResponse", "time"].includes(key)
      ) || Object.keys(query).some((key) =>
        !["Account", "startPosition", "maxResults", "totalCount"].includes(key)
      )
    ) fail("invalid_response");
    if (operation.kind === "account_count") {
      if (
        query.Account !== undefined || query.startPosition !== undefined ||
        query.maxResults !== undefined
      ) fail("invalid_response");
      return Object.freeze({
        kind: operation.kind,
        count: integer(query.totalCount),
        scan_complete: false,
      });
    }
    const rows = query.Account === undefined ? [] : query.Account;
    if (!Array.isArray(rows) || rows.length > operation.maxResults) {
      fail("invalid_response");
    }
    // QBO's empty QueryResponse may omit every pagination attribute.
    if (
      rows.length > 0 &&
      (query.startPosition === undefined || query.maxResults === undefined)
    ) fail("invalid_response");
    if (
      query.startPosition !== undefined &&
      integer(query.startPosition) !== operation.startPosition
    ) fail("invalid_response");
    if (
      query.maxResults !== undefined &&
      integer(query.maxResults) !== rows.length
    ) fail("invalid_response");
    if (
      query.totalCount !== undefined && integer(query.totalCount) < rows.length
    ) fail("invalid_response");
    const seen = new Set<string>();
    const accounts = rows.map((row) => {
      const account = record(row);
      if (
        !id(account.Id) || !version(account.SyncToken) ||
        typeof account.Active !== "boolean" || seen.has(account.Id)
      ) fail("invalid_response");
      seen.add(account.Id);
      return Object.freeze({ id: account.Id, syncToken: account.SyncToken });
    });
    return Object.freeze({
      kind: operation.kind,
      count: accounts.length,
      accounts: Object.freeze(accounts),
      scan_complete: false,
    });
  }
  onlyKeys(root, ["Header", "Columns", "Rows"]);
  const header = record(root.Header);
  onlyKeys(header, [
    "Time",
    "ReportName",
    "ReportBasis",
    "StartPeriod",
    "EndPeriod",
    "Currency",
    "Option",
    "SummarizeColumnsBy",
  ]);
  const columnGroup = record(root.Columns);
  onlyKeys(columnGroup, ["Column"]);
  const columns = columnGroup.Column;
  const rows = record(root.Rows);
  if (
    header.ReportName !== "GeneralLedger" ||
    header.StartPeriod !== operation.startDate ||
    header.EndPeriod !== operation.endDate ||
    header.ReportBasis !== operation.basis ||
    header.Currency !== operation.currency || !timestamp(header.Time) ||
    !Array.isArray(columns) ||
    columns.length === 0
  ) fail("invalid_response");
  for (const column of columns) {
    const c = record(column);
    onlyKeys(c, ["ColTitle", "ColType", "MetaData"]);
    if (c.MetaData !== undefined) {
      if (!Array.isArray(c.MetaData)) fail("invalid_response");
      for (const value of c.MetaData) {
        const field = record(value);
        onlyKeys(field, ["Name", "Value"]);
        if (typeof field.Name !== "string" || typeof field.Value !== "string") {
          fail("invalid_response");
        }
      }
    }
    if (typeof c.ColType !== "string" || typeof c.ColTitle !== "string") {
      fail("invalid_response");
    }
  }
  const options = header.Option;
  if (!Array.isArray(options)) fail("invalid_response");
  for (const value of options) {
    const option = record(value);
    onlyKeys(option, ["Name", "Value"]);
    if (typeof option.Name !== "string" || typeof option.Value !== "string") {
      fail("invalid_response");
    }
  }
  const declarations = options.filter((v) => record(v).Name === "NoReportData");
  if (declarations.length !== 1) fail("invalid_response");
  const declaration = record(declarations[0]).Value;
  if (declaration !== "true" && declaration !== "false") {
    fail("invalid_response");
  }
  const columnCount = columns.length;
  let cells = 0;
  let dataRows = 0;
  function colData(value: Json | undefined): void {
    if (!Array.isArray(value) || value.length !== columnCount) {
      fail("invalid_response");
    }
    cells += value.length;
    if (cells >= 400_000) fail("provider_partial");
    for (const cell of value) {
      const c = record(cell);
      onlyKeys(c, ["value", "id", "href"]);
      if (
        typeof c.value !== "string" ||
        (c.id !== undefined && typeof c.id !== "string") ||
        (c.href !== undefined && typeof c.href !== "string")
      ) fail("invalid_response");
    }
  }
  function walkRows(group: { [key: string]: Json }): void {
    onlyKeys(group, ["Row"]);
    if (group.Row === undefined) {
      if (Object.keys(group).length !== 0) fail("invalid_response");
      return;
    }
    if (!Array.isArray(group.Row)) fail("invalid_response");
    for (const value of group.Row) {
      const row = record(value);
      if (row.type === "Data") {
        onlyKeys(row, ["type", "ColData", "group"]);
        if (row.group !== undefined && typeof row.group !== "string") {
          fail("invalid_response");
        }
        colData(row.ColData);
        dataRows++;
        if (
          row.Rows !== undefined || row.Header !== undefined ||
          row.Summary !== undefined
        ) fail("invalid_response");
      } else if (row.type === "Section") {
        onlyKeys(row, ["type", "group", "Header", "Summary", "Rows"]);
        if (row.group !== undefined && typeof row.group !== "string") {
          fail("invalid_response");
        }
        for (const name of ["Header", "Summary"]) {
          if (row[name] !== undefined) {
            const part = record(row[name]);
            onlyKeys(part, ["ColData"]);
            colData(part.ColData);
          }
        }
        if (row.Rows !== undefined) walkRows(record(row.Rows));
        if (
          row.Header === undefined && row.Summary === undefined &&
          row.Rows === undefined
        ) fail("invalid_response");
      } else fail("invalid_response");
    }
  }
  walkRows(rows);
  if (
    (declaration === "true" && dataRows !== 0) ||
    (declaration === "false" && dataRows === 0)
  ) fail("invalid_response");
  return Object.freeze({
    kind: operation.kind,
    noReportData: declaration === "true",
    scan_complete: false,
  });
}
/** fetchImpl is for trusted composition/tests, never user supplied. No automatic retry. */
export async function captureQboRead(
  input: QboReadInput,
  fetchImpl: typeof fetch = fetch,
): Promise<QboReadResult> {
  let status: number | null = null;
  let captured = new Uint8Array();
  let complete = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let responseBody: ReadableStream<Uint8Array> | null | undefined;
  let externalSignal: AbortSignal | undefined;
  let signalRegistered = false;
  let stopReason: "timeout" | "aborted" | undefined;
  let deadline = Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  let onAbort: (() => void) | undefined;
  let rejectStop: (reason: Invalid) => void = () => {};
  const stopped = new Promise<never>((_, reject) => {
    rejectStop = reject;
  });
  // The race observes custom transports/streams even if they ignore AbortSignal.
  const race = <T>(promise: Promise<T>) => Promise.race([promise, stopped]);
  const stop = (reason: "timeout" | "aborted") => {
    if (stopReason) return;
    stopReason = reason;
    rejectStop(new Invalid(reason));
    controller.abort();
  };
  const checkStop = () => {
    if (stopReason) fail(stopReason);
    if (performance.now() >= deadline) {
      stop("timeout");
      fail("timeout");
    }
  };
  let resultCode: QboReadCode = "captured";
  let privateMetadata: QboReadResult["privateMetadata"];
  try {
    const config = validate(input);
    externalSignal = input.signal;
    if (externalSignal !== undefined) {
      // Calling the intrinsic getter checks the brand; instanceof alone can be spoofed.
      try {
        const getter = Object.getOwnPropertyDescriptor(
          AbortSignal.prototype,
          "aborted",
        )!.get!;
        if (getter.call(externalSignal)) fail("aborted");
      } catch (error) {
        if (error instanceof Invalid) throw error;
        fail("invalid_config");
      }
    }
    deadline = performance.now() + config.timeout;
    onAbort = () => stop("aborted");
    if (externalSignal) {
      EventTarget.prototype.addEventListener.call(
        externalSignal,
        "abort",
        onAbort,
        { once: true },
      );
      signalRegistered = true;
    }
    timer = setTimeout(() => stop("timeout"), config.timeout);
    const pendingResponse = fetchImpl(config.url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: "application/json",
      },
      redirect: "manual",
      signal: controller.signal,
      cache: "no-store",
    });
    void pendingResponse.then((late) => {
      if (controller.signal.aborted) void late.body?.cancel().catch(() => {});
    }, () => {});
    const response = await race(pendingResponse);
    responseBody = response.body;
    checkStop();
    status = response.status;
    if (
      response.redirected || (status >= 300 && status < 400) ||
      (response.url && response.url !== config.url)
    ) {
      void response.body?.cancel().catch(() => {});
      fail("redirect_rejected");
    }
    const length = response.headers.get("content-length");
    if (
      length !== null &&
      (!/^(?:0|[1-9]\d*)$/.test(length) ||
        !Number.isSafeInteger(Number(length)))
    ) fail("invalid_response");
    if (length !== null && Number(length) > config.bytes) {
      fail("body_too_large");
    }
    if (!response.body) fail("body_incomplete");
    reader = response.body.getReader();
    // One bounded buffer: zero/tiny chunks cannot create unbounded object storage.
    const buffer = new Uint8Array(config.bytes);
    let size = 0;
    let reads = 0;
    try {
      while (true) {
        checkStop();
        if (++reads % 64 === 0) {
          // Let caller cancellation/timers run even with continuously ready microtasks.
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          checkStop();
        }
        const part = await race(reader.read());
        checkStop();
        if (part.done) break;
        const remaining = config.bytes - size;
        const kept = Math.min(remaining, part.value.length);
        if (kept > 0) {
          buffer.set(part.value.subarray(0, kept), size);
          size += kept;
        }
        if (part.value.length > remaining) fail("body_too_large");
      }
      const encoding = response.headers.get("content-encoding")?.trim()
        .toLowerCase();
      if (
        length !== null && (!encoding || encoding === "identity") &&
        Number(length) !== size
      ) fail("body_incomplete");
      complete = true;
    } finally {
      captured = buffer.slice(0, size);
    }
    if (status !== 200) {
      fail(
        status === 401
          ? "auth_required"
          : status === 403
          ? "access_denied"
          : status === 404
          ? "not_observed"
          : status === 429
          ? "throttled"
          : status >= 500
          ? "provider_unavailable"
          : "http_error",
      );
    }
    if (
      !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i
        .test(response.headers.get("content-type") ?? "")
    ) fail("invalid_response");
    const checkedMetadata = metadata(captured, config.operation);
    checkStop();
    privateMetadata = checkedMetadata;
  } catch (error) {
    resultCode = stopReason ??
      (error instanceof Invalid
        ? error.code
        : error instanceof SyntaxError || error instanceof TypeError && complete
        ? "invalid_response"
        : "transport_error");
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (signalRegistered && onAbort) {
      try {
        EventTarget.prototype.removeEventListener.call(
          externalSignal,
          "abort",
          onAbort,
        );
      } catch { /* cleanup must never escape the fixed result contract */ }
    }
    controller.abort();
    if (reader) void reader.cancel().catch(() => {});
    else if (responseBody) void responseBody.cancel().catch(() => {});
  }
  let privateEvidence: QboReadResult["privateEvidence"];
  if (captured.length || complete) {
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", captured)),
      (v) => v.toString(16).padStart(2, "0"),
    ).join("");
    privateEvidence = Object.freeze({
      capture_complete: complete,
      captured_sha256: digest,
      copyCapturedBody: () => captured.slice(),
    });
  }
  return Object.freeze({
    ok: resultCode === "captured",
    code: resultCode,
    logSummary: Object.freeze({
      code: resultCode,
      http_status: status,
      captured_bytes: captured.length,
      capture_complete: complete,
      scan_complete: false,
    }),
    ...(privateEvidence ? { privateEvidence } : {}),
    ...(privateMetadata ? { privateMetadata } : {}),
  });
}
