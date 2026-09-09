import { requireCurrentApiActor } from '@/lib/auth/current-api-actor';
import { parseWorkspaceCommand } from '@/lib/insurance/workspace-schema';
import { insuranceError, withNoStore, noStoreJson, workspaceRpc } from '@/lib/insurance/workspace-server';
import { InsuranceInputError, readBoundedBody } from '@/lib/insurance/extraction';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const result = await requireCurrentApiActor({ allowedRoles: ['owner', 'org_admin', 'facility_admin'], scope: 'insurance.workspace' });
  if ('response' in result)
    return withNoStore(result.response);
  try {
    const params = new URL(request.url).searchParams;
    const command = parseWorkspaceCommand({ action: 'overview', payload: Object.fromEntries(params) });
    return noStoreJson(await workspaceRpc(result.actor, command.action, command.payload));
  }
  catch (error) {
    return insuranceError(error);
  }
}
export async function POST(request: Request) {
  const result = await requireCurrentApiActor({ allowedRoles: ['owner', 'org_admin', 'facility_admin'], scope: 'insurance.workspace' });
  if ('response' in result)
    return withNoStore(result.response);
  try {
    if (Number(request.headers.get('content-length') ?? 0) > 1024 * 1024)
      throw new InsuranceInputError('Request exceeds 1 MiB.');
    const body = new TextDecoder().decode(await readBoundedBody(request.body, 1024 * 1024));
    let raw: unknown;
    try {
      raw = JSON.parse(body);
    }
    catch {
      throw new InsuranceInputError('Invalid JSON.');
    }
    const command = parseWorkspaceCommand(raw);
    return noStoreJson(await workspaceRpc(result.actor, command.action, command.payload));
  }
  catch (error) {
    return insuranceError(error);
  }
}
