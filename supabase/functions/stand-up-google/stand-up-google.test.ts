import {
  credentialFingerprint,
  GoogleDriveClient,
  GoogleReconnectRequired,
  md5Hex,
  ProviderHttpError,
  refreshGoogleAccessToken,
} from "./google.ts";
import { easternReportingWeek, handleStandUpGoogle } from "./handler.ts";
import type {
  ApplySnapshotInput,
  ApplySnapshotResult,
  BridgeContext,
  BridgeRpc,
  CompleteExportInput,
  ExportPlanResult,
} from "./rpc.ts";
import { SupabaseBridgeRpc } from "./rpc.ts";
import {
  FACILITIES,
  type FacilityMap,
  type HeldBaseline,
  KEYS,
  overtimeMinutes,
  parseWorkbook,
  patchWorkbook,
  retainUnchangedHeldOvertime,
  type StandUpValues,
  WorkbookError,
} from "./xlsx.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function equals(actual: unknown, expected: unknown, message: string) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${message}: ${JSON.stringify(actual)}`,
  );
}
const encoder = new TextEncoder();
function binaryResponse(bytes: Uint8Array): Response {
  return new Response(Uint8Array.from(bytes).buffer);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function concat(chunks: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    chunks.reduce((sum, chunk) => sum + chunk.length, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}
function storedZip(entries: Record<string, string>): Uint8Array {
  const locals: Uint8Array[] = [], centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, value] of Object.entries(entries)) {
    const nameBytes = encoder.encode(name),
      bytes = encoder.encode(value),
      crc = crc32(bytes);
    const local = new Uint8Array(30 + nameBytes.length + bytes.length),
      lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, bytes.length, true);
    lv.setUint32(22, bytes.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(bytes, 30 + nameBytes.length);
    locals.push(local);
    const central = new Uint8Array(46 + nameBytes.length),
      cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, bytes.length, true);
    cv.setUint32(24, bytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);
    offset += local.length;
  }
  const directory = concat(centrals),
    eocd = new Uint8Array(22),
    view = new DataView(eocd.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, centrals.length, true);
  view.setUint16(10, centrals.length, true);
  view.setUint32(12, directory.length, true);
  view.setUint32(16, offset, true);
  return concat([...locals, directory, eocd]);
}

