export const runtime = "nodejs";

import { benefitsFailure, getDocumentFreshness, reopenDocumentFreshness } from "@/lib/benefits/server";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) { try { return await getDocumentFreshness((await params).id); } catch { return benefitsFailure(); } }
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) { try { return await reopenDocumentFreshness(request, (await params).id); } catch { return benefitsFailure(); } }
