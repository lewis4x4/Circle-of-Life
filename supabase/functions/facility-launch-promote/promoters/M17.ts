import type { ModulePromoter, ModuleValues, PromotionContext, PromotionResult } from "./_types.ts";
import {
  asRecord,
  asString,
  compactTables,
  insertPromotionLink,
  isMeaningful,
  mergeMetadata,
  moduleValueId,
  parseDateOrNull,
  tableCount,
  valuesDiffer,
} from "./_helpers.ts";

function documentEntries(values: ModuleValues): Array<{ fieldPath: string; doc: Record<string, unknown> }> {
  return Object.entries(values)
    .filter(([fieldPath, value]) => fieldPath.startsWith("documents.") && isMeaningful(value))
    .map(([fieldPath, value]) => ({ fieldPath, doc: asRecord(value) }))
    .filter(({ doc }) => asString(doc.artifactType ?? doc.artifact_type) && asString(doc.originalFilename ?? doc.original_filename ?? doc.title));
}

function artifactType(doc: Record<string, unknown>): string {
  return asString(doc.artifactType ?? doc.artifact_type) ?? "other";
}

function originalFilename(doc: Record<string, unknown>): string {
  return asString(doc.originalFilename ?? doc.original_filename ?? doc.title) ?? "document.pdf";
}

function facilityDocumentCategory(type: string): string {
  if (["gl_cert", "property_policy", "bond_certificate", "loss_run"].includes(type)) return "insurance_certificate";
  return "other";
}

function pendingFilePath(ctx: PromotionContext, filename: string): string {
  return `facility-launch-pending/${ctx.facility_id}/${filename.replace(/[^a-zA-Z0-9._-]+/g, "_")}`;
}

function payloadDiffers(existing: Record<string, unknown>, payload: Record<string, unknown>): boolean {
  return Object.entries(payload).some(([key, value]) => valuesDiffer(existing[key], value));
}

async function findDocument(
  ctx: PromotionContext,
  type: string,
  filename: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await ctx.admin
    .from("facility_documents")
    .select("*")
    .eq("facility_id", ctx.facility_id)
    .eq("organization_id", ctx.organization_id)
    .eq("artifact_type", type)
    .eq("original_filename", filename)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`M17 document lookup failed for ${type}/${filename}: ${error.message}`);
  return data as Record<string, unknown> | null;
}

