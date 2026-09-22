export const runtime = "nodejs";

import { downloadBenefitsDocument } from "@/lib/benefits/server";
export async function GET(request: Request, context: { params: Promise<{ id: string; documentId: string }> }) {
  const { id, documentId } = await context.params;
  return downloadBenefitsDocument(request, id, documentId);
}
