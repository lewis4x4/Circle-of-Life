import { describe, expect, it } from "vitest";
import {
  TEMPORARY_PASSWORD_ALPHABET,
  TEMPORARY_PASSWORD_LENGTH,
  TEMPORARY_PASSWORD_TTL_HOURS,
  generateSecurePassword,
  isTemporaryPasswordExpired,
  temporaryPasswordExpiresAt,
} from "./temporary-password";

describe("generateSecurePassword", () => {
  it("produces the requested length from the published alphabet", () => {
    const password = generateSecurePassword();
    expect(password).toHaveLength(TEMPORARY_PASSWORD_LENGTH);
    for (const char of password) {
      expect(TEMPORARY_PASSWORD_ALPHABET).toContain(char);
    }
  });

  it("excludes glyphs that are ambiguous when read aloud", () => {
    expect(TEMPORARY_PASSWORD_ALPHABET).not.toMatch(/[Iil1Oo0]/);
    for (let i = 0; i < 200; i += 1) {
      expect(generateSecurePassword()).not.toMatch(/[Iil1Oo0]/);
    }
  });

  it("always includes every character class", () => {
    for (let i = 0; i < 500; i += 1) {
      const password = generateSecurePassword();
      expect(password).toMatch(/[A-HJ-NP-Z]/);
      expect(password).toMatch(/[a-hj-km-z]/);
      expect(password).toMatch(/[2-9]/);
      expect(password).toMatch(/[!@#$%]/);
    }
  });

  it("rejects lengths too short to carry every class", () => {
    expect(() => generateSecurePassword(3)).toThrow(/at least 4/);
  });

  it("does not repeat itself", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      seen.add(generateSecurePassword());
    }
    expect(seen.size).toBe(500);
  });

  it("is close to uniform over the alphabet", () => {
    // The old generator was `byte % 61`: 256 mod 61 = 12, so the first 12 characters of
    // the alphabet appeared 5/256 of the time against 4/256 for the other 49 — a 25%
    // excess. This asserts no such split exists between the head and tail of the
    // alphabet, which is the shape that bias took.
    const counts = new Map<string, number>();
    const samples = 4000;
    for (let i = 0; i < samples; i += 1) {
      // Only the filler positions are free; the four guaranteed class picks are drawn
      // from their own sub-alphabets, so sample a long password and let them wash out.
      for (const char of generateSecurePassword(64)) {
        counts.set(char, (counts.get(char) ?? 0) + 1);
      }
    }

    const head = TEMPORARY_PASSWORD_ALPHABET.slice(0, 12);
    const tail = TEMPORARY_PASSWORD_ALPHABET.slice(12);
    const sum = (chars: string) =>
      [...chars].reduce((total, char) => total + (counts.get(char) ?? 0), 0);

    const headRate = sum(head) / head.length;
    const tailRate = sum(tail) / tail.length;
    const skew = Math.abs(headRate - tailRate) / tailRate;

    // Modulo bias put this at ~0.25. Sampling noise at this volume is well under 0.05.
    expect(skew).toBeLessThan(0.05);
  });
});

describe("temporary password expiry boundary", () => {
  const issued = new Date("2026-09-16T12:00:00.000Z");

  it("expires exactly TTL hours after issue", () => {
    expect(temporaryPasswordExpiresAt(issued)).toBe("2026-09-19T12:00:00.000Z");
    expect(TEMPORARY_PASSWORD_TTL_HOURS).toBe(72);
  });

  it("is valid one millisecond before the deadline", () => {
    const expiresAt = temporaryPasswordExpiresAt(issued);
    const justBefore = new Date(Date.parse(expiresAt) - 1);
    expect(isTemporaryPasswordExpired(expiresAt, justBefore)).toBe(false);
  });

  it("is expired exactly at the deadline", () => {
    const expiresAt = temporaryPasswordExpiresAt(issued);
    const atBoundary = new Date(Date.parse(expiresAt));
    expect(isTemporaryPasswordExpired(expiresAt, atBoundary)).toBe(true);
  });

  it("is expired one millisecond after the deadline", () => {
    const expiresAt = temporaryPasswordExpiresAt(issued);
    const justAfter = new Date(Date.parse(expiresAt) + 1);
    expect(isTemporaryPasswordExpired(expiresAt, justAfter)).toBe(true);
  });

  it("treats a missing or unreadable deadline as expired", () => {
    // Failing open here would mean a forced-change obligation with no deadline never
    // expires, which is the opposite of what the flag is for.
    expect(isTemporaryPasswordExpired(null, issued)).toBe(true);
    expect(isTemporaryPasswordExpired(undefined, issued)).toBe(true);
    expect(isTemporaryPasswordExpired("", issued)).toBe(true);
    expect(isTemporaryPasswordExpired("not a date", issued)).toBe(true);
  });
});
