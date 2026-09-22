// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSyntheticFeedTransport, FEED_RESPONSE_BYTE_LIMIT, FEED_TIMEOUT_MS, SYNTHETIC_FEED_ORIGIN, type FeedRequest, type SyntheticFeedTransportConfiguration } from "./transport";
const token = `hvn_${"a".repeat(64)}`;
const integrationId = "10000000-0000-4000-8000-000000000001";
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
function configuration(fetch = vi.fn().mockResolvedValue(response({ success: true, data: {} }))) {
  return { mode: "synthetic" as const, origin: SYNTHETIC_FEED_ORIGIN, integrationId, token, fetch };
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("synthetic-only feed transport", () => {
  it("pins the origin, scoped credential and decimal cursor without request overrides", async () => {
    const config = configuration();
    const transport = createSyntheticFeedTransport(config);
    config.origin = "https://different.invalid";
    config.token = `hvn_${"b".repeat(64)}`;
    await transport.read({ after: "9007199254740993", limit: 1 });
    expect(config.fetch).toHaveBeenCalledWith(`${SYNTHETIC_FEED_ORIGIN}/functions/v1/haven-policy-feed?after=9007199254740993&limit=1`, expect.objectContaining({ method: "GET", redirect: "error", credentials: "omit", cache: "no-store", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }));
    expect(transport.integrationId).toBe(integrationId);
    expect(JSON.stringify(transport)).not.toContain(token);
    expect(Object.isFrozen(transport)).toBe(true);
  });
  it.each(["development", "production"])("hard-disables even injected transport in %s", environment => {
    vi.stubEnv("NODE_ENV", environment);
    const config = configuration();
    expect(() => createSyntheticFeedTransport(config)).toThrow("Live InsureFlow polling is not enabled");
    expect(config.fetch).not.toHaveBeenCalled();
  });
  it("has no production/global fetch fallback or browser execution", () => {
    expect(() => createSyntheticFeedTransport({ ...configuration(), mode: "live" } as unknown as SyntheticFeedTransportConfiguration)).toThrow("not enabled");
    expect(() => createSyntheticFeedTransport({ ...configuration(), fetch: undefined } as unknown as SyntheticFeedTransportConfiguration)).toThrow("not enabled");
    vi.stubGlobal("window", {});
    expect(() => createSyntheticFeedTransport(configuration())).toThrow("not enabled");
  });
  it.each(["http://insureflow.synthetic.invalid", "https://real-provider.example", "https://user:secret@insureflow.synthetic.invalid", "https://insureflow.synthetic.invalid/override", "https://insureflow.synthetic.invalid?account_id=other", "https://insureflow.synthetic.invalid:444"])("rejects unsafe or nonsynthetic destination %s", origin => {
    expect(() => createSyntheticFeedTransport({ ...configuration(), origin })).toThrow("configuration is invalid");
  });
  it.each(["Bearer agency-jwt", "hvn_bad", "hvn_" + "A".repeat(64)])("rejects unsupported credentials", badToken => {
    expect(() => createSyntheticFeedTransport({ ...configuration(), token: badToken })).toThrow("configuration is invalid");
  });
  it.each([{ after: "01" }, { after: "9223372036854775808" }, { after: 1 }, { after: "0", limit: 101 }, { after: "0", account_id: "other" }, { after: "0", origin: "https://other.invalid" }])("rejects cursor or scope overrides before fetch", async request => {
    const config = configuration();
    await expect(createSyntheticFeedTransport(config).read(request as FeedRequest)).rejects.toMatchObject({ code: "invalid_request" });
    expect(config.fetch).not.toHaveBeenCalled();
  });
  it("preserves the raw response wrapper for independent control validation", async () => {
    const raw = { success: true, data: { integration_id: integrationId, next_cursor: "9223372036854775807", events: [] } };
    const config = configuration(vi.fn().mockResolvedValue(response(raw)));
    expect(await createSyntheticFeedTransport(config).read({ after: "0" })).toEqual(raw);
  });
  it("classifies a 401 without reading or exposing provider error content", async () => {
    const body = new ReadableStream<Uint8Array>({ pull() { throw new Error("Do not read private error"); } });
    const config = configuration(vi.fn().mockResolvedValue(new Response(body, { status: 401 })));
    await expect(createSyntheticFeedTransport(config).read({ after: "0" })).rejects.toMatchObject({ code: "unauthorized", httpStatus: 401 });
  });
  it.each([302, 403, 413, 500])("never retries or follows HTTP %s", async status => {
    const config = configuration(vi.fn().mockResolvedValue(new Response("Private error", { status })));
    await expect(createSyntheticFeedTransport(config).read({ after: "0" })).rejects.toMatchObject({ code: "http_error", httpStatus: status });
    expect(config.fetch).toHaveBeenCalledTimes(1);
  });
  it("enforces streaming byte bounds even without content-length", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(FEED_RESPONSE_BYTE_LIMIT)); controller.enqueue(new Uint8Array(1)); }, cancel });
    const config = configuration(vi.fn().mockResolvedValue(new Response(body, { headers: { "content-type": "application/json" } })));
    await expect(createSyntheticFeedTransport(config).read({ after: "0" })).rejects.toMatchObject({ code: "too_large" });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("bounds the whole body wait, not only response headers", async () => {
    vi.useFakeTimers();
    const body = new ReadableStream<Uint8Array>({ start() {} });
    const config = configuration(vi.fn().mockResolvedValue(new Response(body, { headers: { "content-type": "application/json" } })));
    const rejection = expect(createSyntheticFeedTransport(config).read({ after: "0" })).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(FEED_TIMEOUT_MS + 1);
    await rejection;
    expect(config.fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it("rejects invalid JSON and does not echo transport secrets", async () => {
    const broken = configuration(vi.fn().mockResolvedValue(new Response("{invalid", { headers: { "content-type": "application/json" } })));
    await expect(createSyntheticFeedTransport(broken).read({ after: "0" })).rejects.toMatchObject({ code: "invalid_response" });
    const config = configuration(vi.fn().mockRejectedValue(new Error(`Failed Bearer ${token}`)));
    try { await createSyntheticFeedTransport(config).read({ after: "0" }); } catch (error) {
      expect(String(error)).not.toContain(token);
      expect(error).toMatchObject({ code: "transport_error" });
    }
  });
});

it("cancels a late response without reading its body after the fetch ignored abort", async () => {
  vi.useFakeTimers();
  let finishFetch: (response: Response) => void = () => undefined;
  const config = configuration(vi.fn().mockImplementation(() => new Promise<Response>(resolve => { finishFetch = resolve; })));
  const rejection = expect(createSyntheticFeedTransport(config).read({ after: "0" })).rejects.toMatchObject({ code: "timeout" });
  await vi.advanceTimersByTimeAsync(FEED_TIMEOUT_MS + 1);
  await rejection;
  const cancel = vi.fn();
  const late = new ReadableStream<Uint8Array>({ start() {}, cancel }, { highWaterMark: 0 });
  finishFetch(new Response(late, { headers: { "content-type": "application/json" } }));
  await Promise.resolve();
  await Promise.resolve();
  expect(cancel).toHaveBeenCalledOnce();
});
