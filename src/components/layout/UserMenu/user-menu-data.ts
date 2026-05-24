"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export const HELP_DOCS_HREF = "/admin/knowledge";

export function useOrganizationName(organizationId: string | null): string | null {
  const supabase = useMemo(() => createClient(), []);
  const [orgName, setOrgName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadOrganizationName() {
      if (!organizationId) {
        setOrgName(null);
        return;
      }

      const { data, error } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", organizationId)
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        console.warn("[UserMenu] organization lookup failed", error);
        setOrgName(null);
        return;
      }

      setOrgName(data?.name ?? null);
    }

    void loadOrganizationName();

    return () => {
      cancelled = true;
    };
  }, [organizationId, supabase]);

  return orgName;
}
