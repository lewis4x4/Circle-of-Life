// @vitest-environment node
//
// Node, not happy-dom: the live transport refuses to exist where `window` does,
// because a browser must never hold the feed credential. Running this file under
// the default DOM environment would make every live assertion fail for the right
// reason and prove nothing.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import providerPages from "./provider-contract-pages.json";
import { applyFeedPage, initialReceiverState } from "./receiver";
import {
  createLiveFeedTransport,
  createSyntheticFeedTransport,
  FeedTransportError,
  liveTransportEnabled,
  SYNTHETIC_FEED_ORIGIN,
} from "./transport";

/**
 * COL-546: the live path, and the two decisions that are behaviour rather than
 * configuration.
 *
 * The reviewed synthetic transport is deliberately unreachable outside a test.
 * These assert that opening a live path did not quietly loosen it, and that the
 * two worlds cannot be pointed at each other's origins.
 */

const TOKEN = `hvn_${"a".repeat(64)}`;
const INTEGRATION = "11111111-2222-4333-8444-555555555555";
const LIVE_ORIGIN = "https://lrqajzwcmdwahnjyidgv.supabase.co";
const ORIGINAL = { ...process.env };

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  process.env = { ...ORIGINAL };
});
afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.unstubAllGlobals();
});

describe("the live kill switch", () => {
  it("is off unless the environment says exactly true", () => {
    delete process.env.INSUREFLOW_LIVE_TRANSPORT_ENABLED;
    expect(liveTransportEnabled()).toBe(false);
    process.env.INSUREFLOW_LIVE_TRANSPORT_ENABLED = "1";
    expect(liveTransportEnabled()).toBe(false);
    process.env.INSUREFLOW_LIVE_TRANSPORT_ENABLED = "TRUE";
    expect(liveTransportEnabled()).toBe(false);
    process.env.INSUREFLOW_LIVE_TRANSPORT_ENABLED = "true";
    expect(liveTransportEnabled()).toBe(true);
  });

  it("refuses to build a live transport while it is off", () => {
    delete process.env.INSUREFLOW_LIVE_TRANSPORT_ENABLED;
    expect(() =>
      createLiveFeedTransport({ mode: "live", origin: LIVE_ORIGIN, integrationId: INTEGRATION, token: TOKEN }),
    ).toThrow(FeedTransportError);
  });

  // The switch is read at call time, not captured at import, so revoking it
  // stops the next poll rather than waiting for a deploy.
  it("stops an already-built transport mid-life when revoked", async () => {
    process.env.INSUREFLOW_LIVE_TRANSPORT_ENABLED = "true";
    const transport = createLiveFeedTransport({
      mode: "live",
      origin: LIVE_ORIGIN,
      integrationId: INTEGRATION,
      token: TOKEN,
      fetch: async () => jsonResponse({ success: true, data: {} }),
    });
    delete process.env.INSUREFLOW_LIVE_TRANSPORT_ENABLED;
    await expect(transport.read({ after: "0" })).rejects.toThrow(FeedTransportError);
  });
});

describe("the two worlds cannot be pointed at each other", () => {
  beforeEach(() => {
    process.env.INSUREFLOW_LIVE_TRANSPORT_ENABLED = "true";
  });

  it("refuses a live transport aimed at a .invalid origin", () => {
    expect(() =>
      createLiveFeedTransport({ mode: "live", origin: SYNTHETIC_FEED_ORIGIN, integrationId: INTEGRATION, token: TOKEN }),
    ).toThrow(FeedTransportError);
  });

  it("refuses a synthetic transport aimed at a real origin", () => {
    expect(() =>
      createSyntheticFeedTransport({
        mode: "synthetic",
        origin: LIVE_ORIGIN,
        integrationId: INTEGRATION,
        token: TOKEN,
        fetch: async () => jsonResponse({}),
      }),
    ).toThrow(FeedTransportError);
  });

  it("still refuses a malformed credential on the live path", () => {
    expect(() =>
      createLiveFeedTransport({ mode: "live", origin: LIVE_ORIGIN, integrationId: INTEGRATION, token: "hvn_short" }),
    ).toThrow(FeedTransportError);
  });

  it("still refuses an http origin", () => {
    expect(() =>
      createLiveFeedTransport({ mode: "live", origin: "http://example.com", integrationId: INTEGRATION, token: TOKEN }),
    ).toThrow(FeedTransportError);
  });
});

