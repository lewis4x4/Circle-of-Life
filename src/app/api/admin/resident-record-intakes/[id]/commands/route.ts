import { commandResidentIntake } from "@/lib/resident-intake/api";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return commandResidentIntake(request, (await params).id);
}
