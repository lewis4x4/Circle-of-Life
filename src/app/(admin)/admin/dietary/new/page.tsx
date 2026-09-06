"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import {
  DIETARY_NEW_LOADING_PROFILE_COPY,
  DIETARY_NEW_LOADING_RESIDENTS_COPY,
  DIETARY_NEW_NO_RESIDENTS_AT_FACILITY_COPY,
} from "@/lib/dietary/dietary-new-display-copy";
import {
  isDietaryNewSubmitBlocked,
  resolveDietaryNewFetchErrorBannerMessage,
  resolveDietaryNewOrganizationGapMessage,
  resolveDietaryNewSubmitButtonLabel,
} from "@/lib/dietary/dietary-new-page-state";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";

type Food = Database["public"]["Enums"]["iddsi_food_level"];
type Fluid = Database["public"]["Enums"]["iddsi_fluid_level"];

const FOOD_OPTIONS: Food[] = [
  "not_assessed",
  "level_3_liquidized",
  "level_4_pureed",
  "level_5_minced_moist",
  "level_6_soft_bite_sized",
  "level_7_regular_easy_chew",
];

const FLUID_OPTIONS: Fluid[] = [
  "not_assessed",
  "level_0_thin",
  "level_1_slightly_thick",
  "level_2_mildly_thick",
  "level_3_moderately_thick",
  "level_4_extremely_thick",
];

