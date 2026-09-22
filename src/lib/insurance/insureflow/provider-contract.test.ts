import { describe, expect, it } from "vitest";

import scenarios from "./provider-contract-pages.json";
import { applyFeedPage, initialReceiverState, validateFeedPage, type ReceiverState } from "./receiver";

/**
 * The receiver was merged against a provider that did not exist. Its own contract
 * records that the provider source was uncommitted working-tree files on a sandbox
 * that is not in any repository.
 *
 * These pages are real output from the InsureFlow provider — `haven_policy_feed`
 * in insureflow-ops, replayed on a PostgreSQL 17 cluster against COL's actual
 * policy shapes — judged here by the real validator rather than by a second
 * implementation of it. If the two halves ever disagree about the wire format,
 * this fails instead of production doing so.
 *
 * Regenerate with:
 *   scripts/haven-feed/emit-contract-pages.sh <socket> <port> <db> <out.json>
 */

type Scenario = {
  name: string;
  integration_id: string;
  after: number;
  limit: number;
  approved_account_ids: string[];
  page: unknown;
};

const all = scenarios as unknown as Scenario[];
const byName = (name: string) => {
  const found = all.find((s) => s.name === name);
  if (!found) throw new Error(`missing provider scenario: ${name}`);
  return found;
};

const visibleBodies = (state: ReceiverState) =>
  Object.values(state.receipts).filter((r) => r.snapshot && !r.quarantine && !r.conflict).length;

