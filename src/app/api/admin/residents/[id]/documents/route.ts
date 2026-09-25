import { listResidentDocuments } from "@/lib/document-intake/server/resident-documents";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return listResidentDocuments(id);
}
