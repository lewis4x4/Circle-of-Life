import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";

import { StandUpPrintSheet } from "./StandUpPrintSheet";

export const dynamic = "force-dynamic";

/** The Weekly Stand Up printout for the building's binder (A6). Access is the Stand Up command's. */
export default async function StandUpPrintPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const profile = user
    ? (await supabase.from("user_profiles").select("full_name, app_role").eq("id", user.id).maybeSingle()).data
    : null;
  if (!profile || profile.app_role === "family") {
    return <div className="p-6"><p className="text-sm text-neutral-700">Sign in to Haven to print a Stand Up report.</p></div>;
  }
  return (
    <Suspense fallback={null}>
      <StandUpPrintSheet printedByName={profile.full_name ?? "Haven user"} />
    </Suspense>
  );
}
