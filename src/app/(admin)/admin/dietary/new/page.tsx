"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
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
  const supabase = createClient();
  const router = useRouter();
  const { selectedFacilityId } = useFacilityStore();
  const [residents, setResidents] = useState<{ id: string; label: string }[]>([]);
  const [residentId, setResidentId] = useState("");
  const [food, setFood] = useState<Food>("not_assessed");
  const [fluid, setFluid] = useState<Fluid>("not_assessed");
  const [allergies, setAllergies] = useState("");
  const [textures, setTextures] = useState("");
  const [aspiration, setAspiration] = useState("");
  const [medReview, setMedReview] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadResidents = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setResidents([]);
      setLoading(false);
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
      if (qErr) throw qErr;
      setResidents(
        (data ?? []).map((r) => ({
          id: r.id,
          label: `${r.first_name} ${r.last_name}`.trim(),
        })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load residents.");
      setResidents([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void loadResidents();
  }, [loadResidents]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId) || !residentId) return;
    setSaving(true);
    setError(null);
    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) throw new Error(ctx.error);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Sign in required.");
      const { error: insErr } = await supabase.from("diet_orders").insert({
        organization_id: ctx.ctx.organizationId,
        facility_id: selectedFacilityId,
        resident_id: residentId,
        status: "draft",
        iddsi_food_level: food,
        iddsi_fluid_level: fluid,
        allergy_constraints: splitList(allergies),
        texture_constraints: splitList(textures),
        aspiration_notes: aspiration.trim() || null,
        medication_texture_review_notes: medReview.trim() || null,
        created_by: user.id,
      });
      if (insErr) throw insErr;
      router.push("/admin/dietary");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  const facilityReady = Boolean(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));
  const selectClass = cn(
    "h-8 w-full max-w-xl rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none",
    "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
  );

  return (
    <div className="mx-auto max-w-xl space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
          New diet order
        </h1>
        <Link href="/admin/dietary" className={cn(buttonVariants({ variant: "outline" }), "shrink-0")}>
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
          <CardTitle className="text-lg">Draft order</CardTitle>
          <CardDescription>
            Nurse or dietary roles can create drafts. Family users can read active orders for linked residents.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="res">Resident</Label>
              {loading ? (
                <p className="text-sm text-slate-500">Loading residents…</p>
              ) : (
                <select
                  id="res"
                  required
                  className={selectClass}
                  value={residentId}
                  onChange={(e) => setResidentId(e.target.value)}
                  disabled={!facilityReady || residents.length === 0}
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
            <Button type="submit" disabled={saving || !facilityReady || !residentId}>
              {saving ? "Saving…" : "Save draft"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
