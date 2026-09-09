import { createHash } from "node:crypto";

export interface Snapshot {
  schema_version: 1;
  policy_id: string;
  account_id: string;
  policy_number: string;
  carrier: string | null;
  line_of_business: string | null;
  named_insured: string | null;
  effective_date: string | null;
  expiration_date: string | null;
  premium: number | null;
  status: string | null;
}
export interface ManifestEntry {
  policy_id: string;
  release_id: string;
  sequence: string;
}
export interface Receipt {
  validator_version: 1;
  policy_id: string;
  sequence: string;
  created_at: string;
  hash: string | null;
  snapshot: Snapshot | null;
  conflict: boolean;
  quarantine: string | null;
  needs_confirmation: boolean;
}
export interface Recovery {
  policy_id: string;
  reason: string;
  attempts: number;
  status: "pending" | "awaiting_confirmation" | "resolved" | "exhausted";
}
export interface ReceiverState {
  version: 1;
  cursor: string;
  replay_cursor: string;
  recovery_active: boolean;
  authorization_checked_at: string | null;
  source_as_of: string | null;
  manifest: ManifestEntry[];
  receipts: Record<string, Receipt>;
  recovery: Record<string, Recovery>;
  health: "never_synced" | "healthy" | "degraded" | "credential_rejected";
}
export interface ApplyOptions {
  integrationId: string;
  after: string;
  mode: "normal" | "recovery";
  now: string;
  approvedAccountIds: readonly string[];
  limit?: number;
}
interface Event {
  id: string;
  policy_id: string;
  sequence: string;
  kind: "released" | "withdrawn";
  snapshot: unknown;
  created_at: string;
}
export interface FeedPage {
  schema_version: 1;
  integration_id: string;
  as_of: string;
  current_authorized_releases: ManifestEntry[];
  events: Event[];
  next_cursor: string;
  has_more: boolean;
}
export class InvalidFeedControls extends Error {
  constructor() {
    super(
      "InsureFlow response controls are invalid; the page was not applied.",
    );
    this.name = "InvalidFeedControls";
  }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CURSOR = BigInt("9223372036854775807");
const MAX_RECOVERY_ATTEMPTS = 3;
function object(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function keys(v: Record<string, unknown>, expected: readonly string[]) {
  return (
    Object.keys(v).length === expected.length &&
    expected.every((k) => Object.hasOwn(v, k))
  );
}
function uuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}
export function isCursor(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^(0|[1-9][0-9]{0,18})$/.test(v) &&
    BigInt(v) <= MAX_CURSOR
  );
}
function date(v: unknown): v is string {
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    v.startsWith("0000-")
  )
    return false;
  const d = new Date(v + "T00:00:00Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
function timestamp(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      v,
    ) &&
    date(v.slice(0, 10)) &&
    Number.isFinite(Date.parse(v))
  );
}
function requireControl(ok: unknown): asserts ok {
  if (!ok) throw new InvalidFeedControls();
}
/** No state mutation or snapshot trust until ALL page controls pass. */
export function validateFeedPage(
  raw: unknown,
  integrationId: string,
  after: string,
  limit = 100,
): FeedPage {
  requireControl(
    uuid(integrationId) &&
      isCursor(after) &&
      Number.isInteger(limit) &&
      limit >= 1 &&
      limit <= 100,
  );
  requireControl(
    object(raw) &&
      keys(raw, ["success", "data"]) &&
      raw.success === true &&
      object(raw.data),
  );
  const d = raw.data;
  requireControl(
    keys(d, [
      "schema_version",
      "integration_id",
      "as_of",
      "current_authorized_releases",
      "events",
      "next_cursor",
      "has_more",
    ]),
  );
  requireControl(
    d.schema_version === 1 &&
      d.integration_id === integrationId &&
      timestamp(d.as_of),
  );
  requireControl(
    Array.isArray(d.current_authorized_releases) &&
      Array.isArray(d.events) &&
      d.events.length <= limit,
  );
  requireControl(isCursor(d.next_cursor) && typeof d.has_more === "boolean");
  const policies = new Set<string>(),
    releases = new Set<string>(),
    sequences = new Set<string>();
  const manifest = new Map<string, ManifestEntry>();
  for (const m of d.current_authorized_releases) {
    requireControl(
      object(m) &&
        keys(m, ["policy_id", "release_id", "sequence"]) &&
        uuid(m.policy_id) &&
        uuid(m.release_id) &&
        isCursor(m.sequence) &&
        m.sequence !== "0",
    );
    requireControl(
      !policies.has(m.policy_id.toLowerCase()) &&
        !releases.has(m.release_id.toLowerCase()) &&
        !sequences.has(m.sequence),
    );
    policies.add(m.policy_id.toLowerCase());
    releases.add(m.release_id.toLowerCase());
    sequences.add(m.sequence);
    manifest.set(m.release_id, m as unknown as ManifestEntry);
  }
  let previous = BigInt(after);
  const eventIds = new Set<string>();
  for (const e of d.events) {
    requireControl(
      object(e) &&
        (keys(e, [
          "id",
          "policy_id",
          "sequence",
          "kind",
          "snapshot",
          "created_at",
        ]) ||
          (e.kind === "released" &&
            keys(e, ["id", "policy_id", "sequence", "kind", "created_at"]))),
    );
    requireControl(
      uuid(e.id) &&
        uuid(e.policy_id) &&
        isCursor(e.sequence) &&
        timestamp(e.created_at),
    );
    requireControl(
      !eventIds.has(e.id.toLowerCase()) && BigInt(e.sequence) > previous,
    );
    eventIds.add(e.id.toLowerCase());
    previous = BigInt(e.sequence);
    requireControl(e.kind === "released" || e.kind === "withdrawn");
    const selected = manifest.get(e.id);
    if (e.kind === "released")
      requireControl(
        selected &&
          selected.policy_id === e.policy_id &&
          selected.sequence === e.sequence,
      );
    else requireControl(e.snapshot === null && !selected);
  }
  requireControl(
    BigInt(d.next_cursor) === previous && (!d.has_more || d.events.length > 0),
  );
  requireControl(
    d.has_more ||
      d.current_authorized_releases.every(
        (m) => BigInt(m.sequence) <= previous,
      ),
  );
  return d as unknown as FeedPage;
}
const SNAPSHOT_KEYS = [
  "schema_version",
  "policy_id",
  "account_id",
  "policy_number",
  "carrier",
  "line_of_business",
  "named_insured",
  "effective_date",
  "expiration_date",
  "premium",
  "status",
];
function sourceText(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.length <= 4096 &&
    !/\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
      v,
    )
  );
}
function snapshotReason(
  raw: unknown,
  policyId: string,
  accounts: readonly string[],
): string | null {
  if (!object(raw) || !keys(raw, SNAPSHOT_KEYS)) return "snapshot_shape";
  if (raw.schema_version !== 1) return "snapshot_schema";
  if (raw.policy_id !== policyId) return "snapshot_policy_mismatch";
  if (!uuid(raw.account_id)) return "snapshot_account";
  // Bounds are receiver safeguards; do not truncate or normalize source strings.
  if (!sourceText(raw.policy_number)) return "snapshot_type";
  for (const k of ["carrier", "line_of_business", "named_insured", "status"])
    if (raw[k] !== null && !sourceText(raw[k])) return "snapshot_type";
  for (const k of ["effective_date", "expiration_date"])
    if (raw[k] !== null && !date(raw[k])) return "snapshot_date";
  if (
    raw.premium !== null &&
    (typeof raw.premium !== "number" || !Number.isFinite(raw.premium))
  )
    return "snapshot_premium";
  if (!accounts.includes(raw.account_id)) return "account_mapping_unapproved";
  return null;
}
// Iterative canonical hashing also handles deeply nested malformed JSON safely.
function hash(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const digest = createHash("sha256");
  const stack: Array<{ text: string } | { value: unknown }> = [{ value: v }];
  while (stack.length) {
    const task = stack.pop()!;
    if ("text" in task) {
      digest.update(task.text);
      continue;
    }
    const value = task.value;
    if (Array.isArray(value)) {
      digest.update("[");
      stack.push({ text: "]" });
      for (let i = value.length - 1; i >= 0; i--) {
        stack.push({ value: value[i] });
        if (i > 0) stack.push({ text: "," });
      }
    } else if (object(value)) {
      digest.update("{");
      stack.push({ text: "}" });
      const names = Object.keys(value).sort();
      for (let i = names.length - 1; i >= 0; i--) {
        stack.push({ value: value[names[i]] });
        stack.push({ text: JSON.stringify(names[i]) + ":" });
        if (i > 0) stack.push({ text: "," });
      }
    } else digest.update(JSON.stringify(value) ?? "null");
  }
  return digest.digest("hex");
}
export function initialReceiverState(): ReceiverState {
  return {
    version: 1,
    cursor: "0",
    replay_cursor: "0",
    recovery_active: false,
    authorization_checked_at: null,
    source_as_of: null,
    manifest: [],
    receipts: {},
    recovery: {},
    health: "never_synced",
  };
}
function queue(s: ReceiverState, m: ManifestEntry, reason: string) {
  const prior = s.recovery[m.release_id];
  // A completed incident must not consume the retry budget of a later scope return.
  const attempts = prior?.status === "resolved" ? 0 : (prior?.attempts ?? 0);
  s.recovery[m.release_id] = {
    policy_id: m.policy_id,
    reason,
    attempts,
    status: attempts >= MAX_RECOVERY_ATTEMPTS ? "exhausted" : "pending",
  };
}
/** Returns a new complete state for ONE atomic, fenced persistence operation. */
export function applyFeedPage(
  state: ReceiverState,
  raw: unknown,
  options: ApplyOptions,
): ReceiverState {
  const page = validateFeedPage(
    raw,
    options.integrationId,
    options.after,
    options.limit,
  );
  requireControl(
    timestamp(options.now) &&
      options.after ===
        (options.mode === "normal" ? state.cursor : state.replay_cursor),
  );
  requireControl(options.mode !== "recovery" || state.recovery_active);
  // Controls must agree with previously received identities, even after body redaction.
  const bySequence = new Map(
    Object.entries(state.receipts).map(([id, r]) => [r.sequence, id]),
  );
  for (const e of page.events) {
    const prior = state.receipts[e.id];
    requireControl(
      !prior ||
        (prior.policy_id === e.policy_id &&
          prior.sequence === e.sequence &&
          prior.created_at === e.created_at),
    );
    requireControl(
      !bySequence.has(e.sequence) || bySequence.get(e.sequence) === e.id,
    );
  }
  for (const m of page.current_authorized_releases) {
    const prior = state.receipts[m.release_id];
    requireControl(
      !prior ||
        (prior.policy_id === m.policy_id && prior.sequence === m.sequence),
    );
    requireControl(
      !bySequence.has(m.sequence) ||
        bySequence.get(m.sequence) === m.release_id,
    );
  }
  const s = structuredClone(state);
  s.manifest = structuredClone(page.current_authorized_releases);
  const selected = new Set(s.manifest.map((m) => m.release_id));
  // Retain only safe receipts after disclosure is removed; no stale body resurrection.
  for (const [id, r] of Object.entries(s.receipts))
    if (!selected.has(id)) {
      r.snapshot = null;
      r.needs_confirmation = false;
    }
  for (const [id, r] of Object.entries(s.recovery))
    if (!selected.has(id)) r.status = "resolved";
  for (const e of page.events) {
    const prior = s.receipts[e.id];
    const digest = e.kind === "released" ? hash(e.snapshot) : null;
    const conflict =
      prior?.conflict === true ||
      (prior?.hash != null && digest !== null && prior.hash !== digest);
    const reason = conflict
      ? "immutable_body_conflict"
      : e.kind === "released"
        ? snapshotReason(e.snapshot, e.policy_id, options.approvedAccountIds)
        : null;
    s.receipts[e.id] = {
      validator_version: 1,
      policy_id: e.policy_id,
      sequence: e.sequence,
      created_at: e.created_at,
      hash: prior?.hash ?? digest,
      conflict,
      quarantine: reason,
      snapshot:
        e.kind === "released" && !reason
          ? structuredClone(e.snapshot as Snapshot)
          : null,
      needs_confirmation:
        e.kind === "released" && !reason && options.mode === "recovery",
    };
  }
  for (const m of s.manifest) {
    const r = s.receipts[m.release_id];
    if (
      r?.snapshot &&
      !options.approvedAccountIds.includes(r.snapshot.account_id)
    ) {
      r.snapshot = null;
      r.quarantine = "account_mapping_unapproved";
    }
    if (!r?.snapshot || r.conflict || r.quarantine)
      queue(s, m, r?.quarantine ?? "missing_selected_body");
    else {
      if (options.mode === "normal") r.needs_confirmation = false;
      const prior = s.recovery[m.release_id];
      if (prior || r.needs_confirmation)
        s.recovery[m.release_id] = {
          policy_id: m.policy_id,
          reason: prior?.reason ?? "replay_confirmation",
          attempts: prior?.attempts ?? 0,
          status: r.needs_confirmation ? "awaiting_confirmation" : "resolved",
        };
    }
  }
  s.authorization_checked_at = options.now;
  s.source_as_of = page.as_of;
  if (options.mode === "normal") s.cursor = page.next_cursor;
  else {
    s.replay_cursor = page.next_cursor;
    s.recovery_active = page.has_more;
  }
  s.health = s.manifest.some((m) => {
    const r = s.receipts[m.release_id];
    return !r?.snapshot || r.conflict || r.quarantine || r.needs_confirmation;
  })
    ? "degraded"
    : "healthy";
  return s;
}
export function requestRecovery(state: ReceiverState): ReceiverState {
  if (state.recovery_active) return structuredClone(state);
  const s = structuredClone(state);
  const pending = Object.values(s.recovery).filter(
    (r) => r.status === "pending" && r.attempts < MAX_RECOVERY_ATTEMPTS,
  );
  if (!pending.length) return s;
  for (const r of pending) r.attempts++;
  s.replay_cursor = "0";
  s.recovery_active = true;
  return s;
}
export function chooseRequest(state: ReceiverState): {
  mode: "normal" | "recovery";
  after: string;
} {
  return state.recovery_active
    ? { mode: "recovery", after: state.replay_cursor }
    : { mode: "normal", after: state.cursor };
}
