export const runtime = "nodejs";

import { getBenefitsCase } from "@/lib/benefits/server";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return getBenefitsCase(request, id);
}
