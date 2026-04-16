"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, LogOut, UserCircle2 } from "lucide-react";

import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import { fetchPendingPoliciesForUser, resolveAckFacilityId } from "@/lib/pending-policies";
import type { Database } from "@/types/database";
import { CaregiverSupportStrip } from "@/components/caregiver/CaregiverSupportStrip";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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
    <div className="space-y-6 max-w-2xl mx-auto">
      <CaregiverSupportStrip
        active="me"
        title="Keep your shift identity, policies, and support links in one place."
        description="Use this area to verify who you are signed in as, report illness, review policy tasks, and move into clock or schedule support without leaving the caregiver shell."
      />
      <div className="glass-panel p-8 sm:p-10 rounded-[3rem] border border-white/5 bg-gradient-to-br from-zinc-900/80 via-black/60 to-black/80 backdrop-blur-3xl shadow-2xl relative overflow-hidden z-10 w-full transition-all text-zinc-100">
         {/* Background accent light */}
         <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-[80px] -mr-16 -mt-16 pointer-events-none" />

         <div className="flex flex-col md:flex-row md:items-center gap-6 relative z-10">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-[2rem] border border-white/10 bg-white/5 shadow-inner">
               <UserCircle2 className="h-10 w-10 text-white" />
            </div>
            <div>
               <h3 className="text-3xl font-display font-semibold tracking-wide text-white mb-1">{displayName}</h3>
               <p className="text-sm font-mono text-zinc-400 uppercase tracking-widest font-bold">{roleLabel}</p>
               
               <div className="flex flex-wrap gap-2 mt-4">
                  <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300 uppercase tracking-widest font-mono text-[9px] font-bold rounded-full px-3 py-1 shadow-[inset_0_1px_10px_rgba(16,185,129,0.1)]">
                  Floor profile
                  </Badge>
                  {email ? (
                     <Badge className="border-white/10 bg-black/40 text-zinc-300 tracking-wider font-mono text-[10px] font-bold rounded-full px-3 py-1">
                        {email}
                     </Badge>
                  ) : null}
               </div>
            </div>
         </div>
      </div>

      {pendingPolicyCount > 0 ? (
        <div className="glass-panel p-8 rounded-[2rem] border border-amber-500/30 bg-gradient-to-br from-amber-950/40 to-black/60 backdrop-blur-3xl shadow-[0_8px_32px_rgba(217,119,6,0.1)] relative w-full text-zinc-100 flex flex-col md:flex-row md:items-center justify-between gap-6 overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-2 bg-amber-500"></div>
          <div className="pl-4">
             <h4 className="text-xl font-display font-semibold text-amber-300 tracking-wide mb-1">Policies need your review</h4>
             <p className="text-sm font-mono text-amber-200/60 leading-relaxed font-medium">
               {pendingPolicyCount} polic{pendingPolicyCount === 1 ? "y" : "ies"} require acknowledgment.
             </p>
          </div>
          <Link
            href="/caregiver/policies"
            className="shrink-0 inline-flex items-center justify-center h-14 px-8 rounded-full font-mono uppercase tracking-widest text-[11px] w-full md:w-auto shadow-[0_4px_20px_rgba(217,119,6,0.15)] transition-all hover:scale-[1.02] border-0 text-amber-950 font-bold bg-amber-400 hover:bg-amber-300 tap-responsive"
          >
            Review policies
          </Link>
        </div>
      ) : null}

      {staff ? (
        <div className="glass-panel p-8 rounded-[2rem] border border-white/5 bg-white/[0.02] backdrop-blur-xl relative overflow-visible z-10 w-full transition-all text-zinc-100">
           <div className="mb-6">
             <h4 className="text-xl font-display font-semibold text-white tracking-wide">Report illness</h4>
             <p className="text-sm font-mono text-zinc-400 mt-1.5 leading-relaxed pr-4">
               Self-report an absence. Your facility team will see this on the staff illness list.
             </p>
           </div>
           
           {illMsg ? <p className="text-xs uppercase tracking-widest font-mono text-emerald-300 font-bold mb-4">{illMsg}</p> : null}
           
           <div className="flex flex-col sm:flex-row gap-4">
             <div className="relative flex-1">
                 <select
                   className="w-full h-14 rounded-full border border-white/10 bg-black/40 px-5 text-sm text-zinc-200 outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 appearance-none font-mono shadow-inner capitalize tracking-widest"
                   value={illType}
                   onChange={(e) =>
                     setIllType(e.target.value as Database["public"]["Tables"]["staff_illness_records"]["Row"]["illness_type"])
                   }
                 >
                   {(
                     ["respiratory", "gi", "covid", "influenza", "skin", "other", "personal"] as const
                   ).map((v) => (
                     <option key={v} value={v} className="bg-slate-900 text-sm capitalize">
                       {v}
                     </option>
                   ))}
                 </select>
                 <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-zinc-500">
                   <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                   </svg>
                 </div>
             </div>
             
             <Button
               type="button"
               disabled={illSubmitting}
               className="h-14 px-8 rounded-full font-mono uppercase tracking-widest text-[11px] shadow-lg transition-all hover:scale-[1.02] border-0 text-amber-950 font-bold bg-amber-500 hover:bg-amber-400 disabled:opacity-50 tap-responsive shrink-0"
               onClick={() => void submitIllness()}
             >
               {illSubmitting ? <Loader2 className="h-4 w-4 animate-spin mx-auto scale-125" /> : "Submit report"}
             </Button>
           </div>
        </div>
      ) : null}

      <div className="glass-panel p-8 rounded-[2rem] border border-white/5 bg-white/[0.02] backdrop-blur-xl relative overflow-visible z-10 w-full transition-all text-zinc-100">
         <div className="mb-6">
            <h4 className="text-xl font-display font-semibold text-white tracking-wide">Account</h4>
            <p className="text-sm font-mono text-zinc-400 mt-1.5 leading-relaxed pr-4">
              End your session on this device.
            </p>
         </div>
         
         <Button
            type="button"
            className="w-full h-14 rounded-full border border-white/10 bg-black/40 text-zinc-300 hover:bg-white/10 hover:text-white disabled:opacity-50 transition-all font-mono uppercase tracking-widest text-[11px] font-bold tap-responsive shadow-inner"
            disabled={signingOut || !isBrowserSupabaseConfigured()}
            onClick={() => void signOut()}
         >
            {signingOut ? <Loader2 className="mr-3 h-4 w-4 animate-spin" /> : <LogOut className="mr-3 h-5 w-5" />}
            Sign out
         </Button>
      </div>
    </div>
  );
}
