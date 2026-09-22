/**
 * Transport to the InsureFlow policy feed.
 *
 * Two shapes, one implementation. The synthetic transport is the reviewed one:
 * test runtime, injected fetch, HTTPS `.invalid` origin, used by the harness. The
 * live transport talks to the real provider and exists because COL-546 decision 5
 * authorised it. Everything that makes the read safe — no redirects, no browser
 * credentials, no cache, the byte cap, the timeout, the JSON content-type check,
 * the 401 that stops the reader claiming — is shared, so neither shape can drift
 * into being the lenient one.
 */

/**
 * Live polling is off unless the server says otherwise. This is a kill switch,
 * read at call time rather than captured at import, so revoking it takes effect
 * on the next poll instead of the next deploy.
 */
export function liveTransportEnabled(): boolean {
  return process.env.INSUREFLOW_LIVE_TRANSPORT_ENABLED === "true";
}
export const SYNTHETIC_FEED_ORIGIN = "https://insureflow.synthetic.invalid";
export const FEED_RESPONSE_BYTE_LIMIT = 3 * 1024 * 1024;
export const FEED_TIMEOUT_MS = 30_000;
const FEED_PATH = "/functions/v1/haven-policy-feed";
const MAX_CURSOR = BigInt("9223372036854775807");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type FeedTransportErrorCode =
  | "live_disabled"
  | "invalid_configuration"
  | "invalid_request"
  | "unauthorized"
  | "http_error"
  | "too_large"
  | "invalid_response"
  | "timeout"
  | "transport_error";

const ERROR_MESSAGES: Record<FeedTransportErrorCode, string> = {
  live_disabled: "Live InsureFlow polling is not enabled. Only injected synthetic test transport is available.",
  invalid_configuration: "The synthetic InsureFlow transport configuration is invalid.",
  invalid_request: "The feed request must contain only a decimal cursor and a bounded page limit.",
  unauthorized: "The scoped feed credential is unavailable, expired, or revoked.",
  http_error: "The feed request failed. The existing cursor and membership must be preserved.",
  too_large: "The feed exceeded the receiver response-size safeguard.",
  invalid_response: "The feed returned an unsupported transport response.",
  timeout: "The feed request exceeded its response deadline.",
  transport_error: "The feed could not be read. The existing cursor and membership must be preserved.",
};

export class FeedTransportError extends Error {
  constructor(public readonly code: FeedTransportErrorCode, public readonly httpStatus?: number) {
    super(ERROR_MESSAGES[code]);
    this.name = "FeedTransportError";
  }
}

export type InjectedFeedFetch = (url: string, init: RequestInit) => Promise<Response>;
export type FeedRequest = { after: string; limit?: number };
export type FeedTransportMode = "synthetic" | "live";
export type SyntheticFeedTransport = Readonly<{
  mode: FeedTransportMode;
  origin: string;
  integrationId: string;
  read(request: FeedRequest): Promise<unknown>;
}>;
export type SyntheticFeedTransportConfiguration = {
  mode: "synthetic";
  origin: string;
  integrationId: string;
  token: string;
  fetch: InjectedFeedFetch;
};
export type LiveFeedTransportConfiguration = {
  mode: "live";
  origin: string;
  integrationId: string;
  token: string;
  /** Optional only so tests can drive the live path without a network. */
  fetch?: InjectedFeedFetch;
};

function assertSyntheticRuntime(mode: string, injectedFetch: unknown) {
  if (mode !== "synthetic" || process.env.NODE_ENV !== "test" || typeof window !== "undefined" || typeof injectedFetch !== "function") {
    throw new FeedTransportError("live_disabled");
  }
}

/**
 * The live equivalent. Still server-only — a browser must never hold the feed
 * credential — but it runs outside a test and may use the platform fetch.
 */
function assertLiveRuntime(mode: string, injectedFetch: unknown) {
  if (mode !== "live" || typeof window !== "undefined" || !liveTransportEnabled()
    || (injectedFetch !== undefined && typeof injectedFetch !== "function")) {
    throw new FeedTransportError("live_disabled");
  }
}

/**
 * Synthetic: no environment secret lookup, no global fetch fallback, no runtime
 * live switch. Unchanged from the reviewed delivery.
 */
export function createSyntheticFeedTransport(configuration: SyntheticFeedTransportConfiguration): SyntheticFeedTransport {
  return createFeedTransport(configuration);
}

/**
 * Live: the real provider. Same read path, different admission rules — a genuine
 * HTTPS origin instead of `.invalid`, and the kill switch must be on.
 */
export function createLiveFeedTransport(configuration: LiveFeedTransportConfiguration): SyntheticFeedTransport {
  return createFeedTransport(configuration);
}

