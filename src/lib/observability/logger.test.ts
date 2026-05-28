import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const captureException = vi.fn();
const captureMessage = vi.fn();

vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
  captureMessage: (...args: unknown[]) => captureMessage(...args),
}));

import { logError, logWarn } from "./logger";

describe("logError", () => {
  beforeEach(() => {
    captureException.mockClear();
    captureMessage.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("forwards to Sentry with scope tag and safe error fields only", () => {
    const err = Object.assign(new Error("user not found"), { code: "PGRST116" });
    logError("care-plans.approve", err, { residentId: "abc-123" });

    expect(captureException).toHaveBeenCalledTimes(1);
    const [forwardedErr, opts] = captureException.mock.calls[0] as [
      unknown,
      { tags: Record<string, string>; extra: Record<string, unknown> },
    ];
    expect(forwardedErr).toBe(err);
    expect(opts.tags).toEqual({ scope: "care-plans.approve" });
    expect(opts.extra).toEqual({
      error_name: "Error",
      error_message: "user not found",
      error_code: "PGRST116",
      residentId: "abc-123",
    });
  });

  it("never serialises the full error object — extras shape is fixed", () => {
    const supabaseStyleErr = {
      message: "RLS denied",
      code: "42501",
      details: "row 99 in residents",
      hint: "first_name=...",
      __row: { resident_id: "secret-1", ssn: "123-45-6789" },
    };
    logError("rounding.complete", supabaseStyleErr);

    expect(captureException).toHaveBeenCalledTimes(1);
    const [, opts] = captureException.mock.calls[0] as [unknown, { extra: Record<string, unknown> }];
    expect(opts.extra).toEqual({
      error_name: "Object",
      error_message: "RLS denied",
      error_code: "42501",
    });
    // Crucial: row data, details, hints must NOT appear in the Sentry extras.
    expect(opts.extra).not.toHaveProperty("details");
    expect(opts.extra).not.toHaveProperty("hint");
    expect(opts.extra).not.toHaveProperty("__row");
  });

  it("redacts known PHI patterns in the context payload", () => {
    logError("rounding.complete", new Error("oops"), {
      note: "resident SSN 123-45-6789 on chart",
      counts: { logs: 4 },
    });

    const [, opts] = captureException.mock.calls[0] as [unknown, { extra: Record<string, unknown> }];
    expect(opts.extra.note).toBe("resident SSN [REDACTED_SSN] on chart");
    expect(opts.extra.counts).toEqual({ logs: 4 });
  });

  it("accepts a string err and wraps it as a synthetic Error for Sentry", () => {
    logError("executive.refresh.edge", "edge invocation failed", { status: 500 });

    expect(captureException).toHaveBeenCalledTimes(1);
    const [forwardedErr, opts] = captureException.mock.calls[0] as [
      unknown,
      { extra: Record<string, unknown> },
    ];
    expect(forwardedErr).toBeInstanceOf(Error);
    expect((forwardedErr as Error).message).toBe("edge invocation failed");
    expect(opts.extra).toEqual({
      error_name: "Unknown",
      error_message: "edge invocation failed",
      status: 500,
    });
  });

  it("does not throw when Sentry forwarding errors", () => {
    captureException.mockImplementationOnce(() => {
      throw new Error("Sentry exploded");
    });
    expect(() => logError("scope", new Error("oops"))).not.toThrow();
  });
});

describe("logWarn", () => {
  beforeEach(() => {
    captureException.mockClear();
    captureMessage.mockClear();
  });

  it("forwards a warning message + redacted context to Sentry", () => {
    logWarn("admin.users.audit", "audit insert failed", {
      userId: "u-1",
      note: "DOB 1/1/1950",
    });

    expect(captureMessage).toHaveBeenCalledTimes(1);
    const [msg, opts] = captureMessage.mock.calls[0] as [
      string,
      { level: string; tags: Record<string, string>; extra: Record<string, unknown> },
    ];
    expect(msg).toBe("audit insert failed");
    expect(opts.level).toBe("warning");
    expect(opts.tags).toEqual({ scope: "admin.users.audit" });
    expect(opts.extra).toEqual({
      message: "audit insert failed",
      userId: "u-1",
      note: "[REDACTED_DOB]",
    });
  });
});
