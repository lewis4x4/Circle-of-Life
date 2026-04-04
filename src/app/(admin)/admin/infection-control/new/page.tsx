"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const INFECTION_TYPES: Database["public"]["Tables"]["infection_surveillance"]["Row"]["infection_type"][] = [
  "uti",
  "respiratory_upper",
  "respiratory_lower",
  "gi",
  "skin_wound",
  "skin_fungal",
  "eye",
  "bloodstream",
  "covid",
  "influenza",
  "other",
];

export default function NewInfectionSurveillancePage() {
  const router = useRouter();
  const { selectedFacilityId } = useFacilityStore();
  const supabase = createClient();

  const [orgId, setOrgId] = useState<string | null>(null);
  const [residents, setResidents] = useState<{ id: string; label: string }[]>([]);
  const [residentId, setResidentId] = useState("");
  const [infectionType, setInfectionType] =
    useState<Database["public"]["Tables"]["infection_surveillance"]["Row"]["infection_type"]>("uti");
  const [onsetDate, setOnsetDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [symptomsText, setSymptomsText] = useState("fever");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadResidents = useCallback(async () => {
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) return;
    const { data: fac } = await supabase.from("facilities").select("organization_id").eq("id", selectedFacilityId).single();
    if (fac?.organization_id) setOrgId(fac.organization_id);
    const { data: rows, error: rErr } = await supabase
      .from("residents")
      .select("id, first_name, last_name, preferred_name")
      .eq("facility_id", selectedFacilityId)
      .is("deleted_at", null)
      .order("last_name");
    if (rErr) return;
    setResidents(
      (rows ?? []).map((r) => ({
        id: r.id,
        label:
          r.preferred_name?.trim() ||
          [r.first_name, r.last_name].filter(Boolean).join(" ").trim() ||
          "Resident",
      })),
    );
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void loadResidents();
  }, [loadResidents]);

  async function submit() {
    setError(null);
    if (!selectedFacilityId || !orgId || !residentId) {
      setError("Select a facility and resident.");
      return;
    }
    setSubmitting(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("Not signed in.");
        return;
      }
      const symptoms = symptomsText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (symptoms.length === 0) {
        setError("Enter at least one symptom keyword.");
        return;
      }
      const ins: Database["public"]["Tables"]["infection_surveillance"]["Insert"] = {
        resident_id: residentId,
        facility_id: selectedFacilityId,
        organization_id: orgId,
        infection_type: infectionType,
        status: "suspected",
        onset_date: onsetDate,
        identified_by: user.id,
        symptoms,
        unit_id: null,
      };
      const { data: created, error: insErr } = await supabase.from("infection_surveillance").insert(ins).select("id").single();
      if (insErr) throw insErr;
      const id = (created as { id: string }).id;
      const evalRes = await fetch("/api/infection-control/evaluate-outbreak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ surveillanceId: id }),
      });
      if (!evalRes.ok) {
        const j = (await evalRes.json()) as { error?: string };
        throw new Error(j.error ?? "Outbreak evaluation failed");
      }
      router.push(`/admin/infection-control/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (!selectedFacilityId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Select a facility</CardTitle>
          <CardDescription>Use the facility selector in the header to record surveillance.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <Link href="/admin/infection-control" className={cn(buttonVariants({ variant: "link", size: "sm" }), "h-auto p-0 text-xs")}>
          ← Infection control
        </Link>
        <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight">New surveillance</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Case</CardTitle>
          <CardDescription>Creates a surveillance row and runs outbreak detection.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="resident">Resident</Label>
            <select
              id="resident"
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm dark:border-slate-800 dark:bg-slate-950"
              value={residentId}
              onChange={(e) => setResidentId(e.target.value)}
            >
              <option value="">Select…</option>
              {residents.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="type">Infection type</Label>
            <select
              id="type"
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm dark:border-slate-800 dark:bg-slate-950"
              value={infectionType}
              onChange={(e) =>
                setInfectionType(e.target.value as Database["public"]["Tables"]["infection_surveillance"]["Row"]["infection_type"])
              }
            >
              {INFECTION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="onset">Onset date</Label>
            <Input id="onset" type="date" value={onsetDate} onChange={(e) => setOnsetDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sx">Symptoms (comma-separated)</Label>
            <Input id="sx" value={symptomsText} onChange={(e) => setSymptomsText(e.target.value)} placeholder="fever, cough" />
          </div>
          <Button type="button" disabled={submitting} onClick={() => void submit()}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Save & evaluate outbreak"
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
