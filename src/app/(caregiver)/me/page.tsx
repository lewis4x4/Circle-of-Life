"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogOut, UserCircle2 } from "lucide-react";

import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type ProfileRow = Pick<Database["public"]["Tables"]["user_profiles"]["Row"], "app_role">;
type StaffMini = Pick<Database["public"]["Tables"]["staff"]["Row"], "first_name" | "last_name" | "staff_role">;

export default function CaregiverMePage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [staff, setStaff] = useState<StaffMini | null>(null);
  const [signingOut, setSigningOut] = useState(false);

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
        return;
      }
      const pr = await supabase.from("user_profiles").select("app_role").eq("id", user.id).maybeSingle();
      if (!pr.error && pr.data) setProfile(pr.data as ProfileRow);
      const st = await supabase
        .from("staff")
        .select("first_name, last_name, staff_role")
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .maybeSingle();
      if (!st.error && st.data) setStaff(st.data as StaffMini);
      else setStaff(null);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

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
