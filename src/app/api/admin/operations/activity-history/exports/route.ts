import { NextResponse } from "next/server";
import { z } from "zod";
import { requireOperationsActor, revalidateOperationsActor, actorCanViewOperations } from "@/lib/operations/auth";
import { OPERATIONS_VIEW_ROLES } from "@/lib/operations/constants";
import { historyExportRpc, HistoryExportError, validManifest } from "@/lib/operations/history-export";
const schema = z.object({ facility_id: z.string().uuid(), activity_id: z.string().uuid(), request_id: z.string().uuid() }).strict();
export async function POST(request: Request) {
  const auth = await requireOperationsActor({ allowedRoles: OPERATIONS_VIEW_ROLES });
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Valid facility_id, activity_id and request_id are required" }, { status: 400 });
  try {
    const result = await historyExportRpc(auth.actor, "create_operation_history_export", { p_facility: parsed.data.facility_id, p_activity: parsed.data.activity_id, p_request: parsed.data.request_id }) as { export_id: string; manifest: unknown };
    if (!result || !z.string().uuid().safeParse(result.export_id).success || !validManifest(result.manifest)) throw new HistoryExportError("Export manifest unavailable; retry the same request");
    const current = await revalidateOperationsActor(auth.actor);
    if ("response" in current) return current.response;
    if (!actorCanViewOperations(current.actor) || current.actor.id !== auth.actor.id || current.actor.organizationId !== auth.actor.organizationId) throw new HistoryExportError("Export is no longer accessible", 403);
    // Same-key replay rechecks every saved scope, including native attachments.
    await historyExportRpc(current.actor, "read_operation_history_export", { p_id: result.export_id, p_offset: 0, p_limit: 1 });
    return NextResponse.json({ ...result, download_url: `/api/admin/operations/activity-history/exports/${result.export_id}/download` }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof HistoryExportError ? error.message : "Export unavailable; retry the same request" }, { status: error instanceof HistoryExportError ? error.status : 503, headers: { "Cache-Control": "no-store" } });
  }
}
