export const CURRENT_REFRESH_SECONDS = 240;

export const FACILITIES = [
  "Homewood",
  "Oakridge",
  "Rising Oaks",
  "Plantation",
  "Grande Cypress",
] as const;

const PREFIXES: Record<(typeof FACILITIES)[number], string> = {
  Homewood: "homewood",
  Oakridge: "oakridge",
  "Rising Oaks": "rising_oaks",
  Plantation: "plantation",
  "Grande Cypress": "grande_cypress",
};

export const METRIC_KEYS = [
  "monthly_rent_roll_cents",
  "current_total_census",
  "sp_female_beds_open",
  "sp_male_beds_open",
  "sp_flexible_beds_open",
  "private_beds_open",
  "admissions_expected",
  "hospital_and_rehab_total",
  "expected_discharges",
  "callouts_last_week",
  "terminations_last_week",
  "current_open_positions",
  "overtime_reported",
  "tours_expected",
  "provider_activities_expected",
  "outreach_engagements",
] as const;

type MetricKey = (typeof METRIC_KEYS)[number];
type JsonObject = Record<string, unknown>;

export type AggregateWorkspace = {
  facilities: Array<{ id: string; name: string }>;
  reports: Array<{
    facility_id: string;
    week_start: string;
    status: string;
    version: number;
    values: Record<MetricKey, number | null>;
    source_as_of?: string | null;
    entry_origin?: string;
    first_submitted_at?: string | null;
    last_submitted_at?: string | null;
    overtime_minutes?: number | null;
    overtime_issue?: boolean;
    field_dispositions?: Record<string, string> | null;
    roster_confirmations?: Record<string, RosterConfirmation> | null;
  }>;
};

/** COL-351 roster source, recorded by haven.stand_up_save. Counts and tokens only. */
export type RosterConfirmation = {
  source?: unknown;
  override_reason?: unknown;
  roster_as_of?: unknown;
};

export type SourcePayload = {
  source: "col";
  dataset: "standup_weekly";
  contractVersion: 1;
  batchId: string;
  sequence: number;
  sourceAsOf: string;
  mode: "full";
  complete: true;
  rows: Array<{ metric: string; value: number }>;
};

export type DurablePending = {
  body: string;
  fingerprint: string;
  sequence: number;
  first_sent_at: string | null;
};

export type PublisherLease = {
  leaseToken?: string;
  generation?: number;
  facilityMap: Record<(typeof FACILITIES)[number], string>;
  sequence: number;
  lastFingerprint: string | null;
  lastAdmittedAt: string | number | null;
  pending: DurablePending | null;
};

export type StorePendingInput = {
  body: string;
  fingerprint: string;
  sequence: number;
  firstSentAt: string;
};

export interface PublisherStore {
  acquire(runId: string): Promise<PublisherLease | null>;
  loadWorkspace(week: string): Promise<AggregateWorkspace>;
  storePending(
    runId: string,
    pending: StorePendingInput,
  ): Promise<DurablePending>;
  complete(
    runId: string,
    receiptId: string,
    replayed: boolean,
    admittedAt: string | null,
  ): Promise<void>;
  reject(runId: string, status: number, definite: boolean): Promise<void>;
  release(runId: string, outcome: string, errorCode?: string): Promise<void>;
}

export type PublisherConfig = {
  ingestUrl: string;
  ingestKeyId: string;
  ingestSecret: string;
};

export type PublisherResult = {
  outcome: "accepted" | "unchanged" | "busy";
  sequence?: number;
  receiptId?: string;
};

export class PublisherError extends Error {
  constructor(message: string, public readonly code = "publisher_failed") {
    super(message);
  }
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertUuid(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) throw new PublisherError(`Invalid ${label}`);
}

function exactMetricValues(value: unknown): Record<MetricKey, number | null> {
  if (!isObject(value)) {
    throw new PublisherError("Unexpected source metric contract");
  }
  const keys = Object.keys(value).sort();
  const expected = [...METRIC_KEYS].sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  ) {
    throw new PublisherError("Unexpected source metric contract");
  }
  for (const key of METRIC_KEYS) {
    const item = value[key];
    if (item !== null && (typeof item !== "number" || !Number.isFinite(item))) {
      throw new PublisherError("Non-numeric aggregate refused");
    }
  }
  return value as Record<MetricKey, number | null>;
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

