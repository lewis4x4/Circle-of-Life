import { NextResponse } from "next/server";
import { databaseUuidSchema } from "@/lib/operations/database-uuid";
import { BenefitsPacketError, buildBenefitsPacket, packetRequestSchema, selectPacketDocuments } from "@/lib/benefits/packet";
import { getVerifiedBenefitsDocument, loadBenefitsDetail, recordBenefitsDocumentAccess, requireBenefitsActor, revalidateBenefitsActor } from "@/lib/benefits/server";

export const runtime = "nodejs";

const errorResponse = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "private, no-store" } });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authorized = await requireBenefitsActor();
    if ("response" in authorized) return authorized.response;
    const { id } = await context.params;
    if (!databaseUuidSchema.safeParse(id).success) return errorResponse("Invalid case identifier.", 400);
    if (Number(request.headers.get("content-length")) > 8192) return errorResponse("Packet request is too large.", 400);
    // Read at most 8 KiB even for chunked requests without a content-length header.
    const reader = request.body?.getReader();
    if (!reader) return errorResponse("Packet selection is required.", 400);
    let length = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 8192) { await reader.cancel(); return errorResponse("Packet request is too large.", 400); }
      chunks.push(value);
    }
    let json: unknown;
    try { json = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return errorResponse("Invalid packet request.", 400); }
    const parsed = packetRequestSchema.safeParse(json);
    if (!parsed.success) return errorResponse("Select 1 to 25 distinct documents and provide the current case revision.", 400);
    const { document_ids, expected_revision } = parsed.data;
    const loaded = await loadBenefitsDetail(authorized.actor, id);
    if ("response" in loaded) return loaded.response;
    if (loaded.detail.case.revision !== expected_revision) return errorResponse("Case changed. Refresh before exporting.", 409);
    const selected = selectPacketDocuments(loaded.detail, document_ids);
    const verifiedBytes = new Map<string, Uint8Array>();
    for (const document of selected) {
      const verified = await getVerifiedBenefitsDocument(authorized.actor, id, document.id);
      if ("response" in verified) return verified.response;
      verifiedBytes.set(document.id, verified.bytes);
      const recorded = await recordBenefitsDocumentAccess(authorized.actor, id, document.id, "packet");
      if (recorded) return recorded;
    }
    const current = await revalidateBenefitsActor(authorized.actor);
    if ("response" in current) return current.response;
    const latest = await loadBenefitsDetail(current.actor, id);
    if ("response" in latest) return latest.response;
    if (latest.detail.case.revision !== expected_revision) return errorResponse("Case changed during export. Refresh and try again.", 409);
    const packet = buildBenefitsPacket(latest.detail, document_ids, verifiedBytes, new Date().toISOString());
    if (packet.length > 19_000_000) return errorResponse("This packet is too large for one download. Select fewer documents and export separate parts.", 400);
    return new Response(new Blob([new Uint8Array(packet)]).stream(), { headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="benefits-${id}-r${expected_revision}.zip"`,
      "Content-Length": String(packet.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    if (error instanceof BenefitsPacketError) return errorResponse(error.message, 400);
    return errorResponse("Packet export could not be verified. Try again.", 503);
  }
}
