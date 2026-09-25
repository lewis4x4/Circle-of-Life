export const runtime = "nodejs";

import { benefitsFailure, getScreeningSheet } from "@/lib/benefits/server";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) { try { return await getScreeningSheet((await params).id); } catch { return benefitsFailure(); } }
