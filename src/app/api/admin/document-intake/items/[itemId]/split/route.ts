import { splitDocumentIntakeItem } from "@/lib/document-intake/server/review";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  return splitDocumentIntakeItem(request, itemId);
}
