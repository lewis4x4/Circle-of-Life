"use client";

import { useHavenAuth } from "@/contexts/haven-auth-context";

export const HELP_DOCS_HREF = "/admin/knowledge";

export function useOrganizationName(_organizationId: string | null): string | null {
  void _organizationId;
  return useHavenAuth().orgName;
}
