import { runEvidenceCommand } from "@/lib/operations/evidence";

/** COL-143: report a failed or abandoned upload; a required rule stays missing, a supplementary row never appears attached. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return runEvidenceCommand("fail", request, params);
}
