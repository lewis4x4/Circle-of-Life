"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";

import { VendorHubNav } from "../../vendor-hub-nav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { formatUsdFromCents } from "@/lib/insurance/format-money";
import type { Database } from "@/types/database";

type ContractRow = Database["public"]["Tables"]["contracts"]["Row"];
type TermRow = Database["public"]["Tables"]["contract_terms"]["Row"];
type AlertRow = Database["public"]["Tables"]["contract_alerts"]["Row"];

export default function VendorContractDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const supabase = createClient();
  const [contract, setContract] = useState<(ContractRow & { vendor_name?: string }) | null>(null);
  const [terms, setTerms] = useState<TermRow | null>(null);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    const c = await loadFinanceRoleContext(supabase);
    if (!c.ok) {
      setContract(null);
      setLoadError(c.error);
      setLoading(false);
      return;
    }
    const { data: row, error } = await supabase
      .from("contracts")
      .select("*")
      .eq("id", id)
      .eq("organization_id", c.ctx.organizationId)
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
  }, [supabase, id]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  if (!id) return null;

  return (
    <div className="space-y-6">
      <VendorHubNav />
      {loadError && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {loadError}
        </p>
      )}
      {loading && !contract ? (
        <p className="text-sm text-slate-600">Loading…</p>
      ) : contract ? (
        <>
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">{contract.title}</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              <Link className="text-primary underline-offset-4 hover:underline" href={`/admin/vendors/${contract.vendor_id}`}>
                {contract.vendor_name ?? "Vendor"}
              </Link>
              {" · "}
              <span className="capitalize">{contract.contract_type}</span>
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Terms</CardTitle>
                <CardDescription>Effective {contract.effective_date}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p>Expires: {contract.expiration_date ?? "—"}</p>
                <p>Auto-renew: {contract.auto_renew ? "Yes" : "No"}</p>
                <p>Total value: {formatUsdFromCents(contract.total_value_cents)}</p>
                {contract.payment_terms && <p>Payment terms: {contract.payment_terms}</p>}
                {contract.document_storage_path && (
                  <p className="break-all text-slate-600">Document path: {contract.document_storage_path}</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Structured terms</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-slate-600 dark:text-slate-400">
                {terms ? (
                  <ul className="list-inside list-disc space-y-1">
                    {terms.sla_response_hours != null && <li>SLA response: {terms.sla_response_hours}h</li>}
                    {terms.insurance_requirements && <li>Insurance: {terms.insurance_requirements}</li>}
                    {terms.notes && <li>{terms.notes}</li>}
                  </ul>
                ) : (
                  <p>No structured terms row.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Alerts</CardTitle>
              <CardDescription>Renewal and compliance reminders.</CardDescription>
            </CardHeader>
            <CardContent>
              {alerts.length === 0 ? (
                <p className="text-sm text-slate-500">No alerts.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {alerts.map((a) => (
                    <li key={a.id} className="rounded-md border border-slate-200 p-2 dark:border-slate-800">
                      <span className="font-medium">{a.title}</span> — {a.alert_date} ({a.alert_type}) — {a.status}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
