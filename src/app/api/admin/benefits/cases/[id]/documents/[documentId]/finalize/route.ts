export const runtime = "nodejs";

import { finalizeBenefitsDocument } from "@/lib/benefits/server";
export async function POST(request: Request, context: { params: Promise<{ id: string; documentId: string }> }) {
  const { id, documentId } = await context.params;
  return finalizeBenefitsDocument(request, id, documentId);
}