function createFeedTransport(
  configuration: SyntheticFeedTransportConfiguration | LiveFeedTransportConfiguration,
): SyntheticFeedTransport {
  const live = configuration.mode === "live";
  if (live) assertLiveRuntime(configuration.mode, configuration.fetch);
  else assertSyntheticRuntime(configuration.mode, configuration.fetch);
  let origin: string;
  try {
    const url = new URL(configuration.origin);
    // A synthetic transport may only ever reach `.invalid`; a live one may never
    // reach it, so a misconfigured mode cannot quietly point at the wrong world.
    const hostnameAllowed = live ? !url.hostname.endsWith(".invalid") : url.hostname.endsWith(".invalid");
    if (url.protocol !== "https:" || !hostnameAllowed || url.username || url.password
      || url.pathname !== "/" || url.search || url.hash || (url.port && url.port !== "443")) {
      throw new Error("Invalid feed origin");
    }
    origin = url.origin;
  } catch {
    throw new FeedTransportError("invalid_configuration");
  }
  if (!UUID.test(configuration.integrationId) || !/^hvn_[a-f0-9]{64}$/.test(configuration.token)) {
    throw new FeedTransportError("invalid_configuration");
  }
  // Capture the credentials and destination once; callers cannot override them per page.
  const integrationId = configuration.integrationId;
  const token = configuration.token;
  const injectedFetch: InjectedFeedFetch = configuration.fetch
    ?? ((url, init) => fetch(url, init));
  return Object.freeze({
    mode: configuration.mode,
    origin,
    integrationId,
    async read(request: FeedRequest): Promise<unknown> {
      // Re-checked every read: the kill switch can be revoked mid-process.
      if (live) assertLiveRuntime("live", configuration.fetch);
      else assertSyntheticRuntime("synthetic", injectedFetch);
      const limit = request.limit ?? 100;
      if (Object.keys(request).some(key => key !== "after" && key !== "limit")
        || typeof request.after !== "string" || !/^(0|[1-9][0-9]{0,18})$/.test(request.after)
        || BigInt(request.after) > MAX_CURSOR || !Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new FeedTransportError("invalid_request");
      }
      const url = new URL(FEED_PATH, origin);
      url.searchParams.set("after", request.after);
      url.searchParams.set("limit", String(limit));
      const controller = new AbortController();
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cancelReader = () => { void reader?.cancel().catch(() => undefined); };
      const operation = async () => {
        const response = await injectedFetch(url.toString(), {
          method: "GET",
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
          redirect: "error",
          credentials: "omit",
          cache: "no-store",
          signal: controller.signal,
        });
        if (controller.signal.aborted) {
          void response.body?.cancel().catch(() => undefined);
          throw new FeedTransportError("timeout");
        }
        if (response.status === 401) {
          void response.body?.cancel().catch(() => undefined);
          throw new FeedTransportError("unauthorized", 401);
        }
        if (response.status !== 200 || response.redirected) {
          void response.body?.cancel().catch(() => undefined);
          throw new FeedTransportError("http_error", response.status);
        }
        if (response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
          void response.body?.cancel().catch(() => undefined);
          throw new FeedTransportError("invalid_response");
        }
        const declaredBytes = response.headers.get("content-length");
        if (declaredBytes && (!/^\d+$/.test(declaredBytes) || BigInt(declaredBytes) > BigInt(FEED_RESPONSE_BYTE_LIMIT))) {
          void response.body?.cancel().catch(() => undefined);
          throw new FeedTransportError("too_large");
        }
        if (!response.body) throw new FeedTransportError("invalid_response");
        reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let length = 0;
        while (true) {
          if (controller.signal.aborted) throw new FeedTransportError("timeout");
          const { done, value } = await reader.read();
          if (controller.signal.aborted) throw new FeedTransportError("timeout");
          if (done) break;
          length += value.byteLength;
          if (length > FEED_RESPONSE_BYTE_LIMIT) throw new FeedTransportError("too_large");
          chunks.push(value);
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        try {
          // Preserve the provider's {success,data} wrapper for complete control validation.
          return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
        } catch {
          throw new FeedTransportError("invalid_response");
        }
      };
      try {
        return await Promise.race([
          operation(),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              cancelReader();
              reject(new FeedTransportError("timeout"));
            }, FEED_TIMEOUT_MS);
          }),
        ]);
      } catch (error) {
        controller.abort();
        if (error instanceof FeedTransportError) throw error;
        // Never propagate a fetch error that might echo credentials, URLs, or response bodies.
        throw new FeedTransportError("transport_error");
      } finally {
        if (timer) clearTimeout(timer);
        cancelReader();
      }
    },
  });
}
