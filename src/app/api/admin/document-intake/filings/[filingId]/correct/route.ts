import { correctDocumentIntakeFiling } from "@/lib/document-intake/server/filing";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ filingId: string }> }) {
  const { filingId } = await params;
  return correctDocumentIntakeFiling(request, filingId);
}
