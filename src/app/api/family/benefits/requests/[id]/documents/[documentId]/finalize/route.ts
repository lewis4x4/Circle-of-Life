import { finalizeFamilyBenefitsDocument } from "@/lib/benefits/family-server";
import { benefitsFailure } from "@/lib/benefits/server";
export async function POST(request: Request, { params }: { params: Promise<{ id: string; documentId: string }> }) { try { const { id, documentId } = await params; return await finalizeFamilyBenefitsDocument(request, id, documentId); } catch { return benefitsFailure(); } }
