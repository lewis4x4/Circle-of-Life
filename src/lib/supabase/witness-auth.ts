import { createClient } from "@supabase/supabase-js";

/** Each witness check owns its temporary session; never mutate the shared admin client. */
export async function verifyWitnessCredentials(email: string, password: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Witness authentication is not configured");
  const verifier = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const result = await verifier.auth.signInWithPassword({ email, password });
  if (result.data.session) {
    const { error } = await verifier.auth.signOut({ scope: "local" });
    if (error) throw new Error("Could not close witness verification session");
  }
  return result;
}
