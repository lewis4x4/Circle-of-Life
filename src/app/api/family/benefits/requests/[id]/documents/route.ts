import { prepareFamilyBenefitsDocument } from "@/lib/benefits/family-server";
import { benefitsFailure } from "@/lib/benefits/server";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) { try { return await prepareFamilyBenefitsDocument(request, (await params).id); } catch { return benefitsFailure(); } }
