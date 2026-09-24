export const runtime = "nodejs";

import { dismissBenefitsMail } from "@/lib/benefits/server";
export async function POST(request: Request, context: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await context.params;
  return dismissBenefitsMail(request, itemId);
}
