import type { CurrentApiActor } from '@/lib/auth/current-api-actor';
import type { Json } from '@/types/database';
import { InsuranceInputError } from './extraction';
import { InsuranceRpcError } from './workspace-server';
import type { ServicingAction } from './servicing-schema';
import type { ServicingExport } from './servicing-types';

// These JSON RPCs are added by the servicing migration, pending DB type generation.
type ServicingRpcClient = {
  rpc(name: 'insurance_servicing', args: {
    p_action: string;
    p_payload: Json;
  }): PromiseLike<{
    data: unknown;
    error: {
      message: string;
      code?: string;
    } | null;
  }>;
};
export async function servicingRpc<T>(actor: CurrentApiActor, action: ServicingAction, payload: unknown): Promise<T> {
  const {
    data,
    error
  } = await (actor.client as unknown as ServicingRpcClient).rpc('insurance_servicing', {
    p_action: action,
    p_payload: payload as Json
  });
  if (error) throw new InsuranceRpcError(error.message, error.code);
  return data as T;
}

/** The database supplies the immutable approved snapshot and records export access. */
export async function exportServicingPackage(actor: CurrentApiActor, id: string, version: number): Promise<Response> {
  const exported = await servicingRpc<ServicingExport>(actor, 'export', {
    id,
    version
  });
  if (!exported?.record || exported.record.id !== id || exported.record.organization_id !== actor.organizationId || exported.record.kind !== 'renewal_package' || exported.version !== version || exported.record.version !== version || !['approved', 'shared', 'acknowledged'].includes(exported.record.status)) {
    throw new InsuranceInputError('Approved package revision not found.', 404);
  }
  return new Response(JSON.stringify(exported, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="haven-renewal-package-${id}-v${version}.json"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}