function splitList(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

export default function AdminDietaryNewPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { user, organizationId, loading: authLoading } = useHavenAuth();
  const { selectedFacilityId } = useFacilityStore();
  const [residents, setResidents] = useState<{ id: string; label: string }[]>([]);
  const [residentId, setResidentId] = useState("");
  const [food, setFood] = useState<Food>("not_assessed");
  const [fluid, setFluid] = useState<Fluid>("not_assessed");
  const [allergies, setAllergies] = useState("");
  const [textures, setTextures] = useState("");
  const [aspiration, setAspiration] = useState("");
  const [medReview, setMedReview] = useState("");
  const [loadingResidents, setLoadingResidents] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const organizationGapMessage = resolveDietaryNewOrganizationGapMessage({
    authLoading,
    organizationId,
    hasOrgScopedData: false,
  });
  const fetchErrorBannerMessage = resolveDietaryNewFetchErrorBannerMessage({
    authLoading,
    fetchError,
  });

  const loadResidents = useCallback(async () => {
    if (authLoading) {
      return;
    }

    setLoadingResidents(true);
    setFetchError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setResidents([]);
      setLoadingResidents(false);
      return;
    }
    try {
      const { data, error: qErr } = await supabase
        .from("residents")
        .select("id, first_name, last_name")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("last_name", { ascending: true })
        .limit(300);
      if (qErr) {
        setFetchError(qErr.message);
        setResidents([]);
        return;
      }
      setResidents(
        (data ?? []).map((r) => ({
          id: r.id,
          label: `${r.first_name} ${r.last_name}`.trim(),
        })),
      );
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Failed to load residents.");
      setResidents([]);
    } finally {
      setLoadingResidents(false);
    }
  }, [authLoading, supabase, selectedFacilityId]);

  useEffect(() => {
    void loadResidents();
  }, [loadResidents]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const facilityReady = Boolean(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));
    if (
      isDietaryNewSubmitBlocked({
        saving,
        authLoading,
        organizationId,
        facilityReady,
        residentId,
      })
    ) {
      return;
    }
    if (!user || !organizationId || !selectedFacilityId) return;

    setSaving(true);
    setFetchError(null);
    try {
      const { error: insErr } = await supabase.from("diet_orders").insert({
        organization_id: organizationId,
        facility_id: selectedFacilityId,
        resident_id: residentId,
        status: "draft",
        active: false,
        diet_type: "regular",
        iddsi_food_level: food === "not_assessed" ? null : Number(food.match(/level_(\d)/)?.[1]),
        iddsi_liquid_level: fluid === "not_assessed" ? null : Number(fluid.match(/level_(\d)/)?.[1]),
        allergies: splitList(allergies),
        iddsi_fluid_level: fluid,
        allergy_constraints: splitList(allergies),
        texture_constraints: splitList(textures),
        aspiration_notes: aspiration.trim() || null,
        medication_texture_review_notes: medReview.trim() || null,
        created_by: user.id,
      } as never);
      if (insErr) throw insErr;
      router.push("/admin/dietary");
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  const facilityReady = Boolean(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));
  const showEmptyResidentsGap =
    facilityReady && !authLoading && !loadingResidents && residents.length === 0 && !fetchErrorBannerMessage;
  const submitBlocked = isDietaryNewSubmitBlocked({
    saving,
    authLoading,
    organizationId,
    facilityReady,
    residentId,
  });
  const selectClass = cn(
    "h-8 w-full max-w-xl rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none",
    "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
  );

  return (
    <div className="mx-auto max-w-xl space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
          New diet order
        </h1>
        <Link href="/admin/dietary" className={cn(buttonVariants({ variant: "outline" }), "shrink-0")}>
          Back
        </Link>
      </div>

      {authLoading ? (
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          {DIETARY_NEW_LOADING_PROFILE_COPY}
        </p>
      ) : null}

      {organizationGapMessage ? (
        <Card className="rounded-lg border border-dashed border-muted-foreground/35 bg-muted/30 shadow-sm">
          <CardContent className="p-4 text-sm text-muted-foreground">{organizationGapMessage}</CardContent>
        </Card>
      ) : null}

      {!facilityReady && !authLoading ? (
        <p className="text-sm text-amber-800 dark:text-amber-200">Select a facility first.</p>
      ) : null}

      {fetchErrorBannerMessage ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
          {fetchErrorBannerMessage}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Draft order</CardTitle>
          <CardDescription>
            Nurse or dietary roles can create drafts. Family users can read active orders for linked residents.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="res">Resident</Label>
              {loadingResidents || authLoading ? (
                <p className="text-sm text-slate-500">{DIETARY_NEW_LOADING_RESIDENTS_COPY}</p>
              ) : showEmptyResidentsGap ? (
                <p className="rounded-lg border border-dashed border-muted-foreground/35 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                  {DIETARY_NEW_NO_RESIDENTS_AT_FACILITY_COPY}
                </p>
              ) : (
                <select
                  id="res"
                  required
                  className={selectClass}
                  value={residentId}
                  onChange={(e) => setResidentId(e.target.value)}
                  disabled={!facilityReady || residents.length === 0 || Boolean(organizationGapMessage)}
                >
                  <option value="">Select…</option>
                  {residents.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="food">IDDSI food</Label>
                <select id="food" className={selectClass} value={food} onChange={(e) => setFood(e.target.value as Food)}>
                  {FOOD_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="fluid">IDDSI fluid</Label>
                <select id="fluid" className={selectClass} value={fluid} onChange={(e) => setFluid(e.target.value as Fluid)}>
                  {FLUID_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="allergies">Allergy constraints (comma-separated)</Label>
              <Input
                id="allergies"
                value={allergies}
                onChange={(e) => setAllergies(e.target.value)}
                placeholder="e.g. peanut, shellfish"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tex">Texture constraints (comma-separated)</Label>
              <Input
                id="tex"
                value={textures}
                onChange={(e) => setTextures(e.target.value)}
                placeholder="e.g. no whole nuts, thin liquids only"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="asp">Aspiration / swallowing notes</Label>
              <Input id="asp" value={aspiration} onChange={(e) => setAspiration(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="med">Medication / texture review notes</Label>
              <Input id="med" value={medReview} onChange={(e) => setMedReview(e.target.value)} />
            </div>
            <Button type="submit" disabled={submitBlocked}>
              {resolveDietaryNewSubmitButtonLabel({ saving, authLoading })}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
