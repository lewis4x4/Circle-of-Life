"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

export default function AdminPayrollNewBatchPage() {
  const supabase = createClient();
  const router = useRouter();
  const { selectedFacilityId } = useFacilityStore();
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [provider, setProvider] = useState("generic");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const facilityReady = Boolean(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) return;
    if (!periodStart || !periodEnd) return;
    setSaving(true);
    setError(null);
    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) throw new Error(ctx.error);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Sign in required.");
      const { error: insErr } = await supabase.from("payroll_export_batches").insert({
        organization_id: ctx.ctx.organizationId,
        facility_id: selectedFacilityId,
        period_start: periodStart,
        period_end: periodEnd,
        provider: provider.trim() || "generic",
        status: "draft",
        created_by: user.id,
      });
      if (insErr) throw insErr;
      router.push("/admin/payroll");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create batch.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
          New payroll batch
        </h1>
        <Link href="/admin/payroll" className={cn(buttonVariants({ variant: "outline" }), "shrink-0")}>
          Back
        </Link>
      </div>

      {!facilityReady && (
        <p className="text-sm text-amber-800 dark:text-amber-200">Select a facility first.</p>
      )}

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
          {error}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Draft export batch</CardTitle>
          <CardDescription>
            Owner, org admin, or facility admin only. Populate lines from approved time in Enhanced.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ps">Period start</Label>
                <Input
                  id="ps"
                  type="date"
                  required
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pe">Period end</Label>
                <Input
                  id="pe"
                  type="date"
                  required
                  value={periodEnd}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="prov">Provider key</Label>
              <Input
                id="prov"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                placeholder="generic"
              />
            </div>
            <Button type="submit" disabled={saving || !facilityReady || !periodStart || !periodEnd}>
              {saving ? "Saving…" : "Create draft"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
