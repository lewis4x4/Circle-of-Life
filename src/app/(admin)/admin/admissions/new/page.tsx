"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { AdmissionsHubNav } from "../admissions-hub-nav";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

export default function AdminAdmissionsNewPage() {
  const router = useRouter();
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();

  const [residentId, setResidentId] = useState("");
  const [referralLeadId, setReferralLeadId] = useState("");
  const [bedId, setBedId] = useState("");
  const [targetMoveIn, setTargetMoveIn] = useState("");
  const [notes, setNotes] = useState("");

  const [residents, setResidents] = useState<{ id: string; first_name: string; last_name: string; status: string }[]>([]);
  const [leads, setLeads] = useState<{ id: string; first_name: string; last_name: string }[]>([]);
  const [beds, setBeds] = useState<{ id: string; bed_label: string }[]>([]);
  const [loadingRefs, setLoadingRefs] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRefs = useCallback(async () => {
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setResidents([]);
      setLeads([]);
      setBeds([]);
      setLoadingRefs(false);
      return;
    }
    setLoadingRefs(true);

    const [res, ld, bd] = await Promise.all([
      supabase
        .from("residents")
        .select("id, first_name, last_name, status")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .in("status", ["inquiry", "pending_admission"])
        .order("last_name"),
      supabase
        .from("referral_leads")
        .select("id, first_name, last_name")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .not("status", "in", "(converted,lost,merged)")
        .order("last_name"),
      supabase
        .from("beds")
        .select("id, bed_label")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .in("status", ["available", "hold"])
        .order("bed_label"),
    ]);

    setResidents((res.data ?? []) as typeof residents);
    setLeads((ld.data ?? []) as typeof leads);
    setBeds((bd.data ?? []) as typeof beds);
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
        referral_lead_id: referralLeadId || null,
        bed_id: bedId || null,
        target_move_in_date: targetMoveIn || null,
        notes: notes.trim() || null,
        status: "pending_clearance" as const,
        created_by: user.id,
      };

      const { data: inserted, error: insErr } = await supabase.from("admission_cases").insert(payload).select("id").single();
      if (insErr) {
        setError(insErr.message);
        return;
      }
      if (inserted?.id) {
        router.push(`/admin/admissions/${inserted.id}`);
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
            New admission case
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Opens a workflow row for a resident in inquiry or pending admission.
          </p>
        </div>
        <Link href="/admin/admissions" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          Back to pipeline
        </Link>
      </div>

      <AdmissionsHubNav />

      <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
        <CardHeader>
          <CardTitle className="font-display text-lg">Case</CardTitle>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Creates <code className="text-xs">admission_cases</code> for the facility selected in the header.
          </p>
        </CardHeader>
        <CardContent>
          {noFacility ? (
            <p className="text-sm text-amber-800 dark:text-amber-200">Select a facility in the header to continue.</p>
          ) : (
            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="adm-resident">Resident</Label>
                <select
                  id="adm-resident"
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
                {residents.length === 0 && !loadingRefs ? (
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    No inquiry or pending-admission residents. Add a{" "}
                    <Link href="/admin/residents/new" className="underline underline-offset-2">
                      new resident
                    </Link>{" "}
                    or update status on an existing profile.
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="adm-lead">Referral lead (optional)</Label>
                <select
                  id="adm-lead"
                  value={referralLeadId}
                  onChange={(e) => setReferralLeadId(e.target.value)}
                  disabled={loadingRefs}
                  className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
                >
                  <option value="">— None —</option>
                  {leads.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.last_name}, {l.first_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="adm-bed">Bed (optional)</Label>
                <select
                  id="adm-bed"
                  value={bedId}
                  onChange={(e) => setBedId(e.target.value)}
                  disabled={loadingRefs}
                  className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
                >
                  <option value="">— None —</option>
                  {beds.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.bed_label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="adm-target">Target move-in date</Label>
                <Input
                  id="adm-target"
                  type="date"
                  value={targetMoveIn}
                  onChange={(e) => setTargetMoveIn(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="adm-notes">Notes</Label>
                <Input id="adm-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Internal notes" />
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
                  "Create case"
                )}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
