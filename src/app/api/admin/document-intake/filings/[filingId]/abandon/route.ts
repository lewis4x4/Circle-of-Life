import { abandonDocumentIntakeFiling } from "@/lib/document-intake/server/filing";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ filingId: string }> }) {
  const { filingId } = await params;
  return abandonDocumentIntakeFiling(filingId);
}
