import { prepareResidentIntakeSource } from "@/lib/resident-intake/source-bytes";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return prepareResidentIntakeSource(request, (await params).id);
}
