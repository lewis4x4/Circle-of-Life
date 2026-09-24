import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { PayrollPacketError } from "./server";

export const payrollHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export function payrollJson(value: unknown, status = 200) { return NextResponse.json(value, { status, headers: payrollHeaders }); }
export function payrollError(error: unknown) {
  if (error instanceof ZodError) return payrollJson({ error: error.issues[0]?.message ?? "Review the payroll fields." }, 400);
  if (error instanceof PayrollPacketError) return payrollJson({ error: error.message }, error.status);
  return payrollJson({ error: "The payroll request could not be completed. Refresh and try again." }, 500);
}
export async function payrollBody(request: Request): Promise<unknown> {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  const trusted = new URL(request.url);
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new PayrollPacketError("Open payroll from Haven before making changes.", 403);
  if (origin) {
    let sameOrigin = false;
    try {
      const candidate = new URL(origin);
      sameOrigin = candidate.origin === trusted.origin || (!!host && /^[a-z0-9.:[\]-]+$/i.test(host) && candidate.host === host && candidate.protocol === trusted.protocol);
    } catch { sameOrigin = false; }
    if (!sameOrigin) throw new PayrollPacketError("Open payroll from Haven before making changes.", 403);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new PayrollPacketError("Send payroll changes as JSON.", 415);
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 2_000_000) throw new PayrollPacketError("The payroll request is too large.", 413);
  const text = await request.text();
  if (Buffer.byteLength(text) > 2_000_000) throw new PayrollPacketError("The payroll request is too large.", 413);
  try { return JSON.parse(text); } catch { throw new PayrollPacketError("The payroll request is not valid JSON.", 400); }
}
