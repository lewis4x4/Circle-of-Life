import { NextResponse } from "next/server";
import { requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";
import { OPERATIONS_VIEW_ROLES } from "@/lib/operations/constants";
import { reminderCommandSchema, reminderSchema } from "@/lib/operations/reminders";
import { logError } from "@/lib/observability/logger";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return NextResponse.json({ error: "Work not found" }, { status: 404 });
  const auth = await requireOperationsActor({ allowedRoles: OPERATIONS_VIEW_ROLES });
  if ("response" in auth) return auth.response;
  const parsed = reminderCommandSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Provide a valid reminder action" }, { status: 400 });
  const current = await revalidateOperationsActor(auth.actor);
  if ("response" in current) return current.response;
  const input = parsed.data;
  const { data, error } = await current.actor.currentActor.client.rpc("operation_reminder_review" as never, {
    p_task: id, p_command: input.command, p_issue: input.issue_id ?? null,
    p_expected_revision: "expected_revision" in input ? input.expected_revision : null,
    p_until: "until" in input ? input.until : null,
    p_request_key: "request_key" in input ? input.request_key : null,
  } as never);
  if (error) {
    logError("admin.operations.reminder", error, { action: input.command });
    const status = error.code === "42501" ? 403 : error.code === "40001" ? 409 : error.code === "22023" ? 400 : 503;
    return NextResponse.json({ error: status === 409 ? "Reminder changed. Refresh before responding." : status === 403 ? "Reminder unavailable for your current access." : status === 400 ? "Choose a valid reminder action and future snooze time." : "Reminder could not be confirmed. Refresh before retrying." }, { status });
  }
  const result = reminderSchema.safeParse(data);
  if (!result.success) return NextResponse.json({ error: "Reminder could not be confirmed. Refresh before retrying." }, { status: 503 });
  const final = await revalidateOperationsActor(current.actor);
  if ("response" in final) return final.response;
  return NextResponse.json({ reminder: result.data });
}
