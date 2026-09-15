import { parseResidentIntakeSource } from "@/lib/resident-intake/parser";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return parseResidentIntakeSource(request, (await params).id);
}
