import { downloadResidentIntakeSource } from "@/lib/resident-intake/source-bytes";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; sourceId: string }> }) {
  const { id, sourceId } = await params;
  return downloadResidentIntakeSource(id, sourceId);
}
