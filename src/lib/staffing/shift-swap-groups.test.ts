import { describe, expect, it, vi } from "vitest";
import { canApproveSwapContext, cancelSwapGroup, swapApprovalContext, confirmSwapParticipation, hasCompleteSwapContext, shiftSwapOptions, swapBlocksHours, swapPartyConfirmed, type SwapBlock, type SwapGroupContext } from "./shift-swap-groups";

const blocks: SwapBlock[] = [
  { assignment_id: "am", staff_id: "person", group_id: "cook", block_index: 0, block_count: 2, service_date: "2026-09-24", starts_at: "2026-09-24T10:00:00Z", ends_at: "2026-09-24T17:00:00Z", label: "Cook", color: "#008000", time_zone: "America/New_York", staff_role: "dietary_staff" },
  { assignment_id: "pm", staff_id: "person", group_id: "cook", block_index: 1, block_count: 2, service_date: "2026-09-24", starts_at: "2026-09-24T20:00:00Z", ends_at: "2026-09-24T22:00:00Z", label: "Cook", color: "#008000", time_zone: "America/New_York", staff_role: "dietary_staff" },
];
const group: SwapGroupContext & { id: string } = { id: "swap", swap_scope: "group", requesting_group_snapshot: blocks, covering_group_snapshot: [], group_context_hash: "current" };

describe("whole-group swap consent", () => {
  it("makes two split blocks one choice with nine hours and rejects a partial option", () => {
    const options = shiftSwapOptions(blocks);
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ scope: "group", hours: 9 });
    expect(options[0].blocks).toHaveLength(2);
    expect(shiftSwapOptions([blocks[1]])).toEqual([]);
    expect(swapBlocksHours(blocks)).toBe(9);
  });
  it("confirms the exact reviewed hash with the group-only RPC", async () => {
    const rpc = vi.fn(async () => ({ data: "swap", error: null }));
    await confirmSwapParticipation({ rpc } as never, group);
    expect(rpc).toHaveBeenCalledWith("confirm_shift_swap_group", { p_id: "swap", p_expected_context_hash: "current" });
  });
  it("retains the legacy single confirmation RPC without silently expanding scope", async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    await confirmSwapParticipation({ rpc } as never, { id: "single" });
    expect(rpc).toHaveBeenCalledWith("confirm_shift_swap", { p_id: "single" });
  });
  it("refuses incomplete group evidence before confirmation or approval", async () => {
    const rpc = vi.fn();
    const partial = { ...group, requesting_group_snapshot: [blocks[0]], requesting_confirmed_at: "now", covering_confirmed_at: "now", requesting_context_hash: "current", covering_context_hash: "current" };
    expect(hasCompleteSwapContext(partial)).toBe(false);
    expect(canApproveSwapContext(partial)).toBe(false);
    await expect(confirmSwapParticipation({ rpc } as never, partial)).rejects.toThrow("complete shift group");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("requires both parties to confirm the current hash, even when old timestamps exist", () => {
    const stale = { ...group, requesting_confirmed_at: "now", covering_confirmed_at: "now", requesting_context_hash: "old", covering_context_hash: "current" };
    expect(swapPartyConfirmed(stale, "requesting")).toBe(false);
    expect(canApproveSwapContext(stale)).toBe(false);
    expect(canApproveSwapContext({ ...stale, requesting_context_hash: "current" })).toBe(true);
  });
  it("persists the manager's reviewed hash and refuses partial consent", () => {
    expect(() => swapApprovalContext(group)).toThrow("Both employees");
    expect(swapApprovalContext({ ...group, requesting_confirmed_at: "now", covering_confirmed_at: "now", requesting_context_hash: "current", covering_context_hash: "current" })).toEqual({ reviewed_context_hash: "current" });
    expect(swapApprovalContext({ requesting_confirmed_at: "now", covering_confirmed_at: "now" })).toEqual({});
  });
  it("cancels a stale group without requiring or rewriting its old snapshots", async () => {
    const update = vi.fn(); const conditions: unknown[] = [];
    const query = { update: (value: unknown) => { update(value); return query; }, eq: (...args: unknown[]) => { conditions.push(args); return query; }, in: (...args: unknown[]) => { conditions.push(args); return query; }, is: () => query, select: () => query, single: async () => ({ data: { id: "stale" }, error: null }) };
    await cancelSwapGroup({ from: () => query } as never, "stale");
    expect(update).toHaveBeenCalledWith({ status: "cancelled" });
    expect(conditions).toContainEqual(["status", ["pending", "claimed"]]);
    expect(conditions).toContainEqual(["swap_scope", "group"]);
  });
  it("surfaces stale-hash rejection without retrying a different scope", async () => {
    const rpc = vi.fn(async () => ({ error: { message: "Group changed. Reload." } }));
    await expect(confirmSwapParticipation({ rpc } as never, group)).rejects.toThrow("Group changed");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
