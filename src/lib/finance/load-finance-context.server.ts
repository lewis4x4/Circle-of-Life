import { getServerAuthContext } from "@/lib/auth/server-context";
import type { FinanceRoleContext } from "@/lib/finance/load-finance-context";

export async function loadFinanceRoleContextServer():
  Promise<{ ok: true; ctx: FinanceRoleContext } | { ok: false; error: string }> {
  const auth = await getServerAuthContext();
  if (!auth.ok) return auth;

  return {
    ok: true,
    ctx: {
      organizationId: auth.ctx.organizationId,
      appRole: auth.ctx.appRole,
    },
  };
}
