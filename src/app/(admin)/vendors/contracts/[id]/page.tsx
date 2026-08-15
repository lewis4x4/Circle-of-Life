"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";

import { VendorHubNav } from "../../vendor-hub-nav";
import { RecordDetailHeader, RecordDetailSection } from "@/design-system/components/record-detail";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { createClient } from "@/lib/supabase/client";
import { formatUsdFromCents } from "@/lib/insurance/format-money";
import { formatVendorContractExpirationDate } from "@/lib/vendors/contracts-display-copy";
import type { Database } from "@/types/database";

type ContractRow = Database["public"]["Tables"]["contracts"]["Row"];
type TermRow = Database["public"]["Tables"]["contract_terms"]["Row"];
type AlertRow = Database["public"]["Tables"]["contract_alerts"]["Row"];

export default function VendorContractDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const supabase = createClient();
  const { organizationId } = useHavenAuth();
  const [contract, setContract] = useState<(ContractRow & { vendor_name?: string }) | null>(null);
  const [terms, setTerms] = useState<TermRow | null>(null);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    if (!organizationId) {
      setContract(null);
      setLoadError("Organization missing on profile.");
      setLoading(false);
      return;
    }
    const { data: row, error } = await supabase
      .from("contracts")
      .select("*")
      .eq("id", id)
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error || !row) {
      setLoadError(error?.message ?? "Contract not found.");
      setContract(null);
      setLoading(false);
      return;
    }
    const r = row as ContractRow;
    const { data: vn } = await supabase.from("vendors").select("name").eq("id", r.vendor_id).maybeSingle();
    setContract({ ...r, vendor_name: (vn?.name as string) ?? undefined });

    const { data: t } = await supabase.from("contract_terms").select("*").eq("contract_id", id).is("deleted_at", null).maybeSingle();
    setTerms((t as TermRow) ?? null);

    const { data: a } = await supabase
      .from("contract_alerts")
      .select("*")
      .eq("contract_id", id)
      .is("deleted_at", null)
      .order("alert_date");
    setAlerts((a ?? []) as AlertRow[]);
    setLoading(false);
  }, [supabase, id, organizationId]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  if (!id) return null;

  return (
    <div className="space-y-6">
      <VendorHubNav />
      {loadError && (
        <p className="text-sm text-destructive" role="alert">
          {loadError}
        </p>
      )}
      {loading && !contract ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : contract ? (
        <>
          <RecordDetailHeader
            title={contract.title}
            subtitle={`${contract.vendor_name ?? "Vendor"} · ${contract.contract_type}`}
            backLink={{ label: "Back to contracts", href: "/admin/vendors/contracts" }}
          />

          <div className="grid gap-4 md:grid-cols-2">
            <RecordDetailSection
              title="Terms"
              description={`Effective ${contract.effective_date}`}
            >
              <div className="space-y-1 text-sm">
                <p>Expires: {formatVendorContractExpirationDate(contract.expiration_date)}</p>
                <p>Auto-renew: {contract.auto_renew ? "Yes" : "No"}</p>
                <p>
                  Total value:{" "}
                  <span className="tabular-nums">{formatUsdFromCents(contract.total_value_cents)}</span>
                </p>
                {contract.payment_terms && <p>Payment terms: {contract.payment_terms}</p>}
                {contract.document_storage_path && (
                  <p className="break-all text-muted-foreground">
                    Document path: {contract.document_storage_path}
                  </p>
                )}
              </div>
            </RecordDetailSection>

            <RecordDetailSection title="Structured terms">
              <div className="text-sm text-muted-foreground">
                {terms ? (
                  <ul className="list-inside list-disc space-y-1">
                    {terms.sla_response_hours != null && <li>SLA response: {terms.sla_response_hours}h</li>}
                    {terms.insurance_requirements && <li>Insurance: {terms.insurance_requirements}</li>}
                    {terms.notes && <li>{terms.notes}</li>}
                  </ul>
                ) : (
                  <p>No structured terms row.</p>
                )}
              </div>
            </RecordDetailSection>
          </div>

          <RecordDetailSection
            title="Alerts"
            description="Renewal and compliance reminders."
          >
            {alerts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No alerts.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {alerts.map((a) => (
                  <li key={a.id} className="rounded-[8px] border border-border p-[14px]">
                    <span className="font-medium">{a.title}</span> — {a.alert_date} ({a.alert_type}) — {a.status}
                  </li>
                ))}
              </ul>
            )}
          </RecordDetailSection>
        </>
      ) : null}
    </div>
  );
}
