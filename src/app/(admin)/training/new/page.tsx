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
import { cn } from "@/lib/utils";

type StaffOption = { id: string; name: string };

export default function AdminTrainingNewDemonstrationPage() {
  const supabase = createClient();
  const router = useRouter();
  const { selectedFacilityId } = useFacilityStore();
  const [staffList, setStaffList] = useState<StaffOption[]>([]);
  const [staffId, setStaffId] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStaff = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setStaffList([]);
      setLoading(false);
      return;
    }
    try {
      const { data, error: qErr } = await supabase
        .from("staff")
        .select("id, first_name, last_name")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("last_name", { ascending: true })
        .limit(200);
      if (qErr) throw qErr;
      setStaffList(
        (data ?? []).map((s) => ({
          id: s.id,
          name: `${s.first_name} ${s.last_name}`.trim(),
        })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load staff.");
      setStaffList([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void loadStaff();
  }, [loadStaff]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId) || !staffId) return;
    setSaving(true);
    setError(null);
    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) throw new Error(ctx.error);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Sign in required.");
      const { error: insErr } = await supabase.from("competency_demonstrations").insert({
        organization_id: ctx.ctx.organizationId,
        facility_id: selectedFacilityId,
        staff_id: staffId,
        evaluator_user_id: user.id,
        created_by: user.id,
        status: "draft",
        skills_json: [],
        attachments: [],
        notes: notes.trim() || null,
      });
      if (insErr) throw insErr;
      router.push("/admin/training");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  const facilityReady = Boolean(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));

  return (
    <div className="mx-auto max-w-lg space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
          New demonstration
        </h1>
        <Link href="/admin/training" className={cn(buttonVariants({ variant: "outline" }), "shrink-0")}>
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
          <CardTitle className="text-lg">Record demonstration</CardTitle>
          <CardDescription>
            Creates a draft row. You are recorded as the evaluator. Owner, org admin, or facility admin only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="staff">Staff member</Label>
              {loading ? (
                <p className="text-sm text-slate-500">Loading staff…</p>
              ) : (
                <select
                  id="staff"
                  required
                  value={staffId}
                  onChange={(e) => setStaffId(e.target.value)}
                  disabled={!facilityReady || staffList.length === 0}
                  className={cn(
                    "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none",
                    "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                    "dark:bg-input/30",
                  )}
                >
                  <option value="">Select…</option>
                  {staffList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Input
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Context for auditors"
              />
            </div>
            <Button type="submit" disabled={saving || !facilityReady || !staffId}>
              {saving ? "Saving…" : "Save draft"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