/**
 * Roster source transport, spec section 12. Published only when every report in
 * the payload carries stored confirmations, so a Haven that does not record
 * them stays a legacy payload. Counts and tokens only: no resident identifier
 * ever reaches this row set.
 */
const ROSTER_SOURCE_VERSION = 1;
const ROSTER_KEYS = [
  "current_total_census",
  "hospital_and_rehab_total",
] as const;
const ROSTER_SOURCE_CODES: Record<string, number> = {
  roster_confirmed: 1,
  entered_no_roster: 2,
  overridden: 3,
};
const OVERRIDE_REASON_CODES: Record<string, number> = {
  roster_not_current: 1,
  change_not_entered: 2,
  different_definition: 3,
  other: 4,
};

function rosterMap(
  value: unknown,
  values: Record<string, number | null>,
): Record<string, RosterConfirmation> | null | undefined {
  if (value === undefined || value === null) return value;
  if (!isObject(value)) {
    throw new PublisherError("Unexpected source roster confirmations");
  }
  for (const [key, entry] of Object.entries(value)) {
    if (
      !(ROSTER_KEYS as readonly string[]).includes(key) || !isObject(entry)
    ) {
      throw new PublisherError("Unexpected source roster confirmations");
    }
    const source = (entry as RosterConfirmation).source;
    const reason = (entry as RosterConfirmation).override_reason ?? null;
    if (
      typeof source !== "string" ||
      !Object.hasOwn(ROSTER_SOURCE_CODES, source) ||
      values[key] === null || values[key] === undefined
    ) {
      throw new PublisherError("Unexpected source roster confirmations");
    }
    if (
      (source === "overridden") !== (reason !== null) ||
      (reason !== null &&
        (typeof reason !== "string" ||
          !Object.hasOwn(OVERRIDE_REASON_CODES, reason)))
    ) {
      throw new PublisherError("Unexpected source roster confirmations");
    }
  }
  return value as Record<string, RosterConfirmation>;
}

/** Source, override reason and roster as-of rows for one reported facility. */
function rosterRows(
  prefix: string,
  report: AggregateWorkspace["reports"][number],
): SourcePayload["rows"] {
  const confirmations = rosterMap(report.roster_confirmations, report.values) ??
    {};
  const rows: SourcePayload["rows"] = [];
  let asOf: number | null = null;
  for (const key of ROSTER_KEYS) {
    const entry = confirmations[key];
    if (entry === undefined) continue;
    rows.push({
      metric: `${prefix}_${key}_source`,
      value: ROSTER_SOURCE_CODES[entry.source as string],
    });
    if (entry.source === "overridden") {
      rows.push({
        metric: `${prefix}_${key}_override_reason`,
        value: OVERRIDE_REASON_CODES[entry.override_reason as string],
      });
    }
    if (entry.roster_as_of && asOf === null) {
      asOf = Math.floor(
        explicitTimestamp(entry.roster_as_of, "roster as-of").getTime() / 1000,
      );
    }
  }
  if (asOf !== null) {
    rows.push({ metric: `${prefix}_roster_as_of_epoch`, value: asOf });
  }
  return rows;
}

function dispositionMap(
  value: unknown,
): Record<string, string> | null | undefined {
  if (value === undefined || value === null) return value;
  if (
    !isObject(value) ||
    Object.entries(value).some(([key, item]) =>
      !key || typeof item !== "string"
    )
  ) {
    throw new PublisherError("Unexpected source field dispositions");
  }
  return value as Record<string, string>;
}

function overtimeMinutes(value: number | null): number | null {
  if (value === null) return null;
  if (
    !Number.isFinite(value) || value < 0 || value > 35_791_394.59 ||
    Number(value.toFixed(2)) !== value
  ) {
    throw new PublisherError(
      "Overtime must use hours and minutes with at most two decimal places",
    );
  }
  const hours = Math.trunc(value);
  const minutes = Math.round((value - hours) * 100);
  const total = hours * 60 + minutes;
  if (minutes > 59 || total > 2_147_483_647) {
    throw new PublisherError("Overtime minute component must be 00 through 59");
  }
  return total;
}

function utcDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysSinceEpoch(isoDate: string): number {
  const milliseconds = Date.parse(`${isoDate}T00:00:00.000Z`);
  if (
    !Number.isFinite(milliseconds) ||
    utcDateString(new Date(milliseconds)) !== isoDate
  ) {
    throw new PublisherError("Invalid reporting week");
  }
  return Math.floor(milliseconds / 86_400_000);
}

function addUtcDays(isoDate: string, days: number): string {
  return utcDateString(new Date((daysSinceEpoch(isoDate) + days) * 86_400_000));
}

export function reportingWeek(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value;
  const localDate = `${part("year")}-${part("month")}-${part("day")}`;
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    part("weekday") ?? "",
  );
  if (weekday < 0) {
    throw new PublisherError("Unable to determine reporting week");
  }
  return addUtcDays(localDate, weekday === 0 ? 1 : 1 - weekday);
}

function checkedFacilityMap(
  workspace: AggregateWorkspace,
  configured: Record<string, unknown>,
): Record<(typeof FACILITIES)[number], string> {
  if (!Array.isArray(workspace.facilities)) {
    throw new PublisherError("Invalid source facilities");
  }
  if (
    Object.keys(configured).sort().join("|") !==
      [...FACILITIES].sort().join("|")
  ) {
    throw new PublisherError("Unexpected protected facility mapping");
  }
  const result = {} as Record<(typeof FACILITIES)[number], string>;
  const ids = new Set<string>();
  for (const name of FACILITIES) {
    const id = configured[name];
    assertUuid(id, "mapped facility id");
    if (ids.has(id)) {
      throw new PublisherError("Duplicate source facility mapping");
    }
    if (!workspace.facilities.some((facility) => facility?.id === id)) {
      throw new PublisherError(
        "Protected mapping does not belong to aggregate facilities",
      );
    }
    ids.add(id);
    result[name] = id;
  }
  return result;
}

function normalizedWorkspace(value: unknown): AggregateWorkspace {
  if (
    !isObject(value) || !Array.isArray(value.facilities) ||
    !Array.isArray(value.reports)
  ) {
    throw new PublisherError("Invalid Stand Up aggregate export");
  }
  return value as AggregateWorkspace;
}

function fieldState(
  report: AggregateWorkspace["reports"][number],
  key: MetricKey,
  overtimeIssue: boolean,
): number {
  if (key === "overtime_reported" && overtimeIssue) return 3;
  if (report.values[key] === null) {
    return dispositionMap(report.field_dispositions)?.[key] ===
        "historical_unit_unconfirmed"
      ? 2
      : 1;
  }
  return 0;
}

