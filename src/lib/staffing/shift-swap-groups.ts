import type { SupabaseClient } from "@supabase/supabase-js";
import { formatAssignmentInterval } from "@/lib/schedules/assignment-context";

export type SwapBlock = {
  assignment_id: string; staff_id?: string; staff_name?: string | null; group_id: string | null;
  block_index: number | null; block_count?: number | null; service_date: string;
  starts_at: string; ends_at: string; label: string; color?: string | null; time_zone: string; staff_role: string | null;
  rounding_coverage?: boolean | null;
};
export type SwapGroupContext = {
  swap_scope?: "assignment" | "group";
  requesting_group_snapshot?: unknown; covering_group_snapshot?: unknown;
  group_context_hash?: string | null; requesting_context_hash?: string | null; covering_context_hash?: string | null;
  reviewed_context_hash?: string | null;
  requesting_confirmed_at?: string | null; covering_confirmed_at?: string | null;
};
export const SWAP_CONTEXT_SELECT = "swap_scope, requesting_group_snapshot, covering_group_snapshot, group_context_hash, requesting_context_hash, covering_context_hash, reviewed_context_hash";

/** Invalid or truncated consent evidence must never enable a group confirmation. */
export function parseSwapBlocks(value: unknown): SwapBlock[] | null {
  if (!Array.isArray(value)) return null;
  const ids = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const row = raw as Partial<SwapBlock>;
    if (typeof row.assignment_id !== "string" || ids.has(row.assignment_id) || typeof row.label !== "string"
      || typeof row.service_date !== "string" || typeof row.time_zone !== "string"
      || typeof row.starts_at !== "string" || typeof row.ends_at !== "string"
      || !Number.isFinite(Date.parse(row.starts_at)) || !Number.isFinite(Date.parse(row.ends_at)) || Date.parse(row.ends_at) <= Date.parse(row.starts_at)) return null;
    try { new Intl.DateTimeFormat("en-US", { timeZone: row.time_zone }); } catch { return null; }
    ids.add(row.assignment_id);
  }
  return value as SwapBlock[];
}

export function hasCompleteSwapContext(row: SwapGroupContext): boolean {
  if (row.swap_scope && row.swap_scope !== "assignment" && row.swap_scope !== "group") return false;
  if (row.swap_scope !== "group") return true;
  const requesting = parseSwapBlocks(row.requesting_group_snapshot);
  const covering = parseSwapBlocks(row.covering_group_snapshot);
  if (!row.group_context_hash || !requesting?.length || !covering) return false;
  return [requesting, covering].every((blocks) => {
    if (!blocks.length) return true;
    const count = blocks[0].block_count;
    return typeof count === "number" && count === blocks.length
      && blocks.every((block, index) => block.group_id === blocks[0].group_id && block.block_count === count && block.block_index === index);
  });
}

export function swapPartyConfirmed(row: SwapGroupContext, side: "requesting" | "covering"): boolean {
  return Boolean(row[`${side}_confirmed_at`]) && (row.swap_scope !== "group"
    || (hasCompleteSwapContext(row) && row[`${side}_context_hash`] === row.group_context_hash));
}

export function canApproveSwapContext(row: SwapGroupContext): boolean {
  return hasCompleteSwapContext(row) && swapPartyConfirmed(row, "requesting") && swapPartyConfirmed(row, "covering");
}

/** Persist what the manager reviewed; a query filter alone cannot prove that to SQL. */
export function swapApprovalContext(row: SwapGroupContext): { reviewed_context_hash?: string } {
  if (!canApproveSwapContext(row)) throw new Error("Both employees must confirm the current complete request before approval.");
  return row.swap_scope === "group" ? { reviewed_context_hash: row.group_context_hash! } : {};
}

export function swapBlocksHours(blocks: readonly SwapBlock[]): number {
  return blocks.reduce((sum, block) => sum + (Date.parse(block.ends_at) - Date.parse(block.starts_at)) / 3600000, 0);
}

export function swapBlockLabel(block: SwapBlock): string {
  return `${block.service_date} · ${formatAssignmentInterval(block)}`;
}

export async function confirmSwapParticipation(client: Pick<SupabaseClient, "rpc">, row: SwapGroupContext & { id: string }): Promise<void> {
  if (!hasCompleteSwapContext(row)) throw new Error("The complete shift group is unavailable. Reload before confirming.");
  const result = row.swap_scope === "group"
    ? await client.rpc("confirm_shift_swap_group", { p_id: row.id, p_expected_context_hash: row.group_context_hash })
    : await client.rpc("confirm_shift_swap", { p_id: row.id });
  if (result.error) throw new Error(result.error.message);
}

/** Stale proposals can be cancelled without re-resolving or overwriting their original evidence. */
export async function cancelSwapGroup(client: Pick<SupabaseClient, "from">, id: string): Promise<void> {
  const result = await client.from("shift_swap_requests").update({ status: "cancelled" })
    .eq("id", id).eq("swap_scope", "group").in("status", ["pending", "claimed"]).is("deleted_at", null).select("id").single();
  if (result.error) throw new Error(result.error.message);
}

/** Intact managed groups are one choice. Unmanaged assignments remain explicit single choices. */
export function shiftSwapOptions<T extends { assignment_id: string; staff_id?: string; group_id: string | null; block_index: number | null; block_count?: number | null; starts_at: string; ends_at: string }>(rows: readonly T[]) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = row.group_id ? `${row.staff_id}:${row.group_id}` : row.assignment_id;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()].flatMap((members) => {
    const blocks = members.slice().sort((a, b) => (a.block_index ?? 0) - (b.block_index ?? 0));
    const anchor = blocks[0];
    if (anchor.group_id && (blocks.length !== anchor.block_count || blocks.some((block, index) => block.block_index !== index || block.block_count !== blocks.length))) return [];
    return [{ anchor, blocks, scope: (blocks.length > 1 ? "group" : "assignment") as "group" | "assignment", hours: blocks.reduce((sum, row) => sum + (Date.parse(row.ends_at) - Date.parse(row.starts_at)) / 3600000, 0) }];
  });
}
