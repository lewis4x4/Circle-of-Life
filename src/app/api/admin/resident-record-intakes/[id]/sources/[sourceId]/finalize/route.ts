import { finalizeResidentIntakeSource } from "@/lib/resident-intake/source-bytes";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; sourceId: string }> }) {
  const { id, sourceId } = await params;
  return finalizeResidentIntakeSource(request, id, sourceId);
}
