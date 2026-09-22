export const runtime = "nodejs";

import { commandBenefitsCase } from "@/lib/benefits/server";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return commandBenefitsCase(request, id);
}
