import { fileDocumentIntakeItem } from "@/lib/document-intake/server/filing";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  return fileDocumentIntakeItem(request, itemId);
}
