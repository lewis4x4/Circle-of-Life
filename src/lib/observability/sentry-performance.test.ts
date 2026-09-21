import type { TransactionEvent } from "@sentry/core";
import { describe, expect, it } from "vitest";

import {
  parseTraceSampleRate,
  scrubErrorEvent,
  scrubPerformanceEvent,
} from "./sentry-performance";

describe("Sentry performance privacy", () => {
  it("bounds configured sample rates and uses the fallback for invalid input", () => {
    expect(parseTraceSampleRate(undefined, 0.05)).toBe(0.05);
    expect(parseTraceSampleRate("0.2", 0.05)).toBe(0.2);
    expect(parseTraceSampleRate("3", 0.05)).toBe(1);
    expect(parseTraceSampleRate("-1", 0.05)).toBe(0);
    expect(parseTraceSampleRate("nope", 0.05)).toBe(0.05);
  });

  it("removes identifiers and query strings from transactions and spans", () => {
    const event = {
      type: "transaction",
      transaction:
        "GET /admin/residents/11111111-1111-4111-8111-111111111111?resident=avery@example.com",
      request: {
        url: "https://haven.test/admin/residents/11111111-1111-4111-8111-111111111111?tab=medications",
      },
      spans: [
        {
          span_id: "1111111111111111",
          trace_id: "22222222222222222222222222222222",
          start_timestamp: 1,
          description:
            "GET https://api.test/residents/11111111-1111-4111-8111-111111111111?select=*",
          data: {
            url: "https://api.test/residents?id=11111111-1111-4111-8111-111111111111",
          },
        },
      ],
    } as TransactionEvent;

    const scrubbed = scrubPerformanceEvent(event);

    expect(scrubbed.transaction).toBe("GET /admin/residents/[id]");
    expect(scrubbed.request?.url).toBe("https://haven.test/admin/residents/[id]");
    expect(scrubbed.spans?.[0]?.description).toBe(
      "GET https://api.test/residents/[id]",
    );
    expect(scrubbed.spans?.[0]?.data?.url).toBe("https://api.test/residents");
  });

  it("removes connection identity and request payloads from error events", () => {
    const event = scrubErrorEvent({
      user: { id: "safe-user", email: "resident@example.com", ip_address: "192.0.2.20" },
      request: {
        url: "https://haven.test/api/public/referrals?email=resident@example.com",
        headers: {
          Authorization: "Bearer secret",
          Cookie: "session=secret",
          "Content-Type": "application/json",
          "X-Nf-Client-Connection-Ip": "192.0.2.21",
          "X-Forwarded-For": "192.0.2.22",
          "X-Real-Ip": "192.0.2.23",
        },
        cookies: { session: "secret" },
        query_string: "email=resident@example.com",
        data: { email: "resident@example.com", phone: "3865550199" },
      },
    });

    expect(event.user).toEqual({ id: "safe-user" });
    expect(event.request).toEqual({
      url: "https://haven.test/api/public/referrals",
      headers: { "Content-Type": "application/json" },
    });
    expect(JSON.stringify(event)).not.toMatch(/192\.0\.2\.|resident@example\.com|3865550199|secret/);
  });

  it("also removes connection headers from transaction request context", () => {
    const event = scrubPerformanceEvent({
      type: "transaction",
      transaction: "POST /api/public/referrals",
      request: {
        url: "https://haven.test/api/public/referrals?source=public",
        headers: { "x-nf-client-connection-ip": "192.0.2.24" },
        data: { phone: "3865550199" },
      },
    });

    expect(event.request).toEqual({
      url: "https://haven.test/api/public/referrals",
      headers: {},
    });
  });
});
