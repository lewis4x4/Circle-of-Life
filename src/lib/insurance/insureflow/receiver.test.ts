import { describe, expect, it } from "vitest";
import fixtures from "./synthetic-fixtures.json";
import {
  applyFeedPage,
  initialReceiverState,
  InvalidFeedControls,
  isCursor,
  requestRecovery,
  validateFeedPage,
  type ReceiverState,
} from "./receiver";
type MutablePage = {
  data: Record<string, unknown> & {
    events: Array<{
      id: string;
      policy_id: string;
      sequence: string;
      created_at: string;
      kind: string;
      snapshot: Record<string, unknown> | null;
    }>;
    current_authorized_releases?: Array<{
      policy_id: string;
      release_id: string;
      sequence: string;
    }>;
    next_cursor: string;
    has_more: boolean;
  };
};

const integrationId =
  fixtures.synthetic_crosswalk_example.source_integration_id;
const approvedAccountIds = [
  fixtures.synthetic_crosswalk_example.source_account_id,
];
const now = "2026-10-02T01:00:00Z";
const options = {
  integrationId,
  approvedAccountIds,
  now,
  mode: "normal" as const,
};
const scenario = (name: string) =>
  structuredClone(fixtures.scenarios.find((s) => s.name === name)!);
const first = () => scenario("initial_approved_release").response;
const release1 = first().data.events[0].id;
const apply = (state: ReceiverState, raw: unknown) =>
  applyFeedPage(state, raw, { ...options, after: state.cursor });
