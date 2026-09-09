import { randomUUID } from 'node:crypto';
import { requireCurrentApiActor, revalidateCurrentApiActor } from '@/lib/auth/current-api-actor';
import { extractDocument, inspectDocument, InsuranceInputError } from '@/lib/insurance/extraction';
import { idSchema } from '@/lib/insurance/workspace-schema';
import { INSURANCE_BUCKET, MANAGER_ROLES, insuranceError, withNoStore, noStoreJson, processingRpc, workspaceRpc } from '@/lib/insurance/workspace-server';
import type { ExtractionMetadata, InsuranceDocument } from '@/lib/insurance/workspace-types';
export const runtime = 'nodejs';
export const maxDuration = 60;

function configuredExtractionMetadata(family: string): ExtractionMetadata {
  const automaticFamily = ['policy', 'declarations'].includes(family);
  const adapter = process.env.INSURANCE_EXTRACTOR_URL?.trim();
  const provider = !automaticFamily ? 'manual' : adapter ? 'restricted_adapter'
    : process.env.INSURANCE_OPENAI_ENABLED === 'true' ? 'openai' : 'manual';
  return {
    schema_version: 1,
    extractor_version: 'haven-insurance-v1',
    provider,
    configured_model: provider === 'openai' ? process.env.INSURANCE_OPENAI_MODEL?.trim() || null : null,
  };
}

export async function POST(_request: Request, context: {
  params: Promise<{
    id: string;
  }>;
}) {
  const result = await requireCurrentApiActor({ allowedRoles: MANAGER_ROLES, scope: 'insurance.extract' });
  if ('response' in result)
    return withNoStore(result.response);
  let run_id: string | undefined;
  let document: InsuranceDocument | undefined;
  let extraction_metadata: ExtractionMetadata | undefined;
  try {
    const id = idSchema.parse((await context.params).id);
    document = await workspaceRpc<InsuranceDocument>(result.actor, 'get_document', { id });
    if (document.organization_id !== result.actor.organizationId || document.storage_path !== `${result.actor.organizationId}/${id}`)
      throw new InsuranceInputError('Document not found.', 404);
    if (document.status !== 'ready' || !['clean', 'not_configured'].includes(document.scan_status))
      throw new InsuranceInputError('This original has not cleared document processing.', 409);
    extraction_metadata = configuredExtractionMetadata(document.family);
    const token = randomUUID();
    document = await processingRpc<InsuranceDocument>(result.actor, 'start_extraction', { document_id: id, run_id: token });
    run_id = token;
    const stored = await result.actor.admin.storage.from(INSURANCE_BUCKET).download(document.storage_path);
    if (stored.error || !stored.data)
      throw new Error('Original unavailable.');
    const bytes = new Uint8Array(await stored.data.arrayBuffer());
    if (inspectDocument(bytes, document.filename, document.mime_type).sha256 !== document.sha256)
      throw new Error('Original checksum mismatch.');
    const current = await revalidateCurrentApiActor(result.actor, { allowedRoles: MANAGER_ROLES, scope: 'insurance.extract.provider' });
    if ('response' in current)
      return withNoStore(current.response);
    if (current.actor.organizationId !== document.organization_id)
      throw new InsuranceInputError('Document not found.', 404);
    const suggestion = await extractDocument(document, bytes);
    document = await processingRpc<InsuranceDocument>(current.actor, 'finish_extraction', {
      document_id: id, run_id, status: suggestion ? 'review_required' : 'manual_review', ...(suggestion ?? {}), extraction_metadata
    });
    return noStoreJson({ document });
  }
  catch (error) {
    if (run_id && document) {
      try {
        await processingRpc(result.actor, 'finish_extraction', {
          document_id: document.id, run_id, status: 'failed', error: 'Extraction failed. Retry or enter the facts manually.', extraction_metadata
        });
      }
      catch { /* A revoked actor or superseded run cannot finalize this lease. */
      }
    }
    return insuranceError(error);
  }
}
