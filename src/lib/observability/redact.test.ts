import { describe, expect, it } from "vitest";

import {
  pickRedacted,
  redactString,
  redactStringWithCounts,
  redactValue,
} from "./redact";

describe("redact patterns", () => {
  it("redacts SSNs in any context", () => {
    expect(redactString("contact 123-45-6789 today")).toBe(
      "contact [REDACTED_SSN] today",
    );
  });

  it("redacts member ID phrases regardless of casing", () => {
    expect(redactString("member id ABC123456")).toBe("[REDACTED_MEMBER_ID]");
    expect(redactString("Medicaid Number A1B2C3D4")).toBe("[REDACTED_MEMBER_ID]");
  });

  it("redacts DOB in slash and word forms", () => {
    expect(redactString("DOB 3/14/1942")).toBe("[REDACTED_DOB]");
    expect(redactString("born March 14, 1942")).toBe("[REDACTED_DOB]");
  });

  it("redacts DEA numbers", () => {
    expect(redactString("DEA AB1234567 on file")).toBe(
      "DEA [REDACTED_DEA] on file",
    );
  });

  it("redacts standalone 10-digit NPI", () => {
    expect(redactString("NPI 1234567890 for Smith")).toBe(
      "NPI [REDACTED_NPI] for Smith",
    );
  });

  it("redacts dosage phrasing", () => {
    // The dosage regex consumes the quantity + unit; trailing route-of-admin
    // words may stay (existing pre-shared-module behaviour).
    expect(redactString("ordered 5 mg today")).toBe(
      "ordered [REDACTED_DOSAGE]today",
    );
    expect(redactString("100 mcg")).toBe("[REDACTED_DOSAGE]");
  });

  it("reports per-pattern hit counts when patterns fire", () => {
    const result = redactStringWithCounts(
      "DOB 1/2/1950, member id X1234567, SSN 123-45-6789",
    );
    expect(result.patterns_hit.dob).toBe(1);
    expect(result.patterns_hit.member_id).toBe(1);
    expect(result.patterns_hit.ssn).toBe(1);
  });

  it("returns empty patterns_hit when nothing matched", () => {
    expect(redactStringWithCounts("ok").patterns_hit).toEqual({});
  });
});

describe("redactValue", () => {
  it("walks objects and redacts string leaves", () => {
    const redacted = redactValue({
      ok: true,
      reason: "DOB 5/5/1955 mismatch",
      nested: { ssn: "999-99-9999", count: 7 },
    });
    expect(redacted).toEqual({
      ok: true,
      reason: "[REDACTED_DOB] mismatch",
      nested: { ssn: "[REDACTED_SSN]", count: 7 },
    });
  });

  it("walks arrays", () => {
    expect(redactValue(["alpha", "SSN 123-45-6789"])).toEqual([
      "alpha",
      "SSN [REDACTED_SSN]",
    ]);
  });

  it("passes through non-string primitives untouched", () => {
    expect(redactValue(42)).toBe(42);
    expect(redactValue(null)).toBe(null);
    expect(redactValue(undefined)).toBe(undefined);
    expect(redactValue(true)).toBe(true);
  });
});

describe("pickRedacted", () => {
  it("returns only requested keys, all redacted", () => {
    const source = {
      taskId: "abc",
      residentName: "Alice Resident",
      ssn: "111-22-3333",
      bodyText: "long secret prose",
    };
    expect(pickRedacted(source, ["taskId", "ssn"])).toEqual({
      taskId: "abc",
      ssn: "[REDACTED_SSN]",
    });
  });

  it("treats missing source as empty object", () => {
    expect(pickRedacted(undefined, ["a", "b"])).toEqual({});
  });

  it("skips keys not present on the source", () => {
    expect(pickRedacted({ a: 1 }, ["a", "b"])).toEqual({ a: 1 });
  });
});
