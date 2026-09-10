import { NextRequest, NextResponse } from "next/server";

import { runOperationTaskCommand } from "@/lib/operations/task-command";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { reason?: string } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  if (!body || (body.reason !== undefined && typeof body.reason !== "string")) {
    return NextResponse.json({ error: "Invalid escalation reason" }, { status: 400 });
  }
  return runOperationTaskCommand(id, "escalate", { reason: body.reason });
}
