import { runIssueCommand } from "@/lib/operations/issues";

/** COL-144 issue lifecycle: the link command, through the shared session flow. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return runIssueCommand("link", request, params);
}
