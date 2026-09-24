export const runtime = "nodejs";

import { completeBenefitsRecheck } from "@/lib/benefits/server";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return completeBenefitsRecheck(request, id);
}
