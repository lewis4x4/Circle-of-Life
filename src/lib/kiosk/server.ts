/**
 * Server-only helpers for the /api/kiosk/visitor/* routes (COL-692).
 */
import { NextResponse } from "next/server";

import { KIOSK_VISITOR_ERROR_STATUS, type KioskFieldErrors, type KioskVisitorErrorCode } from "@/lib/kiosk/contract";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export function kioskVisitorJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/** Unknown database codes read as `unavailable`; the kiosk never shows raw text. */
export function kioskVisitorError(dbCode: string, fields?: KioskFieldErrors): NextResponse {
  const code: KioskVisitorErrorCode = dbCode in KIOSK_VISITOR_ERROR_STATUS ? (dbCode as KioskVisitorErrorCode) : "unavailable";
  return kioskVisitorJson(fields ? { error: code, fields } : { error: code }, KIOSK_VISITOR_ERROR_STATUS[code]);
}
