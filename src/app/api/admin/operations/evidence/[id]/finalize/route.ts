import { runEvidenceCommand } from "@/lib/operations/evidence";

/**
 * COL-143: finalize evidence against the receipt revision the client read;
 * the stored object must still be the verified one (same id, eTag, version,
 * owner, size and type) or the row fails durably (409 conflict); an
 * unverified checksum is refused (409 uncertain). Satisfaction is appended to
 * the same performance, never a second one.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return runEvidenceCommand("finalize", request, params);
}
