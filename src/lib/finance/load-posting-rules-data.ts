import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

export type GlMini = { id: string; code: string; name: string };
export type RuleRow = Database["public"]["Tables"]["gl_posting_rules"]["Row"];

export type PostingRulesSnapshot = {
  accounts: GlMini[];
  rules: RuleRow[];
};

export async function loadPostingRulesData(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  entityId: string,
): Promise<PostingRulesSnapshot> {
  const [{ data: rules, error: rulesError }, { data: accounts, error: accountsError }] =
    await Promise.all([
      supabase
        .from("gl_posting_rules")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("entity_id", entityId)
        .is("deleted_at", null)
        .order("event_type"),
      supabase
        .from("gl_accounts")
        .select("id, code, name")
        .eq("entity_id", entityId)
        .is("deleted_at", null)
        .order("code"),
    ]);

  if (rulesError) {
    throw new Error(rulesError.message);
  }
  if (accountsError) {
    throw new Error(accountsError.message);
  }

  return {
    accounts: (accounts ?? []) as GlMini[],
    rules: (rules ?? []) as RuleRow[],
  };
}
