"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Loader2, UserPlus, ArrowLeft } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

const GENDERS = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "other", label: "Other" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
] as const;

type ResidentOption = {
  id: string;
  first_name: string;
  last_name: string;
  status: string;
};

type LeadOption = {
  id: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  date_of_birth: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  status: string;
};

type BedOption = {
  id: string;
  bed_label: string;
};

export default function AdminAdmissionsNewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const preselectedLeadId = searchParams.get("lead")?.trim() ?? "";

  // Form state
  const [residentId, setResidentId] = useState("");
  const [referralLeadId, setReferralLeadId] = useState("");
  const [bedId, setBedId] = useState("");
  const [targetMoveIn, setTargetMoveIn] = useState("");
  const [notes, setNotes] = useState("");

  // Toggle for creating new resident
  const [isCreatingResident, setIsCreatingResident] = useState(false);

  // New resident form
  const [newFirstName, setNewFirstName] = useState("");
  const [newLastName, setNewLastName] = useState("");
  const [newDob, setNewDob] = useState("");
  const [newGender, setNewGender] = useState("female");

  // Loading states
  const [loadingRefs, setLoadingRefs] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Data lists
  const [residents, setResidents] = useState<ResidentOption[]>([]);
  const [leads, setLeads] = useState<LeadOption[]>([]);
  const [beds, setBeds] = useState<BedOption[]>([]);
  const [prefillApplied, setPrefillApplied] = useState(false);
  const [existingAdmissionCaseId, setExistingAdmissionCaseId] = useState<string | null>(null);
  const [existingResidentAdmissionCaseId, setExistingResidentAdmissionCaseId] = useState<string | null>(null);

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
        .select("id, first_name, last_name, preferred_name, date_of_birth, phone, email, notes, status")
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

    setResidents((res.data ?? []) as ResidentOption[]);
    setLeads((ld.data ?? []) as LeadOption[]);
    setBeds((bd.data ?? []) as BedOption[]);
    setLoadingRefs(false);
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void loadRefs();
  }, [loadRefs]);

  // When toggling resident creation, clear/restore selection
  useEffect(() => {
    if (isCreatingResident) {
      setResidentId("");
    }
  }, [isCreatingResident]);

  useEffect(() => {
    if (!preselectedLeadId || prefillApplied || leads.length === 0) return;
    const selectedLead = leads.find((lead) => lead.id === preselectedLeadId);
    if (!selectedLead) return;
    setReferralLeadId(selectedLead.id);
    setIsCreatingResident(true);
    setResidentId("");
    setNewFirstName(selectedLead.first_name ?? "");
    setNewLastName(selectedLead.last_name ?? "");
    setNewDob(selectedLead.date_of_birth ?? "");
    setNotes((prev) => prev || selectedLead.notes || "");
    setPrefillApplied(true);
  }, [leads, preselectedLeadId, prefillApplied]);

  useEffect(() => {
    async function checkExistingCase() {
      if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId) || !referralLeadId) {
        setExistingAdmissionCaseId(null);
        return;
      }
      const { data } = await supabase
        .from("admission_cases")
        .select("id")
        .eq("facility_id", selectedFacilityId)
        .eq("referral_lead_id", referralLeadId)
        .is("deleted_at", null)
        .not("status", "eq", "cancelled")
        .maybeSingle();
      setExistingAdmissionCaseId(data?.id ?? null);
    }

    void checkExistingCase();
  }, [referralLeadId, selectedFacilityId, supabase]);

  useEffect(() => {
    async function checkExistingResidentCase() {
      if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId) || isCreatingResident || !residentId) {
        setExistingResidentAdmissionCaseId(null);
        return;
      }
      const { data } = await supabase
        .from("admission_cases")
        .select("id")
        .eq("facility_id", selectedFacilityId)
        .eq("resident_id", residentId)
        .is("deleted_at", null)
        .not("status", "eq", "cancelled")
        .maybeSingle();
      setExistingResidentAdmissionCaseId(data?.id ?? null);
    }

    void checkExistingResidentCase();
  }, [isCreatingResident, residentId, selectedFacilityId, supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setError("Select a facility in the header.");
      return;
    }
    if (existingAdmissionCaseId || existingResidentAdmissionCaseId) {
      setError("This intake is already represented by an active admission case.");
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

      let finalResidentId = residentId;

      // Create new resident if needed
      if (isCreatingResident) {
        const fn = newFirstName.trim();
        const ln = newLastName.trim();
        if (!fn || !ln) {
          setError("First and last name are required for new resident.");
          setSubmitting(false);
          return;
        }
        if (!newDob) {
          setError("Date of birth is required for new resident.");
          setSubmitting(false);
          return;
        }

        const { data: newRes, error: newResErr } = await supabase
          .from("residents")
          .insert({
            facility_id: selectedFacilityId,
            organization_id: fac.organization_id,
            first_name: fn,
            last_name: ln,
            date_of_birth: newDob,
            gender: newGender as "female" | "male" | "other" | "prefer_not_to_say",
            status: "inquiry",
            created_by: user.id,
            updated_by: user.id,
          })
          .select("id")
          .single();

        if (newResErr) {
          setError(newResErr.message);
          setSubmitting(false);
          return;
        }
        finalResidentId = newRes.id;
      } else if (!residentId) {
        setError("Select an existing resident or create a new one.");
        setSubmitting(false);
        return;
      }

      // Create admission case
      const payload = {
        organization_id: fac.organization_id,
        facility_id: selectedFacilityId,
        resident_id: finalResidentId,
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
      <div className="flex items-center gap-4">
        <Link
          href="/admin/admissions"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "p-2")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            New admission case
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Start the intake workflow for a resident.
          </p>
        </div>
      </div>

      <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
        <CardHeader>
          <CardTitle className="font-display text-lg">Resident</CardTitle>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Select an existing resident in inquiry status, or create a new one.
          </p>
        </CardHeader>
        <CardContent>
          {noFacility ? (
            <p className="text-sm text-amber-800 dark:text-amber-200">Select a facility in the header to continue.</p>
          ) : (
            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-6">
              {existingAdmissionCaseId ? (
                <div className="rounded-lg border border-indigo-200/80 bg-indigo-50/50 px-4 py-3 text-sm text-indigo-950 dark:border-indigo-900/50 dark:bg-indigo-950/30 dark:text-indigo-100">
                  This referral lead already has an active admission case. Open that case instead of creating a duplicate.
                  <div className="mt-3">
                    <Link href={`/admin/admissions/${existingAdmissionCaseId}`} className={cn(buttonVariants({ size: "sm" }))}>
                      Open existing admission case
                    </Link>
                  </div>
                </div>
              ) : null}
              {existingResidentAdmissionCaseId ? (
                <div className="rounded-lg border border-indigo-200/80 bg-indigo-50/50 px-4 py-3 text-sm text-indigo-950 dark:border-indigo-900/50 dark:bg-indigo-950/30 dark:text-indigo-100">
                  This resident already has an active admission case. Open that case instead of creating a duplicate.
                  <div className="mt-3">
                    <Link href={`/admin/admissions/${existingResidentAdmissionCaseId}`} className={cn(buttonVariants({ size: "sm" }))}>
                      Open existing admission case
                    </Link>
                  </div>
                </div>
              ) : null}
              {referralLeadId ? (
                <div className="rounded-lg border border-indigo-200/80 bg-indigo-50/50 px-4 py-3 text-sm text-indigo-900 dark:border-indigo-900/40 dark:bg-indigo-950/30 dark:text-indigo-100">
                  Admission will be linked to the selected referral lead and the new resident form has been prefilled where data exists.
                </div>
              ) : null}
              {/* Resident Selection Toggle */}
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => setIsCreatingResident(false)}
                    className={cn(
                      "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                      !isCreatingResident
                        ? "bg-indigo-600 text-white"
                        : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                    )}
                  >
                    Select existing
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsCreatingResident(true)}
                    className={cn(
                      "px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2",
                      isCreatingResident
                        ? "bg-indigo-600 text-white"
                        : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                    )}
                  >
                    <UserPlus className="h-4 w-4" />
                    Create new
                  </button>
                </div>

                {!isCreatingResident ? (
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
                        No inquiry or pending-admission residents. Create a new resident instead.
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <div className="space-y-4 p-4 rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="new-first">First name</Label>
                        <Input
                          id="new-first"
                          value={newFirstName}
                          onChange={(e) => setNewFirstName(e.target.value)}
                          placeholder="Jane"
                          required={isCreatingResident}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="new-last">Last name</Label>
                        <Input
                          id="new-last"
                          value={newLastName}
                          onChange={(e) => setNewLastName(e.target.value)}
                          placeholder="Smith"
                          required={isCreatingResident}
                        />
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="new-dob">Date of birth</Label>
                        <Input
                          id="new-dob"
                          type="date"
                          value={newDob}
                          onChange={(e) => setNewDob(e.target.value)}
                          required={isCreatingResident}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="new-gender">Gender</Label>
                        <select
                          id="new-gender"
                          value={newGender}
                          onChange={(e) => setNewGender(e.target.value)}
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm dark:bg-input/30"
                        >
                          {GENDERS.map((g) => (
                            <option key={g.value} value={g.value}>
                              {g.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      New resident will be created with status <span className="font-mono">inquiry</span>. Additional details can be added on the resident profile.
                    </p>
                  </div>
                )}
              </div>

              {/* Optional fields */}
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

              <Button type="submit" disabled={submitting || Boolean(existingAdmissionCaseId) || Boolean(existingResidentAdmissionCaseId) || (isCreatingResident ? false : residents.length === 0)}>
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
