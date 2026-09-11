import 'server-only'
import { createClient } from '@/lib/supabase/server'
import type { Json } from '@/types/database'

/** All commands run with the cookie-authenticated caller; no service credential. */
export async function standUpCommand(action: string, payload: Record<string, unknown> = {}): Promise<unknown> {
  const client = await createClient()
  const { data: auth, error: authError } = await client.auth.getUser()
  if (authError || !auth.user) throw new Error('Authentication required')
  // Migration-owned RPC is intentionally additive to the generated schema.
  const rpc = client.rpc.bind(client) as unknown as (name: string, args: { p_action: string; p_payload: Json }) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>
  const { data, error } = await rpc('stand_up_command', { p_action: action, p_payload: payload as Json })
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
  return data
}