function seededFault() {
  const f = fixtures.fault_injection_cases[0];
  const raw = first();
  raw.data.events[0].id =
    f.initial_receiver_state.visible_records[0].release_id;
  raw.data.events[0].sequence = "4";
  raw.data.current_authorized_releases = structuredClone(
    f.initial_receiver_state.current_authorized_releases,
  );
  raw.data.next_cursor = "4";
  return apply(initialReceiverState(), raw);
}
describe("InsureFlow controls", () => {
  it.each(fixtures.scenarios.map((s) => [s.name, s] as const))(
    "validates provider fixture %s",
    (_name, s) => {
      const u = new URL(s.request.path, "https://synthetic.invalid");
      expect(() =>
        validateFeedPage(
          s.response,
          integrationId,
          u.searchParams.get("after")!,
          Number(u.searchParams.get("limit")),
        ),
      ).not.toThrow();
    },
  );
  it("rejects duplicate manifest before considering malformed body without mutating state", () => {
    const state = seededFault(),
      before = structuredClone(state);
    expect(() =>
      apply(state, fixtures.fault_injection_cases[1].response),
    ).toThrow(InvalidFeedControls);
    expect(state).toEqual(before);
  });
  it.each(["9223372036854775808", "01", "-1", "1.0", 1, null])(
    "rejects invalid cursor %s",
    (v) => expect(isCursor(v)).toBe(false),
  );
  it("preserves cursors above JS safe integer exactly", () => {
    const raw = first();
    raw.data.events[0].sequence = "9007199254740993";
    raw.data.current_authorized_releases![0].sequence = "9007199254740993";
    raw.data.next_cursor = "9007199254740993";
    expect(apply(initialReceiverState(), raw).cursor).toBe("9007199254740993");
  });
  it.each([
    "integration",
    "order",
    "cursor",
    "kind",
    "withdrawn_body",
    "manifest_match",
    "missing_manifest",
    "empty_has_more",
    "future_manifest",
  ])("rejects invalid %s", (kind) => {
    const raw = first() as unknown as MutablePage;
    if (kind === "integration") raw.data.integration_id = approvedAccountIds[0];
    if (kind === "order") raw.data.events.push(raw.data.events[0]);
    if (kind === "cursor") raw.data.next_cursor = "2";
    if (kind === "kind") raw.data.events[0].kind = "cancelled";
    if (kind === "withdrawn_body") {
      raw.data.events[0].kind = "withdrawn";
      raw.data.current_authorized_releases = [];
    }
    if (kind === "manifest_match")
      raw.data.current_authorized_releases![0].sequence = "2";
    if (kind === "missing_manifest")
      delete raw.data.current_authorized_releases;
    if (kind === "empty_has_more") {
      raw.data.events = [];
      raw.data.next_cursor = "0";
      raw.data.has_more = true;
    }
    if (kind === "future_manifest") {
      raw.data.events = [];
      raw.data.next_cursor = "0";
    }
    expect(() => apply(initialReceiverState(), raw)).toThrow(
      InvalidFeedControls,
    );
  });
});
describe("atomic receiver transition", () => {
  it("applies mixed validity withdrawal and good body while durably quarantining bad date", () => {
    const state = seededFault(),
      original = structuredClone(state),
      next = apply(state, fixtures.fault_injection_cases[0].response);
    const f = fixtures.fault_injection_cases[0].expected_outcome;
    expect(state).toEqual(original); // caller can discard this transaction on persistence failure
    expect(next.cursor).toBe("7");
    expect(next.health).toBe("degraded");
    expect(
      Object.values(next.receipts)
        .filter((r) => r.snapshot)
        .map((r) => r.policy_id),
    ).toEqual(f.visible_policy_ids);
    expect(next.receipts[f.quarantine_event_ids![0]].quarantine).toBe(
      "snapshot_date",
    );
    expect(next.recovery[f.quarantine_event_ids![0]].status).toBe("pending");
    expect(JSON.stringify(next)).not.toContain("2026-02-30");
    expect(apply(state, fixtures.fault_injection_cases[0].response)).toEqual(
      next,
    );
  });
  it.each([
    "date",
    "missing",
    "schema",
    "policy",
    "unknown",
    "type",
    "account",
  ])("quarantines %s without rejecting controls", (kind) => {
    const raw = first() as unknown as MutablePage;
    const b = raw.data.events[0].snapshot!;
    if (kind === "date") b.effective_date = "2026-02-30";
    if (kind === "missing") raw.data.events[0].snapshot = null;
    if (kind === "schema") b.schema_version = 2;
    if (kind === "policy") b.policy_id = approvedAccountIds[0];
    if (kind === "unknown") b.raw_secret = "DO_NOT_RETAIN";
    if (kind === "type") b.premium = "12500";
    if (kind === "account") b.account_id = integrationId;
    const s = apply(initialReceiverState(), raw);
    expect(s.cursor).toBe("1");
    expect(s.receipts[release1].snapshot).toBeNull();
    expect(s.recovery[release1].status).toBe("pending");
    expect(JSON.stringify(s)).not.toContain("DO_NOT_RETAIN");
  });
  it("does not assume currency, positive premium, enums, or date ordering", () => {
    const raw = first() as unknown as MutablePage;
    Object.assign(raw.data.events[0].snapshot, {
      premium: -0.12345,
      status: "other source wording",
      effective_date: "2028-01-01",
      expiration_date: "2027-01-01",
      policy_number: "0000-X",
    });
    expect(
      apply(initialReceiverState(), raw).receipts[release1].snapshot,
    ).toEqual(raw.data.events[0].snapshot);
  });
  it("redacts same-ID history without immutable conflict and does not remove newer body", () => {
    let s = apply(initialReceiverState(), first());
    s.replay_cursor = "0";
    s.recovery_active = true;
    s = applyFeedPage(s, scenario("superseded_page_one").response, {
      ...options,
      mode: "recovery",
      after: "0",
      limit: 1,
    });
    expect(s.receipts[release1].hash).not.toBeNull();
    expect(s.receipts[release1].conflict).toBe(false);
    expect(s.receipts[release1].snapshot).toBeNull();
    s = applyFeedPage(s, scenario("superseded_page_two").response, {
      ...options,
      mode: "recovery",
      after: "1",
      limit: 1,
    });
    expect(Object.values(s.receipts).filter((r) => r.snapshot)).toHaveLength(1);
  });
  it("requires replay and then fresh normal manifest after scope returns", () => {
    let s = apply(initialReceiverState(), first());
    const empty = first();
    empty.data.events = [];
    empty.data.current_authorized_releases = [];
    s = apply(s, empty);
    expect(s.receipts[release1].snapshot).toBeNull();
    empty.data.current_authorized_releases =
      first().data.current_authorized_releases;
    s = apply(s, empty);
    expect(s.recovery[release1].status).toBe("pending");
    s = requestRecovery(s);
    s = applyFeedPage(s, first(), { ...options, mode: "recovery", after: "0" });
    expect(s.cursor).toBe("1");
    expect(s.receipts[release1].needs_confirmation).toBe(true);
    expect(s.health).toBe("degraded");
    s = apply(s, empty);
    expect(s.receipts[release1].needs_confirmation).toBe(false);
    expect(s.health).toBe("healthy");
  });
  it("cannot resurrect recovered release withdrawn before final confirmation", () => {
    let s = apply(initialReceiverState(), first());
    s.replay_cursor = "0";
    s.recovery_active = true;
    s = applyFeedPage(s, first(), { ...options, mode: "recovery", after: "0" });
    const gone = first();
    gone.data.events = [];
    gone.data.current_authorized_releases = [];
    s = apply(s, gone);
    expect(s.receipts[release1].snapshot).toBeNull();
  });
  it("keeps original hash and hides every conflicting variant", () => {
    let s = apply(initialReceiverState(), first());
    const hash = s.receipts[release1].hash;
    s.recovery_active = true;
    s.replay_cursor = "0";
    const changed = first();
    changed.data.events[0].snapshot!.premium = 99;
    s = applyFeedPage(s, changed, { ...options, mode: "recovery", after: "0" });
    expect(s.receipts[release1]).toMatchObject({
      hash,
      conflict: true,
      snapshot: null,
      quarantine: "immutable_body_conflict",
    });
    s.recovery_active = true;
    s.replay_cursor = "0";
    s = applyFeedPage(s, first(), { ...options, mode: "recovery", after: "0" });
    expect(s.receipts[release1].snapshot).toBeNull();
  });
  it("bounds replay attempts and deduplicates quarantine work", () => {
    const bad = first() as unknown as MutablePage;
    bad.data.events[0].snapshot!.expiration_date = "bad";
    let s = apply(initialReceiverState(), bad);
    for (let i = 0; i < 3; i++) {
      s = requestRecovery(s);
      s = applyFeedPage(s, bad, { ...options, mode: "recovery", after: "0" });
    }
    expect(s.recovery[release1]).toMatchObject({
      attempts: 3,
      status: "exhausted",
    });
    expect(requestRecovery(s).recovery_active).toBe(false);
    expect(Object.keys(s.recovery)).toHaveLength(1);
  });
  it("rejects event identity reuse across pages", () => {
    const s = apply(initialReceiverState(), first());
    s.recovery_active = true;
    s.replay_cursor = "0";
    const raw = first();
    raw.data.events[0].created_at = now;
    expect(() =>
      applyFeedPage(s, raw, { ...options, mode: "recovery", after: "0" }),
    ).toThrow(InvalidFeedControls);
  });
});

