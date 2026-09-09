"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { createClient } from "@/lib/supabase/client";
import { InsuranceHubNav } from "@/app/(admin)/insurance/insurance-hub-nav";
import { LegacyInsuranceGuard, ServicingContextLink } from "./servicing-client";
import { moneyLabel, panelClass } from "./workspace-client";
import type { Database } from "@/types/database";
import type { RenewalPackagePayload } from "@/lib/insurance/assemble-renewal-package-payload";
type LegacyPackage =
  Database["public"]["Tables"]["renewal_data_packages"]["Row"];
export function LegacyRenewalPackagesPage() {
  return (
    <LegacyInsuranceGuard>
      <LegacyPackages />
    </LegacyInsuranceGuard>
  );
}
export function LegacyRenewalPackageDetailPage() {
  return (
    <LegacyInsuranceGuard>
      <LegacyPackages detail />
    </LegacyInsuranceGuard>
  );
}
function LegacyPackages({ detail = false }: { detail?: boolean }) {
  const { organizationId } = useHavenAuth();
  const params = useParams();
  const id = detail ? String(params.id || "") : null;
  const query = useQuery({
    queryKey: ["insurance", "legacy-package-archive", organizationId, id],
    enabled: !!organizationId,
    queryFn: async () => {
      let builder = createClient()
        .from("renewal_data_packages")
        .select("*")
        .eq("organization_id", organizationId!)
        .is("deleted_at", null)
        .order("generated_at", { ascending: false });
      if (id) builder = builder.eq("id", id);
      const result = await builder;
      if (result.error) throw new Error(result.error.message);
      return result.data as LegacyPackage[];
    },
  });
  return (
    <div className="space-y-6">
      <InsuranceHubNav />
      <h1 className="text-2xl font-semibold">Legacy renewal package archive</h1>
      <ServicingContextLink kind="renewal_package" />
      <p className={panelClass}>
        These historical packages are read-only in this interface. They do not
        have the immutable approval and version guarantees of the reviewed
        servicing workspace. Prepare new packages in that workspace.
      </p>
      {query.isPending ? (
        <p role="status">Loading legacy packages…</p>
      ) : query.error ? (
        <p role="alert">{query.error.message}</p>
      ) : !query.data?.length ? (
        <p>No archived package in the current scope.</p>
      ) : (
        query.data.map((row) => (
          <section className={panelClass} key={row.id}>
            {!detail ? (
              <>
                <Link
                  className="text-primary underline"
                  href={`/admin/insurance/renewal-packages/${row.id}`}
                >
                  Archived package ·{" "}
                  {new Date(row.generated_at).toLocaleDateString("en-US", {
                    timeZone: "America/New_York",
                  })}
                </Link>
                <p className="text-sm">
                  Historical review stamp: {row.narrative_reviewed_at || "none"}
                </p>
              </>
            ) : (
              <>
                <h2 className="text-lg font-semibold">Archived narrative</h2>
                <p className="whitespace-pre-wrap text-sm">
                  {row.ai_narrative_draft ||
                    "No historical narrative recorded."}
                </p>
                <LegacyMetrics
                  payload={
                    row.payload as unknown as Partial<RenewalPackagePayload>
                  }
                />
              </>
            )}
          </section>
        ))
      )}
    </div>
  );
}
function LegacyMetrics({
  payload,
}: {
  payload: Partial<RenewalPackagePayload>;
}) {
  return (
    <section className="space-y-3">
      <h3 className="font-semibold">Historical aggregate snapshot</h3>
      <p className="text-sm">
        Period {payload.period?.start || "unknown"} –{" "}
        {payload.period?.end || "unknown"}
      </p>
      <dl className="grid gap-3 sm:grid-cols-2">
        {[
          ["Active residents", payload.metrics?.active_residents],
          ["Incidents in period", payload.metrics?.incidents_in_period],
          ["Active staff", payload.metrics?.active_staff],
          ["Invoice total", moneyLabel(payload.metrics?.invoice_total_cents)],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="text-sm">{value ?? "Unknown"}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
