import { requireCurrentApiActor } from '@/lib/auth/current-api-actor';
import { parseServicingCommand } from '@/lib/insurance/servicing-schema';
import { exportServicingPackage } from '@/lib/insurance/servicing-server';
import { MANAGER_ROLES, insuranceError, withNoStore } from '@/lib/insurance/workspace-server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: {
  params: Promise<{
    id: string;
  }>;
}) {
  const result = await requireCurrentApiActor({
    allowedRoles: MANAGER_ROLES,
    scope: 'insurance.servicing.export'
  });
  if ('response' in result) return withNoStore(result.response);
  try {
    const {
      id
    } = await context.params;
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const command = parseServicingCommand({
      action: 'export',
      payload: {
        ...params,
        id,
        version: Number(params.version)
      }
    });
    const payload = command.payload as {
      id: string;
      version: number;
    };
    return await exportServicingPackage(result.actor, payload.id, payload.version);
  } catch (error) {
    return insuranceError(error);
  }
}