export function buildSourcePayload(
  rawWorkspace: unknown,
  configuredFacilityMap: Record<string, unknown>,
  week: string,
  sequence: number,
  now = new Date(),
  batchId: string = crypto.randomUUID(),
): SourcePayload {
  if (!Number.isSafeInteger(sequence) || sequence <= 0) {
    throw new PublisherError("Invalid publisher sequence");
  }
  assertUuid(batchId, "batch id");
  const workspace = normalizedWorkspace(rawWorkspace);
  const mapping = checkedFacilityMap(workspace, configuredFacilityMap);
  const reports = workspace.reports.filter((report) =>
    report?.week_start === week
  );
  const byFacility = new Map<string, AggregateWorkspace["reports"][number]>();
  for (const rawReport of reports) {
    if (!isObject(rawReport)) throw new PublisherError("Invalid source report");
    assertUuid(rawReport.facility_id, "report facility id");
    if (byFacility.has(rawReport.facility_id)) {
      throw new PublisherError("Duplicate source facility/week");
    }
    if (!Number.isSafeInteger(rawReport.version) || rawReport.version < 0) {
      throw new PublisherError("Invalid source revision");
    }
    rawReport.values = exactMetricValues(rawReport.values);
    dispositionMap(rawReport.field_dispositions);
    rosterMap(rawReport.roster_confirmations, rawReport.values);
    byFacility.set(rawReport.facility_id, rawReport);
  }

  const rows: SourcePayload["rows"] = [
    { metric: "week_of_day", value: daysSinceEpoch(week) },
    { metric: "expected_facilities", value: 5 },
  ];
  const versioned = reports.every((report) =>
    report.field_dispositions !== undefined &&
    report.field_dispositions !== null
  );
  if (versioned) rows.push({ metric: "field_state_version", value: 1 });
  // Roster rows follow the same rule: every report must carry stored
  // confirmations, otherwise the payload stays legacy for this section.
  const rosterVersioned = reports.every((report) =>
    report.roster_confirmations !== undefined &&
    report.roster_confirmations !== null
  );
  if (rosterVersioned) {
    rows.push({
      metric: "roster_source_version",
      value: ROSTER_SOURCE_VERSION,
    });
  }
  const observedAt = new Date(now);
  if (!Number.isFinite(observedAt.getTime())) {
    throw new PublisherError("Invalid observation time");
  }
  const sourceTimes: Date[] = [];

  for (const name of FACILITIES) {
    const prefix = PREFIXES[name];
    const report = byFacility.get(mapping[name]);
    const reported = Boolean(
      report && METRIC_KEYS.some((key) => report.values[key] !== null),
    );
    rows.push(
      { metric: `${prefix}_reported`, value: reported ? 1 : 0 },
      {
        metric: `${prefix}_ready`,
        value: reported && report?.status === "ready" ? 1 : 0,
      },
      { metric: `${prefix}_revision`, value: report?.version ?? 0 },
    );
    if (report) {
      let minutes: number | null = null;
      let overtimeIssue = false;
      try {
        minutes = overtimeMinutes(report.values.overtime_reported);
      } catch {
        overtimeIssue = true;
      }
      if (
        Object.hasOwn(report, "overtime_minutes") &&
        report.overtime_minutes !== minutes
      ) {
        throw new PublisherError(
          "Canonical overtime does not match retained HH.MM source",
        );
      }
      if (
        Object.hasOwn(report, "overtime_issue") &&
        report.overtime_issue !== overtimeIssue
      ) {
        throw new PublisherError(
          "Canonical overtime review flag does not match source",
        );
      }
      rows.push({
        metric: `${prefix}_overtime_issue`,
        value: overtimeIssue ? 1 : 0,
      });
      if (minutes !== null) {
        rows.push({ metric: `${prefix}_overtime_minutes`, value: minutes });
      }
      if (Object.hasOwn(report, "entry_origin")) {
        const origins: Record<string, number> = {
          initialized: 0,
          imported: 1,
          manual: 2,
          recovery: 3,
        };
        if (
          typeof report.entry_origin !== "string" ||
          !(report.entry_origin in origins)
        ) {
          throw new PublisherError("Unexpected source entry origin");
        }
        rows.push({
          metric: `${prefix}_entry_origin`,
          value: origins[report.entry_origin],
        });
      }
      for (
        const [field, metric] of [
          ["first_submitted_at", "first_submitted_epoch"],
          ["last_submitted_at", "last_submitted_epoch"],
        ] as const
      ) {
        const value = report[field];
        if (value) {
          rows.push({
            metric: `${prefix}_${metric}`,
            value: Math.floor(
              explicitTimestamp(value, "submission timestamp").getTime() / 1000,
            ),
          });
        }
      }
      rows.push({
        metric: `${prefix}_needs_resubmission`,
        value: report.last_submitted_at && report.status !== "ready" ? 1 : 0,
      });

      if (!reported) continue;
      if (report.source_as_of) {
        const stamp = explicitTimestamp(
          report.source_as_of,
          "source timestamp",
        );
        rows.push({
          metric: `${prefix}_as_of_epoch`,
          value: Math.floor(stamp.getTime() / 1000),
        });
        sourceTimes.push(stamp);
      } else {
        sourceTimes.push(new Date(`${week}T00:00:00.000Z`));
      }
      for (const key of METRIC_KEYS) {
        const value = report.values[key];
        if (value !== null) rows.push({ metric: `${prefix}_${key}`, value });
      }
      if (versioned) {
        for (const key of METRIC_KEYS) {
          rows.push({
            metric: `${prefix}_${key}_state`,
            value: fieldState(report, key, overtimeIssue),
          });
        }
      }
      if (rosterVersioned) rows.push(...rosterRows(prefix, report));
    }
  }

  const asOf = new Date(
    Math.min(
      observedAt.getTime(),
      ...sourceTimes.map((stamp) => stamp.getTime()),
    ),
  );
  return {
    source: "col",
    dataset: "standup_weekly",
    contractVersion: 1,
    batchId,
    sequence,
    sourceAsOf: asOf.toISOString().replace(/\.\d{3}Z$/, (value) => value),
    mode: "full",
    complete: true,
    rows,
  };
}

