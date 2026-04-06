"use client";

import React, { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Percent } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

import { BillingHubNav } from "../../billing-hub-nav";

type QueryError = { message: string; code?: string };

function dollarsToCents(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number.parseFloat(t.replace(/[$,]/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function requiredPositiveCents(raw: string): number | null {
  const c = dollarsToCents(raw);
  if (c === null || c < 1) return null;
  return c;
}

export default function AdminNewRateSchedulePage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { selectedFacilityId } = useFacilityStore();

  const [name, setName] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [basePrivate, setBasePrivate] = useState("");
  const [baseSemi, setBaseSemi] = useState("");
  const [careL1, setCareL1] = useState("0");
  const [careL2, setCareL2] = useState("0");
  const [careL3, setCareL3] = useState("0");
  const [communityFee, setCommunityFee] = useState("");
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFacilityOrg = useCallback(async () => {
    if (!isValidFacilityIdForQuery(selectedFacilityId)) return null;
    const res = (await supabase
      .from("facilities" as never)
      .select("organization_id")
      .eq("id", selectedFacilityId)
      .is("deleted_at", null)
      .maybeSingle()) as {
      data: { organization_id: string } | null;
      error: QueryError | null;
    };
    if (res.error) throw new Error(res.error.message);
    return res.data?.organization_id ?? null;
  }, [supabase, selectedFacilityId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidFacilityIdForQuery(selectedFacilityId)) {
      setError("Select a facility in the header first.");
      return;
    }
    const label = name.trim();
    if (!label) {
      setError("Schedule name is required.");
      return;
    }
    if (!effectiveDate) {
      setError("Effective date is required.");
      return;
    }

    const basePriv = requiredPositiveCents(basePrivate);
    if (basePriv === null) {
      setError("Enter a valid positive amount for private base rate.");
      return;
    }

    const l1 = dollarsToCents(careL1) ?? 0;
    const l2 = dollarsToCents(careL2) ?? 0;
    const l3 = dollarsToCents(careL3) ?? 0;
    const semi = baseSemi.trim() ? dollarsToCents(baseSemi) : null;
    const comm = communityFee.trim() ? dollarsToCents(communityFee) : null;
    if (baseSemi.trim() && semi === null) {
      setError("Semi-private rate must be a valid amount or empty.");
      return;
    }
    if (communityFee.trim() && comm === null) {
      setError("Community fee must be a valid amount or empty.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const orgId = await loadFacilityOrg();
      if (!orgId) {
        setError("Could not resolve organization for this facility.");
        return;
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.id) {
        setError("You must be signed in.");
        return;
      }

      const payload = {
        facility_id: selectedFacilityId,
        organization_id: orgId,
        name: label,
        effective_date: effectiveDate,
        end_date: null as string | null,
        base_rate_private: basePriv,
        base_rate_semi_private: semi,
        care_surcharge_level_1: l1,
        care_surcharge_level_2: l2,
        care_surcharge_level_3: l3,
        community_fee: comm,
        notes: notes.trim() || null,
        created_by: user.id,
        updated_by: user.id,
      };

      const ins = (await supabase
        .from("rate_schedules" as never)
        .insert(payload as never)
        .select("id")
        .single()) as {
        data: { id: string } | null;
        error: QueryError | null;
      };

      if (ins.error) throw new Error(ins.error.message);
      router.push("/admin/billing/rates");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create rate schedule.");
    } finally {
      setSubmitting(false);
    }
  };

  const facilityReady = isValidFacilityIdForQuery(selectedFacilityId);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <BillingHubNav />

      <div>
        <Link
          href="/admin/billing/rates"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}
        >
          <ArrowLeft className="h-4 w-4" />
          Rate schedules
        </Link>
      </div>

      <div className="flex items-center gap-2">
        <Percent className="h-6 w-6 text-slate-500" />
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">New rate schedule</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Amounts are in US dollars; stored as cents. New rows are open-ended (no end date) until you close them in a
            future edit flow.
          </p>
        </div>
      </div>

      {!facilityReady && (
        <p className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Choose a facility from the header selector to enable this form.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Pricing</CardTitle>
          <CardDescription>Care surcharges default to zero; adjust to match your level-of-care matrix.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void handleSubmit(e)} className="max-w-md space-y-4">
            {error && (
              <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                {error}
              </p>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400" htmlFor="name">
                Schedule name
              </label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. 2026 Standard"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400" htmlFor="eff">
                Effective date
              </label>
              <Input
                id="eff"
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400" htmlFor="priv">
                Base private (monthly)
              </label>
              <Input
                id="priv"
                inputMode="decimal"
                value={basePrivate}
                onChange={(e) => setBasePrivate(e.target.value)}
                placeholder="4250.00"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400" htmlFor="semi">
                Base semi-private (monthly, optional)
              </label>
              <Input
                id="semi"
                inputMode="decimal"
                value={baseSemi}
                onChange={(e) => setBaseSemi(e.target.value)}
                placeholder="3750.00"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400" htmlFor="l1">
                  Care L1
                </label>
                <Input id="l1" inputMode="decimal" value={careL1} onChange={(e) => setCareL1(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400" htmlFor="l2">
                  Care L2
                </label>
                <Input id="l2" inputMode="decimal" value={careL2} onChange={(e) => setCareL2(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400" htmlFor="l3">
                  Care L3
                </label>
                <Input id="l3" inputMode="decimal" value={careL3} onChange={(e) => setCareL3(e.target.value)} />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400" htmlFor="comm">
                Community fee (optional)
              </label>
              <Input
                id="comm"
                inputMode="decimal"
                value={communityFee}
                onChange={(e) => setCommunityFee(e.target.value)}
                placeholder="2500.00"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400" htmlFor="notes">
                Notes (optional)
              </label>
              <Input
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Internal reference only"
              />
            </div>

            <Button type="submit" disabled={submitting || !facilityReady}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                "Create schedule"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