export const M17_PROMOTER: ModulePromoter = {
  moduleCode: "M17",
  description: "Register source-of-truth Facility Launch documents in the facility document vault.",
  prerequisites: ["facility"],
  canPromote(values: ModuleValues) {
    const ready = documentEntries(values).length > 0 || isMeaningful(values.reviewNotes);
    return { ready, missing: ready ? [] : ["documents"] };
  },
  async promote(ctx: PromotionContext, values: ModuleValues): Promise<PromotionResult> {
    const warnings: string[] = [];
    const errors: string[] = [];
    const docs = documentEntries(values);

    let facilitiesUpdated = 0;
    let facilitiesNoop = 0;
    if (isMeaningful(values.reviewNotes)) {
      const { data: facility, error: facilityError } = await ctx.admin
        .from("facilities")
        .select("id, launch_profile_metadata")
        .eq("id", ctx.facility_id)
        .eq("organization_id", ctx.organization_id)
        .is("deleted_at", null)
        .maybeSingle();
      if (facilityError) throw new Error(`M17 facility metadata read failed: ${facilityError.message}`);
      if (facility) {
        const beforeMetadata = mergeMetadata((facility as Record<string, unknown>).launch_profile_metadata, {});
        const afterMetadata = mergeMetadata(beforeMetadata, { m17_review_notes: values.reviewNotes });
        if (valuesDiffer(beforeMetadata, afterMetadata)) {
          facilitiesUpdated = 1;
          if (!ctx.dry_run) {
            const { error } = await ctx.admin.from("facilities").update({
              launch_profile_metadata: afterMetadata,
              updated_by: ctx.actor_user_id,
            }).eq("id", ctx.facility_id).eq("organization_id", ctx.organization_id);
            if (error) throw new Error(`M17 review notes update failed: ${error.message}`);
            await insertPromotionLink(ctx, {
              target_table: "facilities",
              target_row_id: ctx.facility_id,
              action: "update",
              before_value: { launch_profile_metadata: beforeMetadata },
              after_value: { launch_profile_metadata: afterMetadata },
              module_value_id: moduleValueId(ctx, "reviewNotes"),
            });
          }
        } else {
          facilitiesNoop = 1;
        }
      }
    }

    if (docs.length === 0) {
      return {
        module_code: "M17",
        status: facilitiesUpdated > 0 ? "partial" : "skipped",
        summary: "no document metadata in intake yet — run import first",
        tables_touched: compactTables([
          tableCount("facilities", 0, facilitiesUpdated, facilitiesNoop),
          tableCount("facility_documents"),
        ]),
        warnings,
        errors,
        prerequisites_unmet: ["documents"] ,
      };
    }

    let docsCreated = 0;
    let docsUpdated = 0;
    let docsNoop = 0;
    for (const { fieldPath, doc } of docs) {
      const type = artifactType(doc);
      const filename = originalFilename(doc);
      const effectiveDate = parseDateOrNull(doc.effectiveDate ?? doc.effective_date);
      const expirationDate = parseDateOrNull(doc.expirationDate ?? doc.expiration_date);
      if (effectiveDate.warning) warnings.push(`${filename} effective_date ${effectiveDate.warning}`);
      if (expirationDate.warning) warnings.push(`${filename} expiration_date ${expirationDate.warning}`);

      const payload = {
        facility_id: ctx.facility_id,
        organization_id: ctx.organization_id,
        document_category: facilityDocumentCategory(type),
        document_name: asString(doc.title) ?? filename,
        file_path: pendingFilePath(ctx, filename),
        mime_type: "application/pdf",
        expiration_date: expirationDate.date,
        notes: asString(doc.notes),
        uploaded_by: ctx.actor_user_id,
        updated_by: ctx.actor_user_id,
        artifact_type: type,
        original_filename: filename,
        title: asString(doc.title) ?? filename,
        entity_association: asString(doc.entityAssociation ?? doc.entity_association),
        effective_date: effectiveDate.date,
        term: asString(doc.term),
        version: asString(doc.version),
        is_source_of_truth: doc.isSourceOfTruth === true || doc.is_source_of_truth === true,
        custodian_approval_status: asString(doc.custodianApprovalStatus ?? doc.custodian_approval_status),
        confidence: asString(doc.confidence),
        document_id: null,
        pending_upload: true,
      };

      const existing = await findDocument(ctx, type, filename);
      if (!existing) {
        if (ctx.dry_run) {
          docsCreated += 1;
        } else {
          const { data, error } = await ctx.admin.from("facility_documents").insert(payload).select("id").single();
          if (error || !data?.id) throw new Error(`M17 facility_document insert failed for ${filename}: ${error?.message ?? "missing id"}`);
          docsCreated += 1;
          await insertPromotionLink(ctx, {
            target_table: "facility_documents",
            target_row_id: String(data.id),
            action: "insert",
            before_value: null,
            after_value: payload,
            module_value_id: moduleValueId(ctx, fieldPath),
          });
        }
      } else {
        const isLaunchPending = existing.pending_upload === true && (existing.document_id === null || existing.document_id === undefined);
        if (!isLaunchPending) {
          warnings.push(`facility document '${filename}' already has an uploaded document; launch metadata was skipped to avoid downgrading the vault row.`);
          docsNoop += 1;
          continue;
        }

        const updatePayload = {
          document_category: payload.document_category,
          document_name: payload.document_name,
          mime_type: payload.mime_type,
          expiration_date: payload.expiration_date,
          notes: payload.notes,
          updated_by: payload.updated_by,
          artifact_type: payload.artifact_type,
          original_filename: payload.original_filename,
          title: payload.title,
          entity_association: payload.entity_association,
          effective_date: payload.effective_date,
          term: payload.term,
          version: payload.version,
          is_source_of_truth: payload.is_source_of_truth,
          custodian_approval_status: payload.custodian_approval_status,
          confidence: payload.confidence,
        };
        if (payloadDiffers(existing, updatePayload)) {
          docsUpdated += 1;
          if (!ctx.dry_run) {
            const { error } = await ctx.admin.from("facility_documents").update(updatePayload).eq("id", existing.id);
            if (error) throw new Error(`M17 facility_document update failed for ${filename}: ${error.message}`);
            await insertPromotionLink(ctx, {
              target_table: "facility_documents",
              target_row_id: String(existing.id),
              action: "update",
              before_value: existing,
              after_value: updatePayload,
              module_value_id: moduleValueId(ctx, fieldPath),
            });
          }
        } else {
          docsNoop += 1;
        }
      }
    }

    const writes = docsCreated + docsUpdated + facilitiesUpdated;
    return {
      module_code: "M17",
      status: "promoted",
      summary: writes > 0 ? `Registered ${docsCreated + docsUpdated} facility document(s).` : "Facility documents already current.",
      tables_touched: compactTables([
        tableCount("facilities", 0, facilitiesUpdated, facilitiesNoop),
        tableCount("facility_documents", docsCreated, docsUpdated, docsNoop),
      ]),
      warnings,
      errors,
      prerequisites_unmet: [],
    };
  },
};
