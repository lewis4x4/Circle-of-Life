import { commandBenefitsCollection, listBenefitsCollection } from "@/lib/benefits/family-server";
import { benefitsFailure } from "@/lib/benefits/server";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) { try { return await listBenefitsCollection((await params).id); } catch { return benefitsFailure(); } }
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) { try { return await commandBenefitsCollection(request, (await params).id); } catch { return benefitsFailure(); } }
