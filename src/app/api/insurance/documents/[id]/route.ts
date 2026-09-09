import { requireCurrentApiActor, revalidateCurrentApiActor } from '@/lib/auth/current-api-actor';
import { idSchema } from '@/lib/insurance/workspace-schema';
import { INSURANCE_BUCKET, MANAGER_ROLES, insuranceError, withNoStore, workspaceRpc } from '@/lib/insurance/workspace-server';
import { InsuranceInputError } from '@/lib/insurance/extraction';
import type { InsuranceDocument } from '@/lib/insurance/workspace-types';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, context: {
  params: Promise<{
    id: string;
  }>;
}) {
  const result = await requireCurrentApiActor({ allowedRoles: MANAGER_ROLES, scope: 'insurance.original' });
  if ('response' in result)
    return withNoStore(result.response);
  try {
    const id = idSchema.parse((await context.params).id);
    const document = await workspaceRpc<InsuranceDocument>(result.actor, 'get_document', { id });
    if (document.organization_id !== result.actor.organizationId || document.storage_path !== `${result.actor.organizationId}/${id}`)
      throw new InsuranceInputError('Document not found.', 404);
    if (document.status !== 'ready' || !['clean', 'not_configured'].includes(document.scan_status))
      throw new InsuranceInputError('This original has not cleared document processing.', 409);
    const stored = await result.actor.admin.storage.from(INSURANCE_BUCKET).download(document.storage_path);
    if (stored.error || !stored.data)
      throw new InsuranceInputError('Original is temporarily unavailable.', 503);
    const current = await revalidateCurrentApiActor(result.actor, { allowedRoles: MANAGER_ROLES, scope: 'insurance.original.stream' });
    if ('response' in current)
      return withNoStore(current.response);
    if (current.actor.organizationId !== document.organization_id)
      throw new InsuranceInputError('Document not found.', 404);
    return new Response(stored.data.stream(), {
      headers: {
        'Content-Type': document.mime_type, 'Content-Length': String(stored.data.size), 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(document.filename)}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'; frame-ancestors 'self'"
      }
    });
  }
  catch (error) {
    return insuranceError(error);
  }
}
