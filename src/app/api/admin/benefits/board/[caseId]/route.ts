export const runtime = "nodejs";

import { commandMedicaidBoard } from "@/lib/benefits/server";
export async function POST(request: Request, context: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await context.params;
  return commandMedicaidBoard(request, caseId);
}
