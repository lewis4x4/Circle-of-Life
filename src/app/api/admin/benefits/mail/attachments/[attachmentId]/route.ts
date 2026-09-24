export const runtime = "nodejs";

import { downloadBenefitsMailAttachment } from "@/lib/benefits/server";
export async function GET(request: Request, context: { params: Promise<{ attachmentId: string }> }) {
  const { attachmentId } = await context.params;
  return downloadBenefitsMailAttachment(request, attachmentId);
}
