import { streamDocumentIntakeSource } from "@/lib/document-intake/server/source";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  return streamDocumentIntakeSource(request, itemId);
}
