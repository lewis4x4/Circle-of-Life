import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  EMPTY_MOVEMENT_WHEN,
  MOVEMENT_GUARD_MESSAGE_STARTS,
  backdateWindowHint,
  isBeyondBackdateWindow,
  movementGuardMessage,
  movementPatchFields,
  resolveMovementWhen,
} from "./movement-effective-at";

// Thursday 2026-09-24, 10:00 AM Eastern.
const NOW = new Date("2026-09-24T14:00:00Z");

describe("resolveMovementWhen (COL-750)", () => {
  it("treats both fields blank as just now, so the database stamps the save time", () => {
    expect(resolveMovementWhen(EMPTY_MOVEMENT_WHEN, { windowDays: 3, now: NOW })).toEqual({
      ok: true,
      value: { effectiveAt: null, beyondWindow: false, reason: null },
    });
    expect(movementPatchFields({ effectiveAt: null, beyondWindow: false, reason: null })).toEqual({});
  });

  it("dates a hospital return entered Thursday for Tuesday afternoon on Tuesday, in Eastern time", () => {
    const result = resolveMovementWhen({ date: "2026-09-22", time: "15:10", reason: "" }, { windowDays: 3, now: NOW });
    expect(result).toEqual({
      ok: true,
      value: { effectiveAt: "2026-09-22T19:10:00.000Z", beyondWindow: false, reason: null },
    });
    if (result.ok) expect(movementPatchFields(result.value)).toEqual({ status_effective_at: "2026-09-22T19:10:00.000Z" });
  });

  it("refuses the future", () => {
    expect(resolveMovementWhen({ date: "2026-09-25", time: "", reason: "" }, { windowDays: 3, now: NOW })).toMatchObject({ ok: false });
    expect(resolveMovementWhen({ date: "2026-09-24", time: "11:00", reason: "" }, { windowDays: 3, now: NOW })).toEqual({
      ok: false,
      error: "That time is in the future. Enter when it actually happened.",
    });
  });

  it("asks for the time of an earlier day, and for the date when only a time is given", () => {
    expect(resolveMovementWhen({ date: "2026-09-22", time: "", reason: "" }, { windowDays: 3, now: NOW })).toEqual({
      ok: false,
      error: "Enter the time it happened (Eastern).",
    });
    expect(resolveMovementWhen({ date: "", time: "09:00", reason: "" }, { windowDays: 3, now: NOW })).toEqual({
      ok: false,
      error: "Choose the date as well as the time.",
    });
    expect(resolveMovementWhen({ date: "2026-09-24", time: "", reason: "" }, { windowDays: 3, now: NOW })).toMatchObject({
      ok: true,
      value: { effectiveAt: null },
    });
  });

  it("never assumes a discharge date", () => {
    expect(resolveMovementWhen(EMPTY_MOVEMENT_WHEN, { windowDays: 3, dateRequired: true, now: NOW })).toEqual({
      ok: false,
      error: "Choose the date it happened.",
    });
  });

  it("needs a reason beyond the window, which comes from the operating rule", () => {
    const late = { date: "2026-09-18", time: "09:00", reason: "" };
    expect(resolveMovementWhen(late, { windowDays: 3, now: NOW })).toEqual({ ok: false, error: "Say why this is being entered late." });
    expect(resolveMovementWhen({ ...late, reason: "  Paper log found  " }, { windowDays: 3, now: NOW })).toEqual({
      ok: true,
      value: { effectiveAt: "2026-09-18T13:00:00.000Z", beyondWindow: true, reason: "Paper log found" },
    });
    // A wider window set by an owner lets the same entry through without one.
    expect(resolveMovementWhen(late, { windowDays: 10, now: NOW })).toMatchObject({ ok: true, value: { beyondWindow: false } });
  });

  it("counts the window in Eastern calendar days, and an unreadable window as none", () => {
    expect(isBeyondBackdateWindow("2026-09-21", 3, NOW)).toBe(false);
    expect(isBeyondBackdateWindow("2026-09-20", 3, NOW)).toBe(true);
    expect(isBeyondBackdateWindow("2026-09-24", 0, NOW)).toBe(false);
    expect(isBeyondBackdateWindow("2026-09-23", 0, NOW)).toBe(true);
    expect(isBeyondBackdateWindow("2026-09-24", null, NOW)).toBe(true);
  });

  it("describes the window without inventing one", () => {
    expect(backdateWindowHint(undefined)).toBeNull();
    expect(backdateWindowHint(3)).toContain("up to 3 days back");
    expect(backdateWindowHint(1)).toContain("up to 1 day back");
    expect(backdateWindowHint(0)).toContain("Only an owner or org admin");
  });
});

describe("movement guard messages", () => {
  it("shows the guard's own wording and nothing else", () => {
    expect(
      movementGuardMessage({ message: "This would overlap the resident's last recorded change (in house on Sep 22, 2026 3:10 PM). Choose a time after it, or correct that change first." }),
    ).toContain("would overlap");
    expect(movementGuardMessage({ message: "permission denied for table residents" })).toBeNull();
    expect(movementGuardMessage(null)).toBeNull();
  });

  it("every message the form trusts is one the database raises (migration 503)", () => {
    const sql = readFileSync(path.join(process.cwd(), "supabase/migrations/503_resident_movement_effective_dates.sql"), "utf8").replace(/''/g, "'");
    for (const start of MOVEMENT_GUARD_MESSAGE_STARTS) expect(sql).toContain(start);
  });
});
