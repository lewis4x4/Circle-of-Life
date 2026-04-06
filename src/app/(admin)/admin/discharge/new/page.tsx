"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { DischargeHubNav } from "../discharge-hub-nav";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

export default function AdminDischargeNewPage() {
  const router = useRouter();
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();

  const [residentId, setResidentId] = useState("");
  const [residents, setResidents] = useState<{ id: string; first_name: string; last_name: string; status: string }[]>([]);
  const [loadingRefs, setLoadingRefs] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRefs = useCallback(async () => {
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setResidents([]);
      setLoadingRefs(false);
      return;
    }
    setLoadingRefs(true);
    const { data } = await supabase
      .from("residents")
      .select("id, first_name, last_name, status")
      .eq("facility_id", selectedFacilityId)
      .is("deleted_at", null)
      .not("status", "in", "(discharged,deceased)")
      .order("last_name");
    setResidents((data ?? []) as typeof residents);
    setLoadingRefs(false);
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void loadRefs();
  }, [loadRefs]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setError("Select a facility in the header.");
      return;
    }
    if (!residentId) {
      setError("Choose a resident.");
      return;
    }

    setSubmitting(true);
    try {
      const { data: fac, error: facErr } = await supabase
        .from("facilities")
        .select("organization_id")
        .eq("id", selectedFacilityId)
        .is("deleted_at", null)
        .maybeSingle();
      if (facErr || !fac?.organization_id) {
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
        organization_id: fac.organization_id,
        facility_id: selectedFacilityId,
        resident_id: residentId,
        status: "draft" as const,
        created_by: user.id,
      };

      const { data: inserted, error: insErr } = await supabase.from("discharge_med_reconciliation").insert(payload).select("id").single();
      if (insErr) {
        setError(insErr.message);
        return;
      }
      if (inserted?.id) {
        router.push(`/admin/discharge/${inserted.id}`);
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  const noFacility = !selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            New med reconciliation
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Creates a draft <code className="text-xs">discharge_med_reconciliation</code> row.
          </p>
        </div>
        <Link href="/admin/discharge" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          Back to pipeline
        </Link>
      </div>

      <DischargeHubNav />

      <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
        <CardHeader>
          <CardTitle className="font-display text-lg">Resident</CardTitle>
        </CardHeader>
        <CardContent>
          {noFacility ? (
            <p className="text-sm text-amber-800 dark:text-amber-200">Select a facility in the header to continue.</p>
          ) : (
            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="dis-resident">Resident</Label>
                <select
                  id="dis-resident"
                  value={residentId}
                  onChange={(e) => setResidentId(e.target.value)}
                  disabled={loadingRefs}
                  required
                  className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
                >
                  <option value="">— Select —</option>
                  {residents.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.last_name}, {r.first_name} ({r.status})
                    </option>
                  ))}
                </select>
              </div>
              {error ? (
                <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                  {error}
                </p>
              ) : null}
              <Button type="submit" disabled={submitting || residents.length === 0}>
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  "Create draft"
                )}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
