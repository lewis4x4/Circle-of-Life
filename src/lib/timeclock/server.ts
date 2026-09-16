/**
 * Server-only helpers for the timeclock routes (COL-352). Never import from a
 * client component: this file reads the badge HMAC secret.
 */
import { createHmac } from "node:crypto";

import { NextResponse } from "next/server";

import { KIOSK_ERROR_STATUS, publicKioskErrorCode, type KioskErrorCode } from "@/lib/timeclock/kiosk-contract";

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
  const headers: Record<string, string> = {};
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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
