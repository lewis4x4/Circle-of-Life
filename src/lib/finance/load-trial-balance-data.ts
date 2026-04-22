import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

export type EntityMini = { id: string; name: string };

export type TrialBalanceRow = {
  gl_account_id: string;
  code: string;
  name: string;
  account_type: string;
  total_debits: number;
  total_credits: number;
  net: number;
};

export async function loadFinanceEntities(
  supabase: SupabaseClient<Database>,
  organizationId: string,
): Promise<EntityMini[]> {
  const { data, error } = await supabase
    .from("entities")
    .select("id, name")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .order("name");

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as EntityMini[];
}

export async function loadTrialBalanceData(
  supabase: SupabaseClient<Database>,
  entityId: string,
  dateFrom: string,
  dateTo: string,
): Promise<TrialBalanceRow[]> {
  const { data: posted, error: postedError } = await supabase
    .from("journal_entries")
    .select("id")
    .eq("entity_id", entityId)
    .eq("status", "posted")
    .gte("entry_date", dateFrom)
    .lte("entry_date", dateTo)
    .is("deleted_at", null);

  if (postedError) {
    throw new Error(postedError.message);
  }

  const journalEntryIds = (posted ?? []).map((row) => (row as { id: string }).id);
  if (journalEntryIds.length === 0) {
    return [];
  }

  const { data: lines, error: linesError } = await supabase
    .from("journal_entry_lines")
    .select("gl_account_id, debit_cents, credit_cents")
    .in("journal_entry_id", journalEntryIds)
    .is("deleted_at", null);

  if (linesError) {
    throw new Error(linesError.message);
  }

  const accountIds = [
    ...new Set((lines ?? []).map((line) => (line as { gl_account_id: string }).gl_account_id)),
  ];
  if (accountIds.length === 0) {
    return [];
  }

  const { data: accounts, error: accountsError } = await supabase
    .from("gl_accounts")
    .select("id, code, name, account_type")
    .in("id", accountIds);

  if (accountsError) {
    throw new Error(accountsError.message);
  }

  const accountMap = new Map(
    (accounts ?? []).map((row) => {
      const account = row as { id: string; code: string; name: string; account_type: string };
      return [account.id, account];
    }),
  );

  const aggregates = new Map<string, { debits: number; credits: number }>();
  for (const rawLine of lines ?? []) {
    const line = rawLine as { gl_account_id: string; debit_cents: number; credit_cents: number };
    const entry = aggregates.get(line.gl_account_id) ?? { debits: 0, credits: 0 };
    entry.debits += line.debit_cents;
    entry.credits += line.credit_cents;
    aggregates.set(line.gl_account_id, entry);
  }

  const rows: TrialBalanceRow[] = [];
  for (const [accountId, totals] of aggregates) {
    const account = accountMap.get(accountId);
    if (!account) continue;
    rows.push({
      gl_account_id: accountId,
      code: account.code,
      name: account.name,
      account_type: account.account_type,
      total_debits: totals.debits,
      total_credits: totals.credits,
      net: totals.debits - totals.credits,
    });
  }

  rows.sort((left, right) => left.code.localeCompare(right.code));
  return rows;
}
