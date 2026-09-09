import { randomUUID } from "node:crypto";
import {
  requireCurrentApiActor,
  revalidateCurrentApiActor,
} from "@/lib/auth/current-api-actor";
import {
  inspectDocument,
  InsuranceInputError,
  MAX_DOCUMENT_BYTES,
  readBoundedBody,
  scanDocument,
} from "@/lib/insurance/extraction";
import { uploadMetadataSchema } from "@/lib/insurance/workspace-schema";
import {
  INSURANCE_BUCKET,
  MANAGER_ROLES,
  insuranceError,
  withNoStore,
  noStoreJson,
  processingRpc,
} from "@/lib/insurance/workspace-server";
import type { InsuranceDocument } from "@/lib/insurance/workspace-types";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const result = await requireCurrentApiActor({
    allowedRoles: MANAGER_ROLES,
    scope: "insurance.upload",
  });
  if ("response" in result) return withNoStore(result.response);
  try {
    if (
      Number(request.headers.get("content-length") ?? 0) >
      MAX_DOCUMENT_BYTES + 65536
    )
      throw new InsuranceInputError("Choose a file up to 4 MiB.");
    const body = await readBoundedBody(
      request.body,
      MAX_DOCUMENT_BYTES + 65536,
    );
    const form = await new Response(Buffer.from(body), {
      headers: { "Content-Type": request.headers.get("content-type") ?? "" },
    }).formData();
    const file = form.get("file");
    if (
      !file ||
      typeof file === "string" ||
      typeof file.arrayBuffer !== "function"
    )
      throw new InsuranceInputError("A document file is required.");
    if (file.size > MAX_DOCUMENT_BYTES)
      throw new InsuranceInputError("Choose a file up to 4 MiB.");
    const metadata = uploadMetadataSchema.parse({
      family: form.get("family"),
      ...(form.get("facility_id")
        ? { facility_id: form.get("facility_id") }
        : {}),
    });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const inspected = inspectDocument(bytes, file.name, file.type);
    let document = await processingRpc<InsuranceDocument>(
      result.actor,
      "register_document",
      {
        id: randomUUID(),
        filename: file.name.replace(/[\x00-\x1f\x7f/\\]/g, "_").slice(0, 240),
        ...metadata,
        ...inspected,
      },
    );
    if (document.status === "ready") return noStoreJson({ document });
    // The database generates this path. It must remain inside the current organization.
    if (
      document.storage_path !== `${result.actor.organizationId}/${document.id}`
    )
      throw new InsuranceInputError("Invalid document storage scope.", 500);
    if (document.status === "uploading" || document.status === "failed") {
      const { error } = await result.actor.admin.storage
        .from(INSURANCE_BUCKET)
        .upload(document.storage_path, bytes, {
          contentType: inspected.mime_type,
          upsert: false,
        });
      if (error) {
        // An interrupted previous upload may have stored identical bytes before finalization.
        const existing = await result.actor.admin.storage
          .from(INSURANCE_BUCKET)
          .download(document.storage_path);
        if (
          existing.error ||
          !existing.data ||
          inspectDocument(
            new Uint8Array(await existing.data.arrayBuffer()),
            file.name,
            file.type,
          ).sha256 !== inspected.sha256
        ) {
          await processingRpc(result.actor, "finish_document", {
            id: document.id,
            status: "failed",
            scan_status: "failed",
            error: "Storage upload failed. Retry the original file.",
          });
          throw new InsuranceInputError(
            "Document upload failed. Retry the original file.",
            503,
          );
        }
      }
    }
    try {
      const current = await revalidateCurrentApiActor(result.actor, {
        allowedRoles: MANAGER_ROLES,
        scope: "insurance.upload.scanner",
      });
      if ("response" in current) return withNoStore(current.response);
      if (current.actor.organizationId !== document.organization_id)
        throw new InsuranceInputError("Document not found.", 404);
      const scan_status = await scanDocument(bytes, inspected.mime_type);
      document = await processingRpc<InsuranceDocument>(
        result.actor,
        "finish_document",
        {
          id: document.id,
          status: "ready",
          scan_status,
        },
      );
    } catch (error) {
      await processingRpc(result.actor, "finish_document", {
        id: document.id,
        status: "quarantined",
        scan_status: "failed",
        error:
          "Document scanning or finalization failed. Reupload the same file to retry.",
      });
      throw error;
    }
    return noStoreJson({ document }, 201);
  } catch (error) {
    return insuranceError(error);
  }
}