export function stableStringify(value: unknown): string {
  if (
    value === null || typeof value === "boolean" || typeof value === "string"
  ) return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new PublisherError("Non-finite JSON number refused");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isObject(value)) {
    return `{${
      Object.keys(value).sort().map((key) =>
        `${JSON.stringify(key)}:${stableStringify(value[key])}`
      ).join(",")
    }}`;
  }
  throw new PublisherError("Unsupported JSON value");
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function signIngest(
  secret: string,
  keyId: string,
  sentAt: string,
  body: string,
): Promise<string> {
  if (new TextEncoder().encode(secret).length < 32) {
    throw new PublisherError(
      "Front Office HMAC secret must be at least 32 bytes",
      "invalid_config",
    );
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const canonical =
    `front-office-ingest-v1\nPOST\napplication/json\n${keyId}\n${sentAt}\n${body}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonical)),
  );
  return [...signature].map((byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function epochSeconds(value: string | number | null): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const milliseconds = Date.parse(value);
    return Number.isFinite(milliseconds) ? milliseconds / 1000 : null;
  }
  return null;
}

function definiteRejection(status: number): boolean {
  return [400, 401, 403, 404, 409, 413, 415, 422].includes(status);
}

function receipt(value: unknown): { receiptId: string; replayed: boolean } {
  if (
    !isObject(value) || typeof value.receiptId !== "string" || !value.receiptId
  ) {
    throw new PublisherError(
      "Missing Front Office acceptance receipt",
      "invalid_receipt",
    );
  }
  // The legacy worker treats only an explicit false as a new admission. A
  // missing or malformed replay flag therefore uses the conservative first
  // attempt bound instead of claiming that a replay refreshed the receiver.
  return { receiptId: value.receiptId, replayed: value.replayed !== false };
}

async function boundedJson(
  response: Response,
  maximumBytes = 65_536,
): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    await response.body?.cancel();
    throw new PublisherError(
      "Front Office receipt exceeds size limit",
      "invalid_receipt",
    );
  }
  const reader = response.body?.getReader();
  if (!reader) {
    throw new PublisherError(
      "Missing Front Office acceptance receipt",
      "invalid_receipt",
    );
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel();
      throw new PublisherError(
        "Front Office receipt exceeds size limit",
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
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

export async function runPublisher(
  store: PublisherStore,
  config: PublisherConfig,
  options: {
    now?: Date;
    runId?: string;
    week?: string;
    batchId?: string;
    fetch?: typeof fetch;
  } = {},
): Promise<PublisherResult> {
  const now = options.now ?? new Date();
  const nowEpoch = now.getTime() / 1000;
  if (!Number.isFinite(nowEpoch)) {
    throw new PublisherError("Invalid publisher time");
  }
  const runId = options.runId ?? crypto.randomUUID();
  assertUuid(runId, "run id");
  let ingestUrl: URL;
  try {
    ingestUrl = new URL(config.ingestUrl);
  } catch {
    throw new PublisherError(
      "Invalid Front Office ingest URL",
      "invalid_config",
    );
  }
  if (
    ingestUrl.protocol !== "https:" || ingestUrl.username || ingestUrl.password
  ) {
    throw new PublisherError(
      "Front Office ingest URL must use HTTPS",
      "invalid_config",
    );
  }
  if (!config.ingestKeyId.trim()) {
    throw new PublisherError(
      "Missing Front Office ingest key id",
      "invalid_config",
    );
  }
  const lease = await store.acquire(runId);
  if (!lease) return { outcome: "busy" };
  let releaseOutcome = "failed";
  let releaseError: string | undefined;
  try {
    let pending = lease.pending;
    if (!pending) {
      const workspace = await store.loadWorkspace(
        options.week ?? reportingWeek(now),
      );
      const payload = buildSourcePayload(
        workspace,
        lease.facilityMap,
        options.week ?? reportingWeek(now),
        lease.sequence + 1,
        now,
        options.batchId,
      );
      const fingerprint = await sha256Hex(
        stableStringify({ rows: payload.rows, sourceAsOf: payload.sourceAsOf }),
      );
      const lastAdmitted = epochSeconds(lease.lastAdmittedAt);
      const recentlyAdmitted = lastAdmitted !== null &&
        nowEpoch >= lastAdmitted &&
        nowEpoch - lastAdmitted < CURRENT_REFRESH_SECONDS;
      if (fingerprint === lease.lastFingerprint && recentlyAdmitted) {
        releaseOutcome = "unchanged";
        return { outcome: "unchanged", sequence: lease.sequence };
      }
      const body = stableStringify(payload);
      pending = await store.storePending(runId, {
        body,
        fingerprint,
        sequence: payload.sequence,
        firstSentAt: now.toISOString(),
      });
    }

    const body = pending.body;
    const sentAtEpoch = Math.floor(nowEpoch).toString();
    const signature = await signIngest(
      config.ingestSecret,
      config.ingestKeyId,
      sentAtEpoch,
      body,
    );
    let response: Response;
    try {
      response = await (options.fetch ?? fetch)(ingestUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ingest-key-id": config.ingestKeyId,
          "x-ingest-sent-at": sentAtEpoch,
          "x-ingest-signature": signature,
        },
        body,
        redirect: "error",
        signal: AbortSignal.timeout(25_000),
      });
    } catch {
      releaseError = "front_office_outcome_unknown";
      releaseOutcome = "outcome_unknown";
      throw new PublisherError(
        "Front Office outcome unknown; pending request retained",
        releaseError,
      );
    }
    if (!response.ok) {
      const definite = definiteRejection(response.status);
      await store.reject(runId, response.status, definite);
      releaseOutcome = definite ? "rejected" : "outcome_unknown";
      releaseError = definite
        ? "front_office_rejected"
        : "front_office_retryable";
      throw new PublisherError("Front Office publication failed", releaseError);
    }
    let parsed: unknown;
    try {
      parsed = await boundedJson(response);
    } catch {
      releaseError = "invalid_receipt";
      releaseOutcome = "outcome_unknown";
      throw new PublisherError(
        "Invalid Front Office acceptance receipt",
        releaseError,
      );
    }
    const accepted = receipt(parsed);
    const firstSent = epochSeconds(pending.first_sent_at);
    let admittedAt: string | null = accepted.replayed
      ? (firstSent === null ? null : new Date(firstSent * 1000).toISOString())
      : now.toISOString();
    if (
      admittedAt !== null &&
      (Date.parse(admittedAt) / 1000 > nowEpoch ||
        Date.parse(admittedAt) / 1000 < 0)
    ) admittedAt = null;
    await store.complete(
      runId,
      accepted.receiptId,
      accepted.replayed,
      admittedAt,
    );
    releaseOutcome = "accepted";
    return {
      outcome: "accepted",
      sequence: pending.sequence,
      receiptId: accepted.receiptId,
    };
  } catch (error) {
    if (error instanceof PublisherError && !releaseError) {
      releaseError = error.code;
    }
    throw error;
  } finally {
    try {
      await store.release(runId, releaseOutcome, releaseError);
    } catch {
      // Release is operational cleanup. It must never replace the publication
      // result or a primary failure; the short lease expires independently.
      console.error(
        JSON.stringify({ event: "stand_up_publisher_release_failed" }),
      );
    }
  }
}
