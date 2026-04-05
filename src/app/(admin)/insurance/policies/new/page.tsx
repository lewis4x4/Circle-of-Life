"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { InsuranceHubNav } from "../../insurance-hub-nav";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { canMutateFinance, loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { Constants } from "@/types/database";
import type { Database } from "@/types/database";

type PolicyInsert = Database["public"]["Tables"]["insurance_policies"]["Insert"];
type EntityMini = { id: string; name: string };

function dollarsToCents(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number.parseFloat(t);
  if (Number.isNaN(n)) return null;
  return Math.round(n * 100);
}

export default function NewInsurancePolicyPage() {
  const supabase = createClient();
  const router = useRouter();
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof loadFinanceRoleContext>> | null>(null);
  const [entities, setEntities] = useState<EntityMini[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [entityId, setEntityId] = useState("");
  const [policyType, setPolicyType] = useState<Database["public"]["Enums"]["insurance_policy_type"]>("general_liability");
  const [status, setStatus] = useState<Database["public"]["Enums"]["insurance_policy_status"]>("active");
  const [carrierName, setCarrierName] = useState("");
  const [brokerName, setBrokerName] = useState("");
  const [policyNumber, setPolicyNumber] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [expirationDate, setExpirationDate] = useState("");
  const [premiumDollars, setPremiumDollars] = useState("");
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    setLoadError(null);
    const c = await loadFinanceRoleContext(supabase);
    setCtx(c);
    if (!c.ok) {
      setLoadError(c.error);
      return;
    }
    const { data: ent, error: entErr } = await supabase
      .from("entities")
      .select("id, name")
      .eq("organization_id", c.ctx.organizationId)
      .is("deleted_at", null)
      .order("name");
    if (entErr) {
      setLoadError(entErr.message);
      return;
    }
    const list = (ent ?? []) as EntityMini[];
    setEntities(list);
    setEntityId((prev) => (prev && list.some((e) => e.id === prev) ? prev : list[0]?.id ?? ""));
  }, [supabase]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ctx?.ok || !entityId || !carrierName.trim() || !policyNumber.trim() || !effectiveDate || !expirationDate) {
      setError("Entity, carrier, policy number, and dates are required.");
      return;
    }
    if (expirationDate <= effectiveDate) {
      setError("Expiration must be after effective date.");
      return;
    }
    setSaving(true);
    setError(null);
    const premiumCents = dollarsToCents(premiumDollars);
    const row: PolicyInsert = {
      organization_id: ctx.ctx.organizationId,
      entity_id: entityId,
      policy_type: policyType,
      carrier_name: carrierName.trim(),
      broker_name: brokerName.trim() || null,
      policy_number: policyNumber.trim(),
      effective_date: effectiveDate,
      expiration_date: expirationDate,
      status,
      premium_cents: premiumCents,
      notes: notes.trim() || null,
    };
    const { data, error: insErr } = await supabase.from("insurance_policies").insert(row).select("id").single();
    setSaving(false);
    if (insErr) {
      setError(insErr.message);
      return;
    }
    router.push(`/admin/insurance/policies/${(data as { id: string }).id}`);
  }

  const canWrite = ctx?.ok && canMutateFinance(ctx.ctx.appRole);
  const selectClass = cn(
    "flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950",
  );

  if (ctx && ctx.ok && !canWrite) {
    return (
      <div className="space-y-6">
        <InsuranceHubNav />
        <p className="text-sm text-slate-600 dark:text-slate-400">You do not have permission to create policies.</p>
        <Link className={cn(buttonVariants({ variant: "outline", size: "sm" }))} href="/admin/insurance/policies">
          Back to list
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <InsuranceHubNav />
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">New policy</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">Add an entity-level corporate insurance policy.</p>
      </div>

      {(loadError || error) && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {loadError ?? error}
        </p>
      )}

      <form onSubmit={(e) => void submit(e)} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Policy</CardTitle>
            <CardDescription>Required fields and premium (optional, USD).</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="entity">Entity</Label>
              <select
                id="entity"
                required
                className={selectClass}
                value={entityId}
                onChange={(e) => setEntityId(e.target.value)}
              >
                {entities.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ptype">Policy type</Label>
              <select
                id="ptype"
                className={selectClass}
                value={policyType}
                onChange={(e) => setPolicyType(e.target.value as typeof policyType)}
              >
                {Constants.public.Enums.insurance_policy_type.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="pstatus">Status</Label>
              <select
                id="pstatus"
                className={selectClass}
                value={status}
                onChange={(e) => setStatus(e.target.value as typeof status)}
              >
                {Constants.public.Enums.insurance_policy_status.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="carrier">Carrier</Label>
              <Input id="carrier" value={carrierName} onChange={(e) => setCarrierName(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="broker">Broker (optional)</Label>
              <Input id="broker" value={brokerName} onChange={(e) => setBrokerName(e.target.value)} />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="pnum">Policy number</Label>
              <Input id="pnum" value={policyNumber} onChange={(e) => setPolicyNumber(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="eff">Effective date</Label>
              <Input
                id="eff"
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="exp">Expiration date</Label>
              <Input
                id="exp"
                type="date"
                value={expirationDate}
                onChange={(e) => setExpirationDate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="prem">Premium (USD, optional)</Label>
              <Input
                id="prem"
                inputMode="decimal"
                placeholder="0.00"
                value={premiumDollars}
                onChange={(e) => setPremiumDollars(e.target.value)}
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="notes">Notes</Label>
              <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </CardContent>
        </Card>
        <div className="flex gap-2">
          <Button type="submit" disabled={saving || !canWrite}>
            {saving ? "Saving…" : "Create policy"}
          </Button>
          <Link className={cn(buttonVariants({ variant: "outline" }))} href="/admin/insurance/policies">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
