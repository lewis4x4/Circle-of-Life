import { requireCurrentApiActor } from '@/lib/auth/current-api-actor';
import { InsuranceInputError, readBoundedBody } from '@/lib/insurance/extraction';
import { parseServicingCommand } from '@/lib/insurance/servicing-schema';
import { servicingRpc } from '@/lib/insurance/servicing-server';
import { MANAGER_ROLES, insuranceError, noStoreJson, withNoStore } from '@/lib/insurance/workspace-server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const result = await requireCurrentApiActor({
    allowedRoles: MANAGER_ROLES,
    scope: 'insurance.servicing.list'
  });
  if ('response' in result) return withNoStore(result.response);
  try {
    const command = parseServicingCommand({
      action: 'list',
      payload: Object.fromEntries(new URL(request.url).searchParams)
    });
    return noStoreJson(await servicingRpc(result.actor, command.action, command.payload));
  } catch (error) {
    return insuranceError(error);
  }
}
export async function POST(request: Request) {
  const result = await requireCurrentApiActor({
    allowedRoles: MANAGER_ROLES,
    scope: 'insurance.servicing.command'
  });
  if ('response' in result) return withNoStore(result.response);
  try {
    if (Number(request.headers.get('content-length') ?? 0) > 1024 * 1024) throw new InsuranceInputError('Request exceeds 1 MiB.');
    const text = new TextDecoder().decode(await readBoundedBody(request.body, 1024 * 1024));
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new InsuranceInputError('Invalid JSON.');
    }
    const command = parseServicingCommand(raw);
    if (command.action === 'list' || command.action === 'export') throw new InsuranceInputError('Use the dedicated list or export endpoint.');
    return noStoreJson(await servicingRpc(result.actor, command.action, command.payload));
  } catch (error) {
    return insuranceError(error);
  }
}
