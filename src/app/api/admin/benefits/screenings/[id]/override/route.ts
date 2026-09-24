export const runtime = "nodejs";

import { overrideAdmissionScreening } from "@/lib/benefits/server";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return overrideAdmissionScreening(request, id);
}
