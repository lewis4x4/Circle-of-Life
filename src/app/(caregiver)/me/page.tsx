"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, LogOut, UserCircle2 } from "lucide-react";

import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import { fetchPendingPoliciesForUser, resolveAckFacilityId } from "@/lib/pending-policies";
import type { Database } from "@/types/database";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type ProfileRow = Pick<Database["public"]["Tables"]["user_profiles"]["Row"], "app_role">;
type StaffMini = Pick<
  Database["public"]["Tables"]["staff"]["Row"],
  "id" | "facility_id" | "organization_id" | "first_name" | "last_name" | "staff_role"
>;

export default function CaregiverMePage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [staff, setStaff] = useState<StaffMini | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [illType, setIllType] = useState<Database["public"]["Tables"]["staff_illness_records"]["Row"]["illness_type"]>("other");
  const [illSubmitting, setIllSubmitting] = useState(false);
  const [illMsg, setIllMsg] = useState<string | null>(null);
  const [pendingPolicyCount, setPendingPolicyCount] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setEmail(user?.email ?? null);
      if (!user) {
        setProfile(null);
        setStaff(null);
        setPendingPolicyCount(0);
        return;
      }
      const pr = await supabase.from("user_profiles").select("app_role").eq("id", user.id).maybeSingle();
      if (!pr.error && pr.data) setProfile(pr.data as ProfileRow);
      const st = await supabase
        .from("staff")
        .select("id, facility_id, organization_id, first_name, last_name, staff_role")
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .maybeSingle();
      if (!st.error && st.data) setStaff(st.data as StaffMini);
      else setStaff(null);

      const facId = await resolveAckFacilityId(supabase, user.id);
      if (facId) {
        const pending = await fetchPendingPoliciesForUser(supabase, user.id, facId);
        setPendingPolicyCount(pending.length);
      } else {
        setPendingPolicyCount(0);
      }
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitIllness() {
    if (!staff) return;
    setIllSubmitting(true);
    setIllMsg(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setIllMsg("Not signed in.");
        return;
      }
      const today = new Date().toISOString().slice(0, 10);
      const ins: Database["public"]["Tables"]["staff_illness_records"]["Insert"] = {
        staff_id: staff.id,
        facility_id: staff.facility_id,
        organization_id: staff.organization_id,
        reported_date: today,
        illness_type: illType,
        symptoms: ["self_report"],
        absent_from: today,
        absent_to: null,
        created_by: user.id,
      };
      const { error } = await supabase.from("staff_illness_records").insert(ins);
      if (error) throw error;
      setIllMsg("Report submitted. A nurse may follow up.");
    } catch (e) {
      setIllMsg(e instanceof Error ? e.message : "Could not submit.");
    } finally {
      setIllSubmitting(false);
    }
  }

  async function signOut() {
    setSigningOut(true);
    try {
      await supabase.auth.signOut();
      router.replace("/login");
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }

  const displayName = staff
    ? `${staff.first_name} ${staff.last_name}`.trim()
    : email ?? "Signed in";

  const roleLabel = staff
    ? String(staff.staff_role).replace(/_/g, " ")
    : profile?.app_role?.replace(/_/g, " ") ?? "Caregiver";

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-zinc-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-zinc-800 bg-gradient-to-br from-zinc-950 to-zinc-900 text-zinc-100">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900">
              <UserCircle2 className="h-8 w-8 text-zinc-400" />
            </div>
            <div>
              <CardTitle className="text-lg font-display">{displayName}</CardTitle>
              <CardDescription className="text-zinc-400 capitalize">{roleLabel}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Badge variant="outline" className="border-emerald-800/60 bg-emerald-950/30 text-emerald-200">
            Haven floor app
          </Badge>
          {email ? (
            <Badge variant="outline" className="border-zinc-700 text-zinc-300">
              {email}
            </Badge>
          ) : null}
        </CardContent>
      </Card>

      {pendingPolicyCount > 0 ? (
        <Card className="border-amber-800/60 bg-amber-950/40 text-zinc-100">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-amber-100">Policies need your review</CardTitle>
            <CardDescription className="text-amber-200/80">
              {pendingPolicyCount} polic{pendingPolicyCount === 1 ? "y" : "ies"} require acknowledgment.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/caregiver/policies"
              className="inline-flex rounded-md bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
            >
              Review policies
            </Link>
          </CardContent>
        </Card>
      ) : null}

      {staff ? (
        <Card className="border-zinc-800 bg-zinc-950/70 text-zinc-100">
          <CardHeader>
            <CardTitle className="text-base">Report illness</CardTitle>
            <CardDescription className="text-zinc-400">
              Self-report an absence. Your facility team will see this on the staff illness list.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {illMsg ? <p className="text-sm text-emerald-300">{illMsg}</p> : null}
            <div className="flex flex-wrap gap-2">
              <select
                className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-2 text-sm text-zinc-100"
                value={illType}
                onChange={(e) =>
                  setIllType(e.target.value as Database["public"]["Tables"]["staff_illness_records"]["Row"]["illness_type"])
                }
              >
                {(
                  ["respiratory", "gi", "covid", "influenza", "skin", "other", "personal"] as const
                ).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                disabled={illSubmitting}
                className="bg-amber-700 hover:bg-amber-600"
                onClick={() => void submitIllness()}
              >
                {illSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit report"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card className="border-zinc-800 bg-zinc-950/70 text-zinc-100">
        <CardHeader>
          <CardTitle className="text-base">Account</CardTitle>
          <CardDescription className="text-zinc-400">End your session on this device.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            variant="outline"
            className="w-full border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800 hover:text-white disabled:opacity-50"
            disabled={signingOut || !isBrowserSupabaseConfigured()}
            onClick={() => void signOut()}
          >
            {signingOut ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogOut className="mr-2 h-4 w-4" />}
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
