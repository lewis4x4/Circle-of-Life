import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type FamilyLinkedResidentSummary = {
  linkedResidents: number;
  residentSummary: string;
  residentNames: string[];
};

function residentDisplayName(row: {
  preferred_name: string | null;
  first_name: string | null;
  last_name: string | null;
}): string {
  return (
    row.preferred_name?.trim() ||
    [row.first_name, row.last_name].filter(Boolean).join(" ").trim() ||
    "Your loved one"
  );
}

export function summarizeFamilyResidentNames(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]} and others`;
}

export async function fetchFamilyLinkedResidentSummary(
  supabase: SupabaseClient<Database>,
): Promise<{ ok: true; data: FamilyLinkedResidentSummary } | { ok: false; error: string }> {
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr) return { ok: false, error: userErr.message };
  if (!user) return { ok: false, error: "Sign in to view family information." };

  const linksQ = await supabase
    .from("family_resident_links")
    .select("resident_id, residents!fk_frl_resident ( id, first_name, last_name, preferred_name )")
    .eq("user_id", user.id)
    .is("revoked_at", null);

  if (linksQ.error) return { ok: false, error: linksQ.error.message };

  const names: string[] = [];
  const seen = new Set<string>();

  for (const row of linksQ.data ?? []) {
    const linked = row as {
      resident_id: string;
      residents: {
        id: string;
        first_name: string | null;
        last_name: string | null;
        preferred_name: string | null;
      } | null;
    };
    if (seen.has(linked.resident_id)) continue;
    seen.add(linked.resident_id);
    names.push(linked.residents ? residentDisplayName(linked.residents) : "Your loved one");
  }

  names.sort((a, b) => a.localeCompare(b));

  return {
    ok: true,
    data: {
      linkedResidents: names.length,
      residentSummary: summarizeFamilyResidentNames(names),
      residentNames: names,
    },
  };
}
