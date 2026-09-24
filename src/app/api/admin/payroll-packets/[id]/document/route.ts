import { NextResponse } from "next/server";
import { requireCurrentApiActor } from "@/lib/auth/current-api-actor";
import { databaseUuidSchema } from "@/lib/operations/database-uuid";
import { payrollDocument, PayrollPacketError, PACKET_ROLES } from "@/lib/payroll-packets/server";
import { payrollError, payrollHeaders } from "@/lib/payroll-packets/http";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireCurrentApiActor({ allowedRoles: PACKET_ROLES, scope: "payroll-packets.document" });
  if ("response" in auth) return auth.response;
  try {
    const format = new URL(request.url).searchParams.get("format") ?? "pdf";
    if (format !== "pdf" && format !== "html" && format !== "csv") throw new PayrollPacketError("Choose PDF, HTML or CSV.", 400);
    const result = await payrollDocument(auth.actor, databaseUuidSchema.parse((await context.params).id), format);
    const name = `payroll-${result.packet.period_start}-v${result.packet.version}-${result.packet.id}.${result.extension}`;
    return new NextResponse(typeof result.body === "string" ? result.body : new Uint8Array(result.body), { headers: {
      ...payrollHeaders, "Content-Type": result.type, "Content-Disposition": `${format === "html" ? "inline" : "attachment"}; filename="${name}"`,
      ...(format === "html" ? { "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'" } : {}),
    } });
  } catch (error) { return payrollError(error); }
}
