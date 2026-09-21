import type { Event, TransactionEvent } from "@sentry/core";

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PRIVATE_REQUEST_HEADERS = new Set([
  "authorization",
  "cookie",
  "cf-connecting-ip",
  "forwarded",
  "x-forwarded-for",
  "x-nf-client-connection-ip",
  "x-real-ip",
]);

export function parseTraceSampleRate(
  value: string | undefined,
  fallback: number,
): number {
  if (value == null || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
}

function scrubPerformanceText(value: string): string {
  let scrubbed = value.replace(UUID_PATTERN, "[id]").replace(EMAIL_PATTERN, "[email]");
  try {
    const url = new URL(scrubbed);
    url.search = "";
    url.hash = "";
    scrubbed = url.toString();
  } catch {
    // Transaction names and span descriptions are commonly route-like rather
    // than complete URLs. Strip their query/hash without changing the route.
    scrubbed = scrubbed.split("?")[0]?.split("#")[0] ?? scrubbed;
  }
  return scrubbed;
}

function scrubRequestContext(event: Event | TransactionEvent): void {
  if (!event.request) return;
  if (event.request.headers) {
    for (const header of Object.keys(event.request.headers)) {
      if (PRIVATE_REQUEST_HEADERS.has(header.toLowerCase())) {
        delete event.request.headers[header];
      }
    }
  }
  delete event.request.cookies;
  delete event.request.data;
  delete event.request.query_string;
  if (event.request.url) {
    event.request.url = scrubPerformanceText(event.request.url);
  }
}

/** Remove request PII that the SDK may attach even when sendDefaultPii=false. */
export function scrubErrorEvent(event: Event): Event {
  if (event.user) {
    event.user = { id: event.user.id };
  }
  scrubRequestContext(event);
  return event;
}

/** Remove resident/user identifiers and query strings from sampled traces. */
export function scrubPerformanceEvent(event: TransactionEvent): TransactionEvent {
  scrubRequestContext(event);
  if (event.transaction) {
    event.transaction = scrubPerformanceText(event.transaction);
  }

  for (const span of event.spans ?? []) {
    if (span.description) {
      span.description = scrubPerformanceText(span.description);
    }
    if (!span.data) continue;
    for (const [key, value] of Object.entries(span.data)) {
      if (typeof value === "string" && /(url|route|path|target|description)/i.test(key)) {
        span.data[key] = scrubPerformanceText(value);
      }
    }
  }

  return event;
}
