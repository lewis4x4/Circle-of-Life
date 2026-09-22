export const runtime = "nodejs";

import { rebindBenefitsCase } from "@/lib/benefits/server";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return rebindBenefitsCase(request, id);
}
