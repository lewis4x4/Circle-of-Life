import { NextResponse } from "next/server";
import type { z } from "zod";

import { logError } from "@/lib/observability/logger";
import { mapIntakeRpcError } from "../contracts";
import { DocumentIntakeByteError, extensionForMime } from "./bytes";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export function intakeJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export function intakeFailure(status: number, outcome: string, error: string, extra?: Record<string, unknown>) {
  return intakeJson({ error, outcome, ...extra }, status);
}

/** Log ids only, then answer with the shared RPC error mapping. */
export function intakeRpcFailure(
  scope: string,
  error: { code?: string; message?: string } | null | undefined,
  ids: Record<string, string | null | undefined>,
  extra?: Record<string, unknown>,
) {
  logError(scope, error, ids);
  const mapped = mapIntakeRpcError(error);
  return intakeFailure(mapped.status, mapped.outcome, mapped.error, extra);
}

export function byteErrorResponse(error: DocumentIntakeByteError, extra?: Record<string, unknown>) {
  const status = error.outcome === "unsupported" ? 400 : error.outcome === "missing" ? 404 : 409;
  return intakeFailure(status, error.outcome, error.message, extra);
}

export async function readIntakeBody<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
): Promise<{ response: NextResponse } | { body: z.infer<T> }> {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.length ? `${first.path.join(".")}: ` : "";
    return { response: intakeFailure(400, "validation", `${where}${first?.message ?? "Invalid request"}`) };
  }
  return { body: parsed.data as z.infer<T> };
}

/**
 * Stream stored bytes to the browser inline and same-origin under a CSP that
 * allows no script, frame, fetch or form, so the response can never run script
 * or be sniffed into another type. next.config.ts sets the same policy.
 */
export function safeInlineBytes(bytes: Uint8Array, mime: string, baseName: string) {
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new NextResponse(body, {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `inline; filename="${baseName}.${extensionForMime(mime)}"`,
      "Content-Security-Policy": "default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
