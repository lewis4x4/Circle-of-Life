import { afterEach, describe, expect, it, vi } from "vitest";

import {
  describeRoundingQueryFailure,
  logRoundingQueryFailure,
  roundingCommandRefusal,
} from "./rounding-query-error";

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Spec decision D23. "Could not load X. Confirm facility scope and retry." hid
 * three unrelated query defects for long enough that a spec was written
 * blaming a fourth cause. The operator sentence stays; the code no longer
 * disappears with it.
 */
describe("rounding query failures", () => {
  it("pulls the PostgREST code off the error", () => {
    expect(
      describeRoundingQueryFailure({
        code: "42703",
        message: 'column residents.room_number does not exist',
        hint: null,
      }),
    ).toEqual({
      code: "42703",
      hint: null,
      message: "column residents.room_number does not exist",
    });
  });

  it("pulls the embed ambiguity code off the error", () => {
    expect(describeRoundingQueryFailure({ code: "PGRST201", message: "ambiguous" }).code).toBe(
      "PGRST201",
    );
  });

  it("names the gap when the error carries no message", () => {
    expect(describeRoundingQueryFailure(null).message).toBe("No message posted");
    expect(describeRoundingQueryFailure({}).code).toBeNull();
  });

  it("never logs the error's details, which can carry a row value", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logRoundingQueryFailure(
      "rounding.test",
      { code: "23505", message: "duplicate key", details: "Key (id)=(a-real-value) exists." },
      "Try again.",
    );
    const logged = spy.mock.calls[0]?.join(" ") ?? "";
    expect(logged).toContain("23505");
    expect(logged).not.toContain("a-real-value");
  });

  it("returns the operator sentence unchanged so a caller reads as one expression", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      logRoundingQueryFailure("rounding.test", { code: "42703" }, "The board could not be loaded."),
    ).toBe("The board could not be loaded.");
  });

  /**
   * Every command in this module sets an explicit `ERRCODE`, so gating the
   * operator-visible message on plpgsql's default `P0001` would have suppressed
   * all of them. These are the codes `create_monitoring_order` and
   * `cancel_monitoring_order` actually raise.
   */
  it.each([
    ["42501", "This role cannot enter a Monitoring Order"],
    ["22023", "Say why the Monitoring Order is being stood down"],
    ["23505", "This resident is already on a Monitoring Order."],
    ["P0002", "Monitoring Order not found"],
    ["P0001", "Something the command refused"],
  ])("shows the command's own sentence for a %s refusal", (code, message) => {
    expect(roundingCommandRefusal({ code, message }, "fallback")).toBe(message);
  });

  it.each(["42703", "PGRST201", "08006", "42P01"])(
    "falls back to the operator sentence for infrastructure code %s",
    (code) => {
      expect(roundingCommandRefusal({ code, message: "column does not exist" }, "fallback")).toBe(
        "fallback",
      );
    },
  );

  it("falls back when a refusal carried no message", () => {
    expect(roundingCommandRefusal({ code: "22023", message: "" }, "fallback")).toBe("fallback");
    expect(roundingCommandRefusal(null, "fallback")).toBe("fallback");
  });
});
