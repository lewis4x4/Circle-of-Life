import type { TransactionEvent } from "@sentry/core";
import { describe, expect, it } from "vitest";

import {
  parseTraceSampleRate,
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
      transaction:
        "GET /admin/residents/11111111-1111-4111-8111-111111111111?resident=avery@example.com",
      request: {
        url: "https://haven.test/admin/residents/11111111-1111-4111-8111-111111111111?tab=medications",
      },
      spans: [
        {
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
});
