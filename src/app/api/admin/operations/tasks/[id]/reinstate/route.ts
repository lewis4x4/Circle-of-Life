import { NextRequest } from "next/server";

import { runOperationTaskCommand } from "@/lib/operations/task-command";

export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return runOperationTaskCommand(id, "reinstate");
}
