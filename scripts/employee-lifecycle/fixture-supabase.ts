// This harness never contacts Supabase. Uploads need separate Storage transport verification.
export function createClient(): never {
  throw new Error("Unexpected Supabase call in isolated component harness");
}
