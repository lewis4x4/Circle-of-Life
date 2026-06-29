import { describe, expect, it } from "vitest";

import { formatLiveDataLoadError } from "@/lib/live-data-fallback";
import { queryErrorMessage, throwIfQueryError } from "@/lib/supabase/query-error";

describe("queryErrorMessage", () => {
  it("extracts message from PostgREST-shaped errors", () => {
    expect(queryErrorMessage({ message: "column foo does not exist" })).toBe(
      "column foo does not exist",
    );
  });

  it("prefixes context when provided", () => {
    expect(queryErrorMessage({ message: "timeout" }, "residents profile")).toBe(
      "residents profile: timeout",
    );
  });
});

describe("throwIfQueryError", () => {
  it("throws Error with message", () => {
    expect(() => throwIfQueryError({ message: "RLS denied" }, "beds")).toThrow(
      "beds: RLS denied",
    );
  });

  it("no-ops on null", () => {
    expect(() => throwIfQueryError(null)).not.toThrow();
  });
});

describe("formatLiveDataLoadError", () => {
  it("returns fallback in production", () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    expect(formatLiveDataLoadError({ message: "column x missing" }, "Live data down.")).toBe(
      "Live data down.",
    );
    process.env.NODE_ENV = prev;
  });

  it("appends detail in development", () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    expect(
      formatLiveDataLoadError({ message: "column x missing" }, "Live data down."),
    ).toBe("Live data down. (column x missing)");
    process.env.NODE_ENV = prev;
  });
});
