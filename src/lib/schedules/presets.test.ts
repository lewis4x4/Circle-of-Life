import { describe, expect, it, vi } from "vitest";
import { canManageSchedulePresets, loadSchedulePresets, presetColorForeground, presetColorStyle, roleAllowsPreset, saveSchedulePreset, validatePresetBlocks, type SchedulePreset } from "./presets";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
const FACILITY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const preset: SchedulePreset = { id: ID, organization_id: "org", facility_id: FACILITY, label: "Kitchen split", color: "#128865", allowed_staff_roles: ["cook"], rounding_coverage: false, sort_order: 2, active: true, blocks: [{ start: "06:00", end: "13:00" }, { start: "16:00", end: "18:00" }], version: 3, roster_shift_type: "custom" };
describe("facility schedule presets", () => {
  it("totals blocks excluding gaps, supports overnight and rejects unordered/overlapping spill", () => {
    expect(validatePresetBlocks(preset.blocks)).toEqual({ valid: true, errors: [], totalMinutes: 540 });
    expect(validatePresetBlocks([{ start: "22:00", end: "06:00" }]).totalMinutes).toBe(480);
    for (const blocks of [[{ start: "", end: "" }], [{ start: "08:00", end: "08:00" }], [{ start: "06:00", end: "13:00" }, { start: "12:00", end: "18:00" }], [{ start: "22:00", end: "06:00" }, { start: "07:00", end: "09:00" }], []]) expect(validatePresetBlocks(blocks).valid).toBe(false);
    expect(validatePresetBlocks(Array.from({ length: 9 }, () => ({ start: "00:00", end: "01:00" }))).valid).toBe(false);
  });
  it("matches explicit staff job roles, preserving separate manager capability", () => {
    expect(roleAllowsPreset(preset, "cook")).toBe(true); expect(roleAllowsPreset(preset, "manager")).toBe(false);
    expect(roleAllowsPreset({ ...preset, allowed_staff_roles: ["medication_tech"] }, "med_tech")).toBe(false);
    expect(roleAllowsPreset({ ...preset, active: false }, "cook")).toBe(false);
    expect(roleAllowsPreset({ ...preset, deleted_at: "2026-09-24" }, "cook")).toBe(false);
    expect(canManageSchedulePresets("manager")).toBe(true); expect(canManageSchedulePresets("cook")).toBe(false);
  });
  it("keeps arbitrary valid colors readable and refuses unsafe CSS", () => {
    expect(presetColorForeground("#ffffff")).toBe("#000000"); expect(presetColorForeground("#000000")).toBe("#ffffff");
    expect(presetColorStyle("#ffee00")).toEqual({ backgroundColor: "#ffee00", color: "#000000" });
    expect(presetColorStyle("url(evil)").backgroundColor).toBe("#64748B");
  });
  it("saves the exact facility, role and expected-version contract and surfaces conflicts", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: preset, error: null }).mockResolvedValueOnce({ data: null, error: { message: "Shift option changed. Reload before saving." } });
    const client = { rpc } as unknown as SupabaseClient<Database>;
    const input = { facilityId: FACILITY, presetId: ID, expectedVersion: 3, label: "Kitchen split", color: "#128865", sortOrder: 2, roundingCoverage: false, blocks: preset.blocks, allowedStaffRoles: ["cook"], active: true };
    expect(await saveSchedulePreset(client, input)).toEqual(preset);
    expect(rpc).toHaveBeenCalledWith("schedule_preset_save", { p_facility_id: FACILITY, p_preset_id: ID, p_expected_version: 3, p_label: "Kitchen split", p_color: "#128865", p_sort_order: 2, p_blocks: preset.blocks, p_allowed_staff_roles: ["cook"], p_active: true, p_rounding_coverage: false, p_deleted: false });
    await expect(saveSchedulePreset(client, input)).rejects.toThrow("Reload before saving");
    rpc.mockResolvedValueOnce({ data: { ...preset, rounding_coverage: true }, error: null });
    await saveSchedulePreset(client, { ...input, roundingCoverage: true });
    expect(rpc).toHaveBeenLastCalledWith("schedule_preset_save", expect.objectContaining({ p_rounding_coverage: true }));
    await expect(saveSchedulePreset(client, { ...input, allowedStaffRoles: [] })).rejects.toThrow("job role");
  });
  it("loads all pages within one facility, including inactive only when requested", async () => {
    const eq = vi.fn(), rows = [preset, { ...preset, id: "two" }, { ...preset, id: "three" }];
    const builder = { select: () => builder, eq: (key: string, value: unknown) => { eq(key, value); return builder; }, is: () => builder, order: () => builder, range: async (from: number) => ({ data: [rows[from]], count: 3, error: null }) };
    const client = { from: () => builder } as unknown as SupabaseClient<Database>;
    expect(await loadSchedulePresets(client, FACILITY, { includeInactive: true })).toHaveLength(3);
    expect(eq).toHaveBeenCalledWith("facility_id", FACILITY); expect(eq).not.toHaveBeenCalledWith("active", true);
    await loadSchedulePresets(client, FACILITY); expect(eq).toHaveBeenCalledWith("active", true);
  });
});