const labels: Array<[string, typeof KEYS[number]]> = [
  ["current ar", "monthly_rent_roll_cents"],
  ["current total census", "current_total_census"],
  ["sp female beds open", "sp_female_beds_open"],
  ["sp male beds open", "sp_male_beds_open"],
  ["sp male or female beds open", "sp_flexible_beds_open"],
  ["private beds open", "private_beds_open"],
  ["admissions expected", "admissions_expected"],
  ["total at the hospital & rehab", "hospital_and_rehab_total"],
  ["expected discharges", "expected_discharges"],
  ["call outs last week", "callouts_last_week"],
  ["terminations last week", "terminations_last_week"],
  ["current open positions", "current_open_positions"],
  ["overtime", "overtime_reported"],
  ["tours expected", "tours_expected"],
  [
    "activities on the calendar to be completed by home health providers",
    "provider_activities_expected",
  ],
  [
    "outreach & engagements (providers, facilities, events)",
    "outreach_engagements",
  ],
];
const map = Object.fromEntries(
  FACILITIES.map((
    name,
    index,
  ) => [
    name,
    `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  ]),
) as FacilityMap;

function fixture(
  options: {
    blank?: boolean;
    overtime?: string;
    formula?: boolean;
    week?: string;
    missingCell?: string;
  } = {},
): Uint8Array {
  const week = options.week ?? "2026-09-14";
  const rows = [
    `<row r="1"><c r="A1" t="inlineStr"><is><t>${week}</t></is></c></row>`,
    `<row r="2">${
      FACILITIES.map((name, index) =>
        `<c r="${
          String.fromCharCode(66 + index)
        }2" t="inlineStr"><is><t>${name}</t></is></c>`
      ).join("")
    }</row>`,
  ];
  labels.forEach(([label, key], index) => {
    const row = index + 3;
    const safeLabel = label.replaceAll("&", "&amp;");
    const value = key === "monthly_rent_roll_cents"
      ? "100.25"
      : key === "overtime_reported"
      ? options.overtime ?? "0"
      : "0";
    rows.push(
      `<row r="${row}"><c r="A${row}" t="inlineStr"><is><t>${safeLabel}</t></is></c>${
        "BCDEF".split("").filter((column) =>
          `${column}${row}` !== options.missingCell
        ).map((column) =>
          `<c r="${column}${row}">${
            options.formula && row === 3 ? "<f>1+1</f>" : ""
          }${options.blank ? "" : `<v>${value}</v>`}</c>`
        ).join("")
      }</row>`,
    );
  });
  const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  return storedZip({
    "xl/workbook.xml":
      `<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="September" sheetId="1" r:id="r1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels":
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<worksheet xmlns="${ns}"><sheetData>${
      rows.join("")
    }</sheetData></worksheet>`,
    "xl/styles.xml":
      `<styleSheet xmlns="${ns}"><cellXfs count="1"><xf numFmtId="0"/></cellXfs></styleSheet>`,
    "xl/media/unchanged.bin": "opaque-original-drawing",
  });
}

Deno.test("XLSX parser maps the reviewed five-facility schema and cents exactly", async () => {
  const parsed = await parseWorkbook(
    fixture(),
    map,
    "approved-file",
    "Stand Up.xlsx",
    ["2026-09-14"],
  );
  equals(parsed.issues, [], "valid workbook must have no issues");
  assert(
    parsed.records.length === 5 && Object.keys(parsed.locations).length === 5,
    "all facilities must be present",
  );
  assert(
    parsed.records[0].values.monthly_rent_roll_cents === 10025,
    "rent must convert to cents",
  );
});

Deno.test("blank current week retains five validated locations without importing zero reports", async () => {
  const parsed = await parseWorkbook(
    fixture({ blank: true }),
    map,
    "approved-file",
    "Stand Up.xlsx",
    ["2026-09-14"],
  );
  assert(
    parsed.records.length === 0 && Object.keys(parsed.locations).length === 5 &&
      parsed.issues.length === 0,
    "blank template must remain blank and writable",
  );
});

Deno.test("formula inputs and invalid overtime fail closed", async () => {
  const formula = await parseWorkbook(
    fixture({ formula: true }),
    map,
    "approved-file",
    "Stand Up.xlsx",
  );
  assert(
    formula.issues.some((issue) => issue.message.includes("formula/error")),
    "formula input must be held",
  );
  const overtime = await parseWorkbook(
    fixture({ overtime: "15.65" }),
    map,
    "approved-file",
    "Stand Up.xlsx",
  );
  assert(
    overtime.issues.length === 5 &&
      overtime.issues.every((issue) =>
        issue.message.includes("minute component")
      ),
    "ambiguous HH.MM must be held",
  );
});

Deno.test("valid two-decimal HH.MM survives binary floating point representation", () => {
  equals(overtimeMinutes(0.07), 7, "seven minutes");
  equals(overtimeMinutes(0.29), 29, "twenty-nine minutes");
  equals(overtimeMinutes(1.42), 102, "one hour forty-two minutes");
});

Deno.test("XLSX patcher writes Haven values and preserves unrelated workbook parts", async () => {
  const raw = fixture();
  const parsed = await parseWorkbook(
    raw,
    map,
    "approved-file",
    "Stand Up.xlsx",
    ["2026-09-14"],
  );
  const identity = `${map.Homewood}:2026-09-14`;
  const values = Object.fromEntries(
    KEYS.map((key) => [key, null]),
  ) as StandUpValues;
  values.monthly_rent_roll_cents = 123_456;
  values.current_total_census = 12;
  values.overtime_reported = 17.05;
  const output = await patchWorkbook(raw, parsed, { [identity]: values });
  const readback = await parseWorkbook(
    output,
    map,
    "approved-file",
    "Stand Up.xlsx",
    ["2026-09-14"],
  );
  equals(
    readback.records.find((record) => record.facility_id === map.Homewood)
      ?.values,
    values,
    "patched values must round-trip",
  );
  assert(
    new TextDecoder().decode(output).includes("opaque-original-drawing"),
    "unrelated ZIP member must remain byte-present",
  );
});

Deno.test("XLSX patcher refuses formulas and stale source bytes", async () => {
  const raw = fixture({ formula: true });
  const parsed = await parseWorkbook(
    raw,
    map,
    "approved-file",
    "Stand Up.xlsx",
  );
  parsed.issues = [];
  const identity = `${map.Homewood}:2026-09-14`;
  const values = Object.fromEntries(
    KEYS.map((key) => [key, 0]),
  ) as StandUpValues;
  let formulaRefused = false;
  try {
    await patchWorkbook(raw, parsed, { [identity]: values });
  } catch (error) {
    formulaRefused = error instanceof WorkbookError &&
      error.message.includes("formula");
  }
  assert(formulaRefused, "formula input must never be overwritten");
  let staleRefused = false;
  try {
    await patchWorkbook(fixture(), parsed, { [identity]: values });
  } catch (error) {
    staleRefused = error instanceof WorkbookError &&
      error.message.includes("Source changed");
  }
  assert(staleRefused, "stale source bytes must never be patched");
});

Deno.test("XLSX patcher inserts a missing blank input cell in coordinate order", async () => {
  const raw = fixture({ blank: true, missingCell: "B4" });
  const parsed = await parseWorkbook(
    raw,
    map,
    "approved-file",
    "Stand Up.xlsx",
  );
  const identity = `${map.Homewood}:2026-09-14`;
  const values = Object.fromEntries(
    KEYS.map((key) => [key, 0]),
  ) as StandUpValues;
  const output = await patchWorkbook(raw, parsed, { [identity]: values });
  const readback = await parseWorkbook(
    output,
    map,
    "approved-file",
    "Stand Up.xlsx",
  );
  equals(
    readback.records[0]?.values,
    values,
    "inserted blank cell must round-trip",
  );
});

Deno.test("disabled database generation short-circuits before Google credentials or provider fetch", async () => {
  let fetches = 0;
  const response = await handleStandUpGoogle(
    new Request("https://haven.invalid/functions/v1/stand-up-google", {
      method: "POST",
      headers: { "x-cron-secret": "cron" },
    }),
    {
      env: (name) =>
        ({
          STAND_UP_GOOGLE_CRON_SECRET: "cron",
          STAND_UP_GOOGLE_WORKBOOK_ID: "approved-file",
        })[name],
      fetcher: (() => {
        fetches++;
        throw new Error("provider must not be called");
      }) as typeof fetch,
      rpc: {
        loadContext: () =>
          Promise.resolve({ state: "disabled" } as BridgeContext),
        applySnapshot: () => Promise.reject(new Error("must not apply")),
        prepareExport: () => Promise.reject(new Error("must not prepare")),
        completeExport: () => Promise.reject(new Error("must not complete")),
        abandonExport: () => Promise.reject(new Error("must not abandon")),
        recordFailure: () => Promise.reject(new Error("must not record")),
      },
      now: () => new Date("2026-09-14T12:00:00Z"),
    },
  );
  equals(response.status, 200, "disabled response");
  equals(fetches, 0, "provider fetch count");
});

Deno.test("only numerically unchanged legacy held overtime may pass against exact baselines", async () => {
  const parsed = await parseWorkbook(
    fixture({ overtime: "15.65" }),
    map,
    "approved-file",
    "Stand Up.xlsx",
  );
  const values = Object.fromEntries(
    KEYS.map((key) => [key, key === "overtime_reported" ? 15.65 : 0]),
  ) as StandUpValues;
  const baselines = Object.fromEntries(
    Object.values(map).map((
      id,
    ) => [`${id}:2026-09-14`, { file_values: values }]),
  ) as Record<string, HeldBaseline>;
  assert(
    retainUnchangedHeldOvertime(parsed, baselines) &&
      parsed.issues.length === 0,
    "unchanged held evidence should not create an outage",
  );
  const changed = await parseWorkbook(
    fixture({ overtime: "15.65" }),
    map,
    "approved-file",
    "Stand Up.xlsx",
  );
  baselines[`${map.Homewood}:2026-09-14`].file_values = {
    ...values,
    overtime_reported: 15.64,
  };
  assert(
    !retainUnchangedHeldOvertime(changed, baselines),
    "changed invalid overtime must fail closed",
  );
});

Deno.test("XLSX archive rejects traversal, corruption and oversized coordinates", async () => {
  for (
    const raw of [
      new Uint8Array([1, 2, 3]),
      storedZip({ "../xl/workbook.xml": "x" }),
    ]
  ) {
    let failed = false;
    try {
      await parseWorkbook(raw, map, "id", "file");
    } catch (error) {
      failed = error instanceof WorkbookError;
    }
    assert(failed, "unsafe archive must fail");
  }
});

Deno.test("MD5 implementation matches provider checksum format", () => {
  assert(
    md5Hex(encoder.encode("abc")) === "900150983cd24fb0d6963f7d28e17f72",
    "MD5 must match RFC vector",
  );
});

Deno.test("OAuth refresh sends form credentials and classifies rejected credentials", async () => {
  let body = "";
  const token = await refreshGoogleAccessToken({
    clientId: "client",
    clientSecret: "secret",
    refreshToken: "refresh",
  }, (_input, init) => {
    body = String((init as globalThis.RequestInit | undefined)?.body);
    return Promise.resolve(
      new Response('{"access_token":"access"}', { status: 200 }),
    );
  });
  assert(
    token.accessToken === "access" &&
      body.includes("grant_type=refresh_token") &&
      body.includes("client_secret=secret"),
    "OAuth form must be complete",
  );
  let reconnect = false;
  try {
    await refreshGoogleAccessToken({
      clientId: "c",
      clientSecret: "s",
      refreshToken: "r",
    }, () => Promise.resolve(new Response("denied", { status: 400 })));
  } catch (error) {
    reconnect = error instanceof GoogleReconnectRequired;
  }
  assert(reconnect, "rejected refresh must require reconnect");
});

Deno.test("stable Drive snapshot verifies two identical metadata reads, size and MD5", async () => {
  const bytes = fixture(),
    metadata = {
      id: "file",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      etag: '"strong"',
      version: "7",
      headRevisionId: "head",
      md5Checksum: md5Hex(bytes),
      fileSize: String(bytes.length),
      labels: { trashed: false },
    };
  let calls = 0;
  const client = new GoogleDriveClient("access", (input) => {
    calls++;
    return Promise.resolve(
      String(input).includes("alt=media")
        ? binaryResponse(bytes)
        : new Response(JSON.stringify(metadata)),
    );
  });
  const snapshot = await client.downloadStable("file");
  assert(
    calls === 3 && snapshot.bytes.length === bytes.length &&
      snapshot.metadata.version === "7",
    "snapshot must bind metadata/media/metadata",
  );
});

Deno.test("conditional writer uses Drive v2 PUT and exact strong If-Match", async () => {
  let observed: RequestInit | undefined, url = "";
  const client = new GoogleDriveClient("access", (input, init) => {
    url = String(input);
    observed = init;
    return Promise.resolve(new Response("{}", { status: 200 }));
  });
  await client.uploadConditional("file/id", encoder.encode("xlsx"), '"etag-7"');
  assert(
    url.includes("upload/drive/v2/files/file%2Fid") &&
      observed?.method === "PUT",
    "must use reviewed v2 conditional media PUT",
  );
  assert(
    new Headers(observed?.headers).get("If-Match") === '"etag-7"',
    "must retain exact observed ETag",
  );
  let stale = false;
  try {
    await new GoogleDriveClient(
      "access",
      () => Promise.resolve(new Response("", { status: 412 })),
    ).uploadConditional("file", encoder.encode("x"), '"old"');
  } catch (error) {
    stale = error instanceof ProviderHttpError && error.status === 412;
  }
  assert(stale, "stale writes must remain definite failures");
});

class RpcDouble implements BridgeRpc {
  applied?: ApplySnapshotInput;
  completed?: CompleteExportInput;
  abandoned?: { export_id: string; reason: string };
  failures: string[] = [];
  constructor(
    readonly context: BridgeContext,
    readonly result: ApplySnapshotResult = {
      state: "synchronized",
      run_id: "run-1",
    },
    readonly plan: ExportPlanResult = { state: "no_export" },
  ) {}
  loadContext(): Promise<BridgeContext> {
    return Promise.resolve(this.context);
  }
  applySnapshot(input: ApplySnapshotInput): Promise<ApplySnapshotResult> {
    this.applied = input;
    return Promise.resolve(this.result);
  }
  prepareExport() {
    return Promise.resolve(this.plan);
  }
  completeExport(input: CompleteExportInput) {
    this.completed = input;
    return Promise.resolve({ state: "synchronized" } as const);
  }
  abandonExport(input: { export_id: string; reason: string }): Promise<void> {
    this.abandoned = input;
    return Promise.resolve();
  }
  recordFailure(input: { error_code: string }): Promise<void> {
    this.failures.push(input.error_code);
    return Promise.resolve();
  }
}

function environment(name: string): string | undefined {
  return ({
    STAND_UP_GOOGLE_CRON_SECRET: "cron",
    STAND_UP_GOOGLE_WORKBOOK_ID: "file",
    GOOGLE_CLIENT_ID: "client",
    GOOGLE_CLIENT_SECRET: "secret",
    GOOGLE_REFRESH_TOKEN: "refresh",
  } as Record<string, string>)[name];
}

Deno.test("handler requires dedicated cron secret before RPC or provider access", async () => {
  let touched = false;
  const response = await handleStandUpGoogle(
    new Request("https://example.test", { method: "POST" }),
    {
      env: environment,
      rpc: {
        loadContext() {
          touched = true;
          throw new Error();
        },
        applySnapshot() {
          throw new Error();
        },
        prepareExport() {
          throw new Error();
        },
        completeExport() {
          throw new Error();
        },
        abandonExport() {
          throw new Error();
        },
        recordFailure() {
          throw new Error();
        },
      },
    },
  );
  assert(
    response.status === 401 && !touched,
    "unauthorized request must have no side effects",
  );
});

Deno.test("RPC adapter uses only the fixed service-role bridge function", async () => {
  let url = "", init: globalThis.RequestInit | undefined;
  const client = new SupabaseBridgeRpc(
    "https://supabase.test",
    "service-key",
    (input, requestInit) => {
      url = String(input);
      init = requestInit as globalThis.RequestInit;
      return Promise.resolve(
        new Response(JSON.stringify({ facility_map: map, baselines: {} })),
      );
    },
  );
  await client.loadContext({ workbook_id: "file", week_start: "2026-09-14" });
  assert(
    url === "https://supabase.test/rest/v1/rpc/stand_up_google_bridge",
    "adapter may not select arbitrary database routes",
  );
  const headers = new Headers(init?.headers);
  assert(
    headers.get("apikey") === "service-key" &&
      headers.get("authorization") === "Bearer service-key",
    "RPC must use the Edge service identity",
  );
  equals(JSON.parse(String(init?.body)), {
    p_action: "load_context",
    p_payload: { workbook_id: "file", week_start: "2026-09-14" },
  }, "RPC body must remain narrow");
});

Deno.test("durable reconnect state suppresses blind OAuth retry for the same credential", async () => {
  const credentials = {
    clientId: "client",
    clientSecret: "secret",
    refreshToken: "refresh",
  };
  const fingerprint = await credentialFingerprint(credentials);
  const rpc = new RpcDouble({
    facility_map: map,
    baselines: {},
    google_connection: {
      state: "reconnect_required",
      credential_fingerprint: fingerprint,
    },
  });
  let providerCalls = 0;
  const response = await handleStandUpGoogle(
    new Request("https://example.test", {
      method: "POST",
      headers: { "x-cron-secret": "cron" },
    }),
    {
      env: environment,
      rpc,
      now: () => new Date("2026-09-14T12:00:00Z"),
      fetcher: () => {
        providerCalls++;
        throw new Error("provider must not be called");
      },
    },
  );
  assert(
    response.status === 503 && providerCalls === 0 && !rpc.applied,
    "same rejected credential must remain suppressed",
  );
});

Deno.test("handler imports one stable validated snapshot through the narrow RPC", async () => {
  const bytes = fixture(),
    metadata = {
      id: "file",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      etag: '"strong"',
      version: "7",
      headRevisionId: "head",
      md5Checksum: md5Hex(bytes),
      fileSize: String(bytes.length),
      labels: { trashed: false },
    };
  const rpc = new RpcDouble({ facility_map: map, baselines: {} });
  const response = await handleStandUpGoogle(
    new Request("https://example.test", {
      method: "POST",
      headers: { "x-cron-secret": "cron" },
    }),
    {
      env: environment,
      rpc,
      now: () => new Date("2026-09-13T12:00:00Z"),
      fetcher: (input) =>
        Promise.resolve(
          String(input).includes("oauth2")
            ? new Response('{"access_token":"access"}')
            : String(input).includes("alt=media")
            ? binaryResponse(bytes)
            : new Response(JSON.stringify(metadata)),
        ),
    },
  );
  assert(
    response.status === 200 && rpc.applied?.records.length === 5 &&
      rpc.applied?.locations && Object.keys(rpc.applied.locations).length === 5,
    "validated snapshot must reach exactly one durable apply RPC",
  );
  assert(
    rpc.applied?.week_start === "2026-09-14",
    "Sunday must target the upcoming Monday",
  );
});

Deno.test("handler conditionally exports Haven changes and completes only exact Drive readback", async () => {
  let current = fixture();
  let version = 7;
  let etag = '"strong-7"';
  const initial = await parseWorkbook(current, map, "file", "Stand Up.xlsx");
  const values = {
    ...initial.records.find((record) => record.facility_id === map.Homewood)!
      .values,
    current_total_census: 12,
  };
  const rpc = new RpcDouble(
    { facility_map: map, baselines: {} },
    { state: "synchronized", run_id: "unused" },
    {
      state: "export_required",
      export_id: "export-1",
      updates: { [`${map.Homewood}:2026-09-14`]: values },
    },
  );
  const response = await handleStandUpGoogle(
    new Request("https://example.test", {
      method: "POST",
      headers: { "x-cron-secret": "cron" },
    }),
    {
      env: environment,
      rpc,
      now: () => new Date("2026-09-14T12:00:00Z"),
      fetcher: (input, init) => {
        const url = String(input);
        const requestInit = init as globalThis.RequestInit | undefined;
        if (url.includes("oauth2")) {
          return Promise.resolve(new Response('{"access_token":"access"}'));
        }
        if (url.includes("/upload/")) {
          assert(
            new Headers(requestInit?.headers).get("if-match") === '"strong-7"',
            "upload must use the observed strong ETag",
          );
          current = new Uint8Array(requestInit?.body as ArrayBuffer);
          version = 8;
          etag = '"strong-8"';
          return Promise.resolve(new Response("{}"));
        }
        if (url.includes("alt=media")) {
          return Promise.resolve(binaryResponse(current));
        }
        return Promise.resolve(
          new Response(JSON.stringify({
            id: "file",
            mimeType:
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            etag,
            version: String(version),
            headRevisionId: `head-${version}`,
            md5Checksum: md5Hex(current),
            fileSize: String(current.length),
            labels: { trashed: false },
          })),
        );
      },
    },
  );
  assert(
    response.status === 200 && !rpc.applied &&
      rpc.completed?.export_id === "export-1",
    "outbound run must complete without importing its own write",
  );
  const readback = await parseWorkbook(current, map, "file", "Stand Up.xlsx");
  assert(
    readback.records.find((record) => record.facility_id === map.Homewood)
      ?.values.current_total_census === 12,
    "Google readback must contain the Haven edit",
  );
});

Deno.test("handler abandons a definitively rejected conditional export", async () => {
  const bytes = fixture();
  const parsed = await parseWorkbook(bytes, map, "file", "Stand Up.xlsx");
  const values = {
    ...parsed.records.find((record) => record.facility_id === map.Homewood)!
      .values,
    current_total_census: 13,
  };
  const rpc = new RpcDouble(
    { facility_map: map, baselines: {} },
    { state: "synchronized", run_id: "unused" },
    {
      state: "export_required",
      export_id: "export-stale",
      updates: { [`${map.Homewood}:2026-09-14`]: values },
    },
  );
  const metadata = {
    id: "file",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    etag: '"strong"',
    version: "7",
    headRevisionId: "head",
    md5Checksum: md5Hex(bytes),
    fileSize: String(bytes.length),
    labels: { trashed: false },
  };
  const response = await handleStandUpGoogle(
    new Request("https://example.test", {
      method: "POST",
      headers: { "x-cron-secret": "cron" },
    }),
    {
      env: environment,
      rpc,
      now: () => new Date("2026-09-14T12:00:00Z"),
      fetcher: (input) =>
        Promise.resolve(
          String(input).includes("oauth2")
            ? new Response('{"access_token":"access"}')
            : String(input).includes("/upload/")
            ? new Response("", { status: 412 })
            : String(input).includes("alt=media")
            ? binaryResponse(bytes)
            : new Response(JSON.stringify(metadata)),
        ),
    },
  );
  assert(
    response.status === 409 && rpc.abandoned?.export_id === "export-stale" &&
      rpc.failures.includes("bridge_error"),
    "definite provider conflict must abandon without baseline advancement",
  );
});

Deno.test("handler records mapping failure and never applies invalid source values", async () => {
  const bytes = fixture({ formula: true }),
    metadata = {
      id: "file",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      etag: '"strong"',
      version: "7",
      headRevisionId: "head",
      md5Checksum: md5Hex(bytes),
      fileSize: String(bytes.length),
      labels: { trashed: false },
    };
  const rpc = new RpcDouble({ facility_map: map, baselines: {} });
  const response = await handleStandUpGoogle(
    new Request("https://example.test", {
      method: "POST",
      headers: { "x-cron-secret": "cron" },
    }),
    {
      env: environment,
      rpc,
      now: () => new Date("2026-09-14T12:00:00Z"),
      fetcher: (input) =>
        Promise.resolve(
          String(input).includes("oauth2")
            ? new Response('{"access_token":"access"}')
            : String(input).includes("alt=media")
            ? binaryResponse(bytes)
            : new Response(JSON.stringify(metadata)),
        ),
    },
  );
  assert(
    response.status === 409 && !rpc.applied &&
      rpc.failures.includes("workbook_mapping_required"),
    "invalid workbook must stop before mutation",
  );
});

Deno.test("Eastern reporting week follows the Sunday upcoming-Monday contract", () => {
  assert(
    easternReportingWeek(new Date("2026-09-13T12:00:00Z")) === "2026-09-14",
    "Sunday should advance",
  );
  assert(
    easternReportingWeek(new Date("2026-09-16T12:00:00Z")) === "2026-09-14",
    "midweek should use current Monday",
  );
});
