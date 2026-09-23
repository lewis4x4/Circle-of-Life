"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";

import { useHavenAuth } from "@/contexts/haven-auth-context";
import { todayFacilityDateIso } from "@/lib/facility-wall-clock";
import {
  COVERAGE_LAPSE_SELECT,
  INSURANCE_POLICY_TYPE_LABEL,
  findLapsedWithoutSuccessor,
  type LapsePolicyInput,
  type LapsedPolicy,
} from "@/lib/insurance/coverage-lapse";
import { formatInsurancePolicyExpirationDate } from "@/lib/insurance/policies-display-copy";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

type PolicyType = Database["public"]["Enums"]["insurance_policy_type"];

/**
 * Names every policy that lapsed with no successor in force (COL-649).
 * Renders nothing while loading or when there is no lapse; a failed read says
 * the check could not run rather than staying silent.
 */
export function CoverageLapseBanner({ policyType }: { policyType?: PolicyType }) {
  const supabase = createClient();
  const { organizationId } = useHavenAuth();

  const { data, error, isPending } = useQuery({
    queryKey: ["insurance", "coverage-lapse", organizationId],
    enabled: !!organizationId,
    queryFn: async (): Promise<LapsedPolicy[]> => {
      const oid = organizationId as string;
      const [policies, entities] = await Promise.all([
        supabase
          .from("insurance_policies")
          .select(COVERAGE_LAPSE_SELECT)
          .eq("organization_id", oid)
          .is("deleted_at", null),
        supabase.from("entities").select("id, name").eq("organization_id", oid).is("deleted_at", null),
      ]);
      if (policies.error) throw new Error(policies.error.message);
      const names = new Map((entities.data ?? []).map((e) => [e.id as string, e.name as string]));
      return findLapsedWithoutSuccessor((policies.data ?? []) as LapsePolicyInput[], todayFacilityDateIso(), names);
    },
  });

  if (!organizationId || isPending) return null;

  if (error) {
    return (
      <p role="status" className="rounded-md border border-warning/40 bg-warning/5 px-4 py-3 text-sm text-foreground">
        Coverage lapses could not be checked, so this page is not confirming that every policy is in force.
      </p>
    );
  }

  const lapsed = (data ?? []).filter((p) => !policyType || p.policy_type === policyType);
  if (lapsed.length === 0) return null;

  return (
    <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
      <p className="flex items-center gap-2 font-semibold text-destructive">
        <AlertTriangle className="h-4 w-4" aria-hidden />
        {lapsed.length === 1
          ? "1 policy lapsed with no successor on file"
          : `${lapsed.length} policies lapsed with no successor on file`}
      </p>
      <ul className="mt-2 space-y-1 text-foreground">
        {lapsed.map((p) => (
          <li key={p.id}>
            <Link href={`/admin/insurance/policies/${p.id}`} className="underline-offset-2 hover:underline">
              {INSURANCE_POLICY_TYPE_LABEL[p.policy_type]} · {p.entity_name ?? "Entity not on file"} · {p.carrier_name}{" "}
              {p.policy_number} — ended {formatInsurancePolicyExpirationDate(p.expiration_date)}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