describe("InsureFlow provider pages satisfy the Haven receiver contract", () => {
  it("ships the scenarios the harness is supposed to produce", () => {
    expect(all.length).toBe(7);
  });

  // Controls first: every page must survive validateFeedPage untouched. This is
  // the part that catches a provider emitting a superseded release, a withdrawn
  // event with a body, an out-of-order sequence or a manifest that names a
  // release the page never streamed.
  it.each(all.map((s) => [s.name, s] as const))("validates page controls: %s", (_name, s) => {
    expect(() => validateFeedPage(s.page, s.integration_id, String(s.after), s.limit)).not.toThrow();
  });

  it("carries the eleven-field snapshot with source values unconverted", () => {
    const page = validateFeedPage(
      byName("fresh consumer takes everything").page,
      byName("fresh consumer takes everything").integration_id,
      "0",
      100,
    );
    const master = page.events.find(
      (e) => (e.snapshot as { policy_number?: string } | null)?.policy_number === "NSC101045",
    );
    expect(master).toBeDefined();
    const snapshot = master!.snapshot as Record<string, unknown>;

    expect(Object.keys(snapshot).sort()).toEqual(
      [
        "account_id",
        "carrier",
        "effective_date",
        "expiration_date",
        "line_of_business",
        "named_insured",
        "policy_id",
        "policy_number",
        "premium",
        "schema_version",
        "status",
      ].sort(),
    );
    // The premium travels as the source JSON number. No cents, no currency, no
    // rounding — COL's master GL really is $239,893.00.
    expect(snapshot.premium).toBe(239893);
    expect(snapshot.effective_date).toBe("2026-04-08");
    expect(snapshot.status).toBe("active");
  });

  it("sends a missing premium as null rather than zero", () => {
    const s = byName("fresh consumer takes everything");
    const page = validateFeedPage(s.page, s.integration_id, "0", 100);
    const auto = page.events.find(
      (e) => (e.snapshot as { policy_number?: string } | null)?.policy_number === "54-940036-00",
    );
    expect(auto).toBeDefined();
    expect((auto!.snapshot as { premium: unknown }).premium).toBeNull();
  });

  it("does not normalise a policy number the source recorded with a leading space", () => {
    const s = byName("fresh consumer takes everything");
    const page = validateFeedPage(s.page, s.integration_id, "0", 100);
    const numbers = page.events.map((e) => (e.snapshot as { policy_number?: string } | null)?.policy_number);
    expect(numbers).toContain(" 09-7590181384-S-03");
  });

  // Applying proves the pages are usable, not merely well-formed: membership
  // lands, bodies stay visible, nothing quarantines, and the cursor advances.
  it("drives one consumer from empty through pagination, withdrawal and re-release", () => {
    let state = initialReceiverState();
    const now = "2026-09-21T23:30:00Z";
    const run = (name: string) => {
      const s = byName(name);
      state = applyFeedPage(state, s.page, {
        integrationId: s.integration_id,
        after: String(s.after),
        mode: "normal",
        now,
        approvedAccountIds: s.approved_account_ids,
        limit: s.limit,
      });
      return state;
    };

    run("first page of two, has_more");
    expect(state.cursor).toBe("2");
    expect(state.manifest).toHaveLength(2);
    expect(state.health).toBe("healthy");

    run("second page resumes at the cursor");
    expect(state.cursor).toBe("4");
    expect(state.manifest).toHaveLength(4);
    expect(visibleBodies(state)).toBe(4);

    run("caught up returns no events");
    expect(state.cursor).toBe("4");
    expect(state.manifest).toHaveLength(4);

    // Withdrawal removes disclosure for one policy and nothing else.
    run("withdrawal drops one from membership");
    expect(state.cursor).toBe("5");
    expect(state.manifest).toHaveLength(3);
    expect(visibleBodies(state)).toBe(3);

    // Re-release: the original release is gone from the stream, and the policy
    // is disclosed again under a new release id at a new sequence.
    run("re-release supersedes the old release");
    expect(state.cursor).toBe("6");
    expect(state.manifest).toHaveLength(3);
    expect(visibleBodies(state)).toBe(3);

    // Nothing anywhere in that sequence was rejected or flagged.
    expect(Object.values(state.receipts).filter((r) => r.quarantine)).toHaveLength(0);
    expect(Object.values(state.receipts).filter((r) => r.conflict)).toHaveLength(0);
    expect(state.health).toBe("healthy");
  });

  it("gives a consumer arriving after all the churn the same coherent world", () => {
    const s = byName("fresh consumer after churn is coherent");
    const state = applyFeedPage(initialReceiverState(), s.page, {
      integrationId: s.integration_id,
      after: "0",
      mode: "normal",
      now: "2026-09-21T23:30:00Z",
      approvedAccountIds: s.approved_account_ids,
      limit: s.limit,
    });

    // Same membership a long-running consumer holds: three disclosed policies.
    expect(state.manifest).toHaveLength(3);
    expect(visibleBodies(state)).toBe(3);
    expect(state.cursor).toBe("6");
    expect(state.health).toBe("healthy");
  });

  it("hides every body when the account mapping is not approved", () => {
    const s = byName("fresh consumer takes everything");
    const state = applyFeedPage(initialReceiverState(), s.page, {
      integrationId: s.integration_id,
      after: "0",
      mode: "normal",
      now: "2026-09-21T23:30:00Z",
      approvedAccountIds: [],
      limit: s.limit,
    });

    // Membership is a control and still lands; the bodies are withheld because
    // no account is approved for this reader.
    expect(state.manifest).toHaveLength(4);
    expect(visibleBodies(state)).toBe(0);
    expect(Object.values(state.receipts).every((r) => r.quarantine === "account_mapping_unapproved")).toBe(true);
  });

  it("rejects a page whose integration id is not the one that was asked for", () => {
    const s = byName("fresh consumer takes everything");
    expect(() =>
      validateFeedPage(s.page, "cccccccc-1111-4000-8000-000000000009", "0", 100),
    ).toThrow();
  });

  it("rejects a page presented against the wrong cursor", () => {
    const s = byName("second page resumes at the cursor");
    // Its events start after sequence 2; claiming to be at 4 must not validate.
    expect(() => validateFeedPage(s.page, s.integration_id, "4", 2)).toThrow();
  });
});