describe("the live read keeps every safeguard the reviewed read has", () => {
  beforeEach(() => {
    process.env.INSUREFLOW_LIVE_TRANSPORT_ENABLED = "true";
  });

  const build = (fetchImpl: (url: string, init: RequestInit) => Promise<Response>) =>
    createLiveFeedTransport({
      mode: "live",
      origin: LIVE_ORIGIN,
      integrationId: INTEGRATION,
      token: TOKEN,
      fetch: fetchImpl,
    });

  it("sends the bearer credential, refuses redirects and omits browser credentials", async () => {
    let seenUrl = "";
    let seenInit: RequestInit | undefined;
    const transport = build(async (url, init) => {
      seenUrl = url;
      seenInit = init;
      return jsonResponse({ success: true, data: { ok: true } });
    });
    await transport.read({ after: "7", limit: 25 });

    expect(seenUrl).toBe(`${LIVE_ORIGIN}/functions/v1/haven-policy-feed?after=7&limit=25`);
    expect((seenInit?.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(seenInit?.redirect).toBe("error");
    expect(seenInit?.credentials).toBe("omit");
    expect(seenInit?.cache).toBe("no-store");
  });

  it("turns a 401 into unauthorized so the reader stops claiming", async () => {
    const transport = build(async () => new Response("", { status: 401 }));
    await expect(transport.read({ after: "0" })).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("rejects a non-JSON content type", async () => {
    const transport = build(async () => new Response("<html/>", { status: 200, headers: { "content-type": "text/html" } }));
    await expect(transport.read({ after: "0" })).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("rejects an over-large declared body", async () => {
    const transport = build(async () =>
      new Response("{}", { status: 200, headers: { "content-type": "application/json", "content-length": String(4 * 1024 * 1024) } }),
    );
    await expect(transport.read({ after: "0" })).rejects.toMatchObject({ code: "too_large" });
  });

  it("refuses a cursor or limit outside the contract", async () => {
    const transport = build(async () => jsonResponse({ success: true, data: {} }));
    await expect(transport.read({ after: "-1" })).rejects.toMatchObject({ code: "invalid_request" });
    await expect(transport.read({ after: "0", limit: 101 })).rejects.toMatchObject({ code: "invalid_request" });
    await expect(transport.read({ after: "0", limit: 0 })).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("never leaks the underlying fetch error", async () => {
    const transport = build(async () => {
      throw new Error(`boom with ${TOKEN}`);
    });
    await expect(transport.read({ after: "0" })).rejects.toMatchObject({ code: "transport_error" });
    await transport.read({ after: "0" }).catch((error: Error) => {
      expect(error.message).not.toContain(TOKEN);
    });
  });
});

/**
 * Decision 4 — retention is soft-delete with history retained. That was already
 * the receiver's behaviour rather than something to build, so it is asserted by
 * driving real provider pages through it: a withdrawn release keeps its receipt
 * and its original body hash, and only the body stops being visible.
 */
describe("decision 4: a withdrawal retains history", () => {
  it("keeps the receipt and the first body hash after a withdrawal", () => {
    const scenarios = providerPages as unknown as Array<{
      name: string;
      integration_id: string;
      after: number;
      limit: number;
      approved_account_ids: string[];
      page: unknown;
    }>;
    const pick = (name: string) => {
      const found = scenarios.find((s) => s.name === name);
      if (!found) throw new Error(`missing provider scenario: ${name}`);
      return found;
    };

    let state = initialReceiverState();
    const run = (name: string) => {
      const s = pick(name);
      state = applyFeedPage(state, s.page, {
        integrationId: s.integration_id,
        after: String(s.after),
        mode: "normal",
        now: "2026-09-21T23:30:00Z",
        approvedAccountIds: s.approved_account_ids,
        limit: s.limit,
      });
    };

    run("fresh consumer takes everything");
    const beforeIds = Object.keys(state.receipts);
    const hashes = Object.fromEntries(Object.entries(state.receipts).map(([id, r]) => [id, r.hash]));
    expect(beforeIds).toHaveLength(4);
    expect(state.manifest).toHaveLength(4);

    run("withdrawal drops one from membership");

    // The withdrawn policy leaves membership...
    expect(state.manifest).toHaveLength(3);
    // ...but every receipt that existed before still exists. Nothing is erased.
    expect(Object.keys(state.receipts)).toEqual(expect.arrayContaining(beforeIds));

    // And the original body hash is unchanged for every one of them, which is
    // what makes the history evidence rather than a cache.
    for (const id of beforeIds) {
      expect(state.receipts[id].hash).toBe(hashes[id]);
    }

    // The withdrawn body is no longer visible, which is the "soft" in soft-delete.
    const withdrawnReleaseIds = beforeIds.filter((id) => !state.manifest.some((m) => m.release_id === id));
    expect(withdrawnReleaseIds).toHaveLength(1);
    expect(state.receipts[withdrawnReleaseIds[0]].snapshot).toBeNull();
    expect(state.receipts[withdrawnReleaseIds[0]].hash).not.toBeNull();
  });
});
