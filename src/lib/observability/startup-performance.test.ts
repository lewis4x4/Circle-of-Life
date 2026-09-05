import { describe, expect, it, vi } from "vitest";
import { startStartupTrace, startupMark, summarizeStartupResources } from "./startup-performance";

describe("opt-in startup diagnostics", () => {
  it("does no logging or observation during ordinary visits", () => {
    const info = vi.spyOn(console, "info");
    startStartupTrace();
    startupMark("auth-ready");
    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
  });

  it("keeps only numeric timings and categories, never resource URLs or query data", () => {
    const result = summarizeStartupResources([
      { name: "https://example.test/rest/v1/residents?name=private&apikey=secret", initiatorType: "fetch", startTime: 23.7, duration: 99.8, transferSize: 20 },
      { name: "https://example.test/auth/v1/token?refresh_token=secret", initiatorType: "fetch", startTime: 2, duration: 300, transferSize: 0 },
      { name: "https://example.test/_next/static/a.js", initiatorType: "script", startTime: 1, duration: 20, transferSize: 50 },
    ]);
    expect(result).toEqual([
      { kind: "auth", startMs: 2, durationMs: 300, bytes: 0 },
      { kind: "database", startMs: 24, durationMs: 100, bytes: 20 },
      { kind: "javascript", startMs: 1, durationMs: 20, bytes: 50 },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/private|secret|example|residents|token/);
  });
});
