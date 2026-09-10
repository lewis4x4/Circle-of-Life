import { runEvidenceCommand } from "@/lib/operations/evidence";

/** COL-143: the uploader confirms the object landed; the database checks the owned object against the prepared evidence. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return runEvidenceCommand("uploaded", request, params);
}
