import { getServerAuthContext } from "@/lib/auth/server-context";
import type { RiskRoleContext } from "@/lib/risk/load-risk-context";

export async function loadRiskRoleContextServer():
  Promise<{ ok: true; ctx: RiskRoleContext } | { ok: false; error: string }> {
  const auth = await getServerAuthContext();
  if (!auth.ok) return auth;

  return {
    ok: true,
    ctx: {
      userId: auth.ctx.userId,
      organizationId: auth.ctx.organizationId,
      appRole: auth.ctx.appRole,
    },
  };
}
