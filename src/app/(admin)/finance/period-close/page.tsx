import FinancePeriodClosePageClient from "@/components/finance/FinancePeriodClosePageClient";
import { canMutateFinance } from "@/lib/finance/load-finance-context";
import { loadFinanceRoleContextServer } from "@/lib/finance/load-finance-context.server";
import { loadPeriodCloseData, type PeriodRow } from "@/lib/finance/load-period-close-data";
import { loadFinanceEntities, type EntityMini } from "@/lib/finance/load-trial-balance-data";
import { createClient } from "@/lib/supabase/server";

function currentYearMonth(): { y: number; m: number } {
  const d = new Date();
  return { y: d.getFullYear(), m: d.getMonth() + 1 };
}

export default async function FinancePeriodClosePage() {
  const roleContext = await loadFinanceRoleContextServer();
  const { y: initialPeriodYear, m: initialPeriodMonth } = currentYearMonth();

  if (!roleContext.ok) {
    return (
      <FinancePeriodClosePageClient
        initialEntities={[]}
        initialEntityId=""
        initialPeriodYear={initialPeriodYear}
        initialPeriodMonth={initialPeriodMonth}
        initialHistory={[]}
        initialSelectedPeriod={null}
        initialImplicitOpen={true}
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
  let initialHistory: PeriodRow[] = [];
  let initialSelectedPeriod: PeriodRow | null = null;
  let initialImplicitOpen = true;
  let initialError: string | null = null;

  try {
    initialEntities = await loadFinanceEntities(supabase, initialOrgId);
    initialEntityId = initialEntities[0]?.id ?? "";
    if (initialEntityId) {
      const snapshot = await loadPeriodCloseData(
        supabase,
        initialOrgId,
        initialEntityId,
        initialPeriodYear,
        initialPeriodMonth,
      );
      initialHistory = snapshot.history;
      initialSelectedPeriod = snapshot.selectedPeriod;
      initialImplicitOpen = snapshot.implicitOpen;
    }
  } catch (error) {
    initialError = error instanceof Error ? error.message : "Failed to load period close data.";
  }

  return (
    <FinancePeriodClosePageClient
      initialEntities={initialEntities}
      initialEntityId={initialEntityId}
      initialPeriodYear={initialPeriodYear}
      initialPeriodMonth={initialPeriodMonth}
      initialHistory={initialHistory}
      initialSelectedPeriod={initialSelectedPeriod}
      initialImplicitOpen={initialImplicitOpen}
      initialOrgId={initialOrgId}
      initialCanMutate={initialCanMutate}
      initialError={initialError}
      initialReady
    />
  );
}
