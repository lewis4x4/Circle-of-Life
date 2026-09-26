/**
 * Server-only helpers for the timeclock routes (COL-352). Never import from a
 * client component: this file reads the badge HMAC secret.
 */
import { createHmac } from "node:crypto";

import { NextResponse } from "next/server";

import { KIOSK_ERROR_STATUS, publicKioskErrorCode, publicKioskNameErrorCode, type KioskErrorCode } from "@/lib/timeclock/kiosk-contract";

export const BADGE_HMAC_SECRET_ENV = "TIMECLOCK_BADGE_HMAC_SECRET";

function badgeSecret(): string | null {
  const value = process.env[BADGE_HMAC_SECRET_ENV]?.trim();
  return value && value.length >= 16 ? value : null;
}

export function badgeHmacConfigured(): boolean {
  return badgeSecret() !== null;
}

/**
 * Lookup key for a badge number: HMAC-SHA256 hex with the server secret. The
 * badge itself is never stored or logged. Returns null when the secret is not
 * set so employee number punches keep working before the badge rollout.
 */
export function badgeLookupHmac(badgeValue: string): string | null {
  const secret = badgeSecret();
  if (!secret) return null;
  const normalized = badgeValue.trim();
  if (!normalized) return null;
  return createHmac("sha256", secret).update(normalized, "utf8").digest("hex");
}

export function kioskErrorResponse(dbCode: string, extra?: Record<string, unknown>): NextResponse {
  const code: KioskErrorCode = publicKioskErrorCode(dbCode);
  const status = KIOSK_ERROR_STATUS[code];
  // A kiosk answer is about one person at one moment; no cache may keep it.
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (code === "device_throttled") headers["Retry-After"] = "300";
  if (code === "locked") headers["Retry-After"] = "900";
  return NextResponse.json({ error: code, ...(extra ?? {}) }, { status, headers });
}

/** Best-effort client address for enrollment rate limiting behind Netlify. */
export function clientAddress(request: Request): string {
  const netlify = request.headers.get("x-nf-client-connection-ip");
  if (netlify) return netlify.trim();
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return "unknown";
}

/**
 * Who a kiosk request is for. A tapped name sends `staff_id` and nothing else;
 * the employee-number screen sends `identifier` (spec 37 section 5). Never both.
 */
export type KioskSubject = { kind: "name"; staffId: string } | { kind: "number"; identifier: string };

const STAFF_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function kioskSubject(body: Record<string, unknown>): KioskSubject | null {
  const staffId = typeof body.staff_id === "string" ? body.staff_id.trim() : "";
  const identifier = typeof body.identifier === "string" ? body.identifier.trim() : "";
  if (staffId && identifier) return null;
  if (staffId) return STAFF_ID_RE.test(staffId) ? { kind: "name", staffId } : null;
  if (identifier && identifier.length <= 64) return { kind: "number", identifier };
  return null;
}

/** The RPC arguments for a subject: the name path never sends an identifier or badge. */
export function kioskSubjectArgs(subject: KioskSubject): { p_identifier: string; p_badge_lookup_hmac: string | null; p_staff_id: string | null } {
  return subject.kind === "name"
    ? { p_identifier: "", p_badge_lookup_hmac: null, p_staff_id: subject.staffId }
    : { p_identifier: subject.identifier, p_badge_lookup_hmac: badgeLookupHmac(subject.identifier), p_staff_id: null };
}

/**
 * A refused identify or punch. The name path may say "not set up here" and how
 * many tries are left; the employee-number path says neither (spec 37 §12a).
 */
export function kioskSubjectErrorResponse(subject: KioskSubject, result: Record<string, unknown>, dbCode: string): NextResponse {
  if (subject.kind === "number") return kioskErrorResponse(dbCode);
  const triesLeft = typeof result.tries_left === "number" ? result.tries_left : null;
  return kioskErrorResponse(publicKioskNameErrorCode(dbCode), triesLeft === null ? undefined : { tries_left: Math.max(0, Math.floor(triesLeft)) });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
