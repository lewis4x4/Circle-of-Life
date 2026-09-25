import { downloadResidentDocument } from "@/lib/document-intake/server/resident-documents";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; documentId: string }> }) {
  const { id, documentId } = await params;
  return downloadResidentDocument(id, documentId);
}