describe("recovery integrity", () => {
  it("accepts source correction only under a new approved release", () => {
    const raw = first() as unknown as MutablePage;
    raw.data.events[0].snapshot!.effective_date = "2026-02-30";
    let state = apply(initialReceiverState(), raw);
    const next = scenario("superseded_page_two").response;
    state = apply(state, next);
    expect(state.health).toBe("healthy");
    expect(state.receipts[release1].snapshot).toBeNull();
    expect(state.receipts[next.data.events[0].id].snapshot).not.toBeNull();
  });
  it("recovers unchanged approved body after validator/mapping correction and confirms freshness", () => {
    let state = applyFeedPage(initialReceiverState(), first(), {
      ...options,
      approvedAccountIds: [],
      after: "0",
    });
    const hash = state.receipts[release1].hash;
    state = requestRecovery(state);
    state = applyFeedPage(state, first(), {
      ...options,
      mode: "recovery",
      after: "0",
    });
    expect(state.receipts[release1]).toMatchObject({
      hash,
      conflict: false,
      quarantine: null,
      needs_confirmation: true,
    });
    const confirmation = first();
    confirmation.data.events = [];
    state = apply(state, confirmation);
    expect(state.health).toBe("healthy");
  });
  it("canonical hashes ignore object key order on replay", () => {
    let state = apply(initialReceiverState(), first());
    state.recovery_active = true;
    const raw = first() as unknown as MutablePage;
    raw.data.events[0].snapshot = Object.fromEntries(
      Object.entries(raw.data.events[0].snapshot!).reverse(),
    );
    state = applyFeedPage(state, raw, {
      ...options,
      mode: "recovery",
      after: "0",
    });
    expect(state.receipts[release1].conflict).toBe(false);
  });
  it("quarantines deeply nested unknown input without retaining it or blowing the call stack", () => {
    const raw = first() as unknown as MutablePage;
    let nested: Record<string, unknown> = { final: "do_not_retain" };
    for (let i = 0; i < 12000; i++) nested = { child: nested };
    raw.data.events[0].snapshot!.unknown = nested;
    const state = apply(initialReceiverState(), raw);
    expect(state.receipts[release1].quarantine).toBe("snapshot_shape");
    expect(JSON.stringify(state)).not.toContain("do_not_retain");
  });
  it.each(["nul\u0000", "lone\ud800"])(
    "quarantines PostgreSQL-incompatible text",
    (value) => {
      const raw = first() as unknown as MutablePage;
      raw.data.events[0].snapshot!.carrier = value;
      expect(
        apply(initialReceiverState(), raw).receipts[release1].quarantine,
      ).toBe("snapshot_type");
    },
  );
});

it("quarantines omitted released snapshot while applying unrelated withdrawal", () => {
  const raw = structuredClone(fixtures.fault_injection_cases[0].response);
  Reflect.deleteProperty(raw.data.events[1], "snapshot");
  const state = apply(seededFault(), raw);
  expect(state.cursor).toBe("7");
  expect(state.receipts[raw.data.events[1].id].quarantine).toBe(
    "snapshot_shape",
  );
  expect(
    Object.values(state.receipts)
      .filter((r) => r.snapshot)
      .map((r) => r.policy_id),
  ).toEqual(
    fixtures.fault_injection_cases[0].expected_outcome.visible_policy_ids,
  );
});

it("gives a new recovery episode its own retry budget after successful scope-return recovery", () => {
  let state = apply(initialReceiverState(), first());
  const removed = first();
  removed.data.events = [];
  removed.data.current_authorized_releases = [];
  const returned = first();
  returned.data.events = [];
  for (let cycle = 0; cycle < 4; cycle++) {
    state = apply(state, removed);
    state = apply(state, returned);
    expect(state.recovery[release1].status).toBe("pending");
    state = requestRecovery(state);
    expect(state.recovery_active).toBe(true);
    state = applyFeedPage(state, first(), {
      ...options,
      mode: "recovery",
      after: "0",
    });
    state = apply(state, returned);
    expect(state.health).toBe("healthy");
  }
});
