import PostingRulesPageClient from "@/components/finance/PostingRulesPageClient";
import { canMutateFinance } from "@/lib/finance/load-finance-context";
import { loadFinanceRoleContextServer } from "@/lib/finance/load-finance-context.server";
import { loadPostingRulesData, type GlMini, type RuleRow } from "@/lib/finance/load-posting-rules-data";
import { loadFinanceEntities, type EntityMini } from "@/lib/finance/load-trial-balance-data";
import { createClient } from "@/lib/supabase/server";

export default async function GlPostingRulesPage() {
  const roleContext = await loadFinanceRoleContextServer();

  if (!roleContext.ok) {
    return (
      <PostingRulesPageClient
        initialEntities={[]}
        initialEntityId=""
        initialAccounts={[]}
        initialRules={[]}
        initialOrgId={null}
        initialCanMutate={false}
        initialError={roleContext.error}
        initialReady={false}
      />
    );
  }

  const supabase = await createClient();
  const initialOrgId = roleContext.ctx.organizationId;
  const initialCanMutate = canMutateFinance(roleContext.ctx.appRole);

  let initialEntities: EntityMini[] = [];
  let initialEntityId = "";
  let initialAccounts: GlMini[] = [];
  let initialRules: RuleRow[] = [];
  let initialError: string | null = null;

  try {
    initialEntities = await loadFinanceEntities(supabase, initialOrgId);
    initialEntityId = initialEntities[0]?.id ?? "";
    if (initialCanMutate && initialEntityId) {
      const snapshot = await loadPostingRulesData(supabase, initialOrgId, initialEntityId);
      initialAccounts = snapshot.accounts;
      initialRules = snapshot.rules;
    }
  } catch (error) {
    initialError = error instanceof Error ? error.message : "Failed to load posting rules.";
  }

  return (
    <PostingRulesPageClient
      initialEntities={initialEntities}
      initialEntityId={initialEntityId}
      initialAccounts={initialAccounts}
      initialRules={initialRules}
      initialOrgId={initialOrgId}
      initialCanMutate={initialCanMutate}
      initialError={initialError}
      initialReady
    />
  );
}
