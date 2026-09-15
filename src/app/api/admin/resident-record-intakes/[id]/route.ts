import { getResidentIntake } from "@/lib/resident-intake/api";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return getResidentIntake((await params).id);
}
