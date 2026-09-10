import { runIssueCommand } from "@/lib/operations/issues";

/** COL-144 issue lifecycle: the assign command, through the shared session flow. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return runIssueCommand("assign", request, params);
}
