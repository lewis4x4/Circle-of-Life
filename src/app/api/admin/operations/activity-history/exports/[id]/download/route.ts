import { NextResponse } from "next/server";
import { databaseUuidSchema } from "@/lib/operations/database-uuid";
import { requireOperationsActor, revalidateOperationsActor, actorCanViewOperations } from "@/lib/operations/auth";
import { OPERATIONS_VIEW_ROLES } from "@/lib/operations/constants";
import { collectHistoryExport, historyExportCsv, historyExportRpc, HistoryExportError } from "@/lib/operations/history-export";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOperationsActor({ allowedRoles: OPERATIONS_VIEW_ROLES });
  if ("response" in auth) return auth.response;
  const { id } = await params;
  if (!databaseUuidSchema.safeParse(id).success) return NextResponse.json({ error: "Invalid export id" }, { status: 400 });
  try {
    const result = await collectHistoryExport(offset => historyExportRpc(auth.actor, "read_operation_history_export", { p_id: id, p_offset: offset, p_limit: 250 }), id);
    // Buffer and validate ALL pages before sending any bytes; no successful partial file.
    const csv = historyExportCsv(result.manifest, result.rows);
    const current = await revalidateOperationsActor(auth.actor);
    if ("response" in current) return current.response;
    if (!actorCanViewOperations(current.actor) || current.actor.id !== auth.actor.id || current.actor.organizationId !== auth.actor.organizationId) throw new HistoryExportError("Export is no longer accessible", 403);
    await historyExportRpc(current.actor, "read_operation_history_export", { p_id: id, p_offset: 0, p_limit: 1 });
    return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="haven-activity-history-${id}.csv"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof HistoryExportError ? error.message : "Export unavailable; retry download" }, { status: error instanceof HistoryExportError ? error.status : 503, headers: { "Cache-Control": "no-store" } });
  }
}
