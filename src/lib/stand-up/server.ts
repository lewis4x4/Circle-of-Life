import 'server-only'
import { createClient } from '@/lib/supabase/server'
import type { Json } from '@/types/database'

/** All commands run with the cookie-authenticated caller; no service credential. */
export async function standUpCommand(action: string, payload: Record<string, unknown> = {}): Promise<unknown> {
  const client = await createClient()
  // Local JWT verification; the RPC's PostgREST pre-request check still refuses a
  // revoked session, so this no longer pays a Supabase Auth round trip (COL-674).
  const { data: auth, error: authError } = await client.auth.getClaims()
  if (authError || typeof auth?.claims?.sub !== 'string') throw new Error('Authentication required')
  // Migration-owned RPC is intentionally additive to the generated schema.
  const rpc = client.rpc.bind(client) as unknown as (name: string, args: { p_action: string; p_payload: Json }) => Promise<{ data: unknown; error: { message: string; code?: string; hint?: string } | null }>
  const { data, error } = await rpc('stand_up_command', { p_action: action, p_payload: payload as Json })
  // The hint carries the refusal's machine-readable code (stand_up_entry_not_open);
  // the message is the operator sentence and stays the only thing rendered.
  if (error) throw Object.assign(new Error(error.message), { code: error.code, hint: error.hint })
  return data
}
