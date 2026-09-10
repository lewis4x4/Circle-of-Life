import { runEvidenceCommand } from "@/lib/operations/evidence";

/**
 * COL-143: the uploader confirms the object landed; the database checks the
 * owned object against the prepared evidence and verifies the declared MD5
 * against the Storage eTag. A mismatch fails the row durably (409 conflict
 * with the failed evidence); an eTag that is not an MD5 leaves the row
 * uploaded but unverified (409 uncertain).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return runEvidenceCommand("uploaded", request, params);
}
