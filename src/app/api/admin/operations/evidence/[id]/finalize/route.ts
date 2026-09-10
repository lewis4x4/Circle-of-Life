import { runEvidenceCommand } from "@/lib/operations/evidence";

/** COL-143: finalize evidence against the receipt revision the client read; satisfaction is appended to the same performance, never a second one. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return runEvidenceCommand("finalize", request, params);
}
