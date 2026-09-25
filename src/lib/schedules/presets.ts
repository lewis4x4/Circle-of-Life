import type { SupabaseClient } from "@supabase/supabase-js";
import { Constants, type Database } from "@/types/database";
import { readAllPages } from "@/lib/supabase/read-all-pages";
import { UUID_STRING_RE } from "@/lib/supabase/env";

export type PresetBlock = { start: string; end: string };
export type SchedulePreset = {
  id: string; facility_id: string; organization_id: string; label: string; color: string;
  allowed_staff_roles: string[]; rounding_coverage: boolean; sort_order: number; active: boolean; blocks: PresetBlock[];
  version: number; roster_shift_type: Database["public"]["Enums"]["shift_type"];
  source_shift_definition_id?: string | null; deleted_at?: string | null;
};
export type SaveSchedulePresetInput = {
  facilityId: string; presetId: string | null; expectedVersion: number; label: string; color: string;
  sortOrder: number; roundingCoverage: boolean; blocks: PresetBlock[]; allowedStaffRoles: string[]; active: boolean; deleted?: boolean;
};
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const HEX = /^#[0-9a-f]{6}$/i;
const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const FALLBACK_COLOR = "#64748B";

/** Every block starts on the cell date. Overnight spill belongs to that same block. */
export function validatePresetBlocks(blocks: readonly PresetBlock[]): { valid: boolean; errors: string[]; totalMinutes: number | null } {
  const errors: string[] = [];
  if (!Array.isArray(blocks) || blocks.length < 1 || blocks.length > 8) return { valid: false, errors: ["Add between one and eight work blocks."], totalMinutes: null };
  let previousEnd = -1, total = 0;
  blocks.forEach((block, index) => {
    if (!block || typeof block !== "object" || Object.keys(block).length !== 2 || !TIME.test(block.start) || !TIME.test(block.end)) { errors.push(`Block ${index + 1}: choose a start and finish time.`); return; }
    const start = minutes(block.start), end = minutes(block.end);
    if (start === end) errors.push(`Block ${index + 1}: start and finish must be different.`);
    if (start < previousEnd) errors.push(`Block ${index + 1}: place blocks in start-time order without overlap, including overnight spill.`);
    const resolvedEnd = end < start ? end + 1440 : end;
    total += resolvedEnd - start;
    previousEnd = resolvedEnd;
  });
  return { valid: errors.length === 0, errors, totalMinutes: errors.length ? null : total };
}

export function roleAllowsPreset(preset: SchedulePreset, staffRole: string | null | undefined): boolean {
  return preset.active && !preset.deleted_at && !!staffRole && preset.allowed_staff_roles.includes(staffRole);
}

/** Choose the higher WCAG contrast of black/white; arbitrary valid brand colors stay readable. */
export function presetColorForeground(color: string): "#000000" | "#ffffff" {
  const safe = HEX.test(color) ? color : FALLBACK_COLOR;
  const rgb = [1, 3, 5].map((offset) => parseInt(safe.slice(offset, offset + 2), 16) / 255).map((channel) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
  const luminance = .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
  return (luminance + .05) / .05 >= 1.05 / (luminance + .05) ? "#000000" : "#ffffff";
}
export function presetColorStyle(color: string): { backgroundColor: string; color: string } {
  const backgroundColor = HEX.test(color) ? color : FALLBACK_COLOR;
  return { backgroundColor, color: presetColorForeground(backgroundColor) };
}
export function canManageSchedulePresets(appRole: string | null | undefined): boolean {
  return !!appRole && ["owner", "org_admin", "facility_admin", "manager"].includes(appRole);
}

export async function loadSchedulePresets(client: SupabaseClient<Database>, facilityId: string, options: { includeInactive?: boolean } = {}): Promise<SchedulePreset[]> {
  if (!UUID_STRING_RE.test(facilityId)) throw new Error("A valid facility is required.");
  const result = await readAllPages<SchedulePreset>(async (from, to) => {
    let query = client.from("facility_schedule_presets" as never).select("id,facility_id,organization_id,label,color,allowed_staff_roles,rounding_coverage,sort_order,active,blocks,version,roster_shift_type,source_shift_definition_id,deleted_at", { count: "exact" }).eq("facility_id", facilityId).is("deleted_at", null);
    if (!options.includeInactive) query = query.eq("active", true);
    const page = await query.order("sort_order").order("id").range(from, to);
    return { data: page.data as unknown as SchedulePreset[] | null, count: page.count, error: page.error };
  });
  return result.data;
}
export async function saveSchedulePreset(client: Pick<SupabaseClient<Database>, "rpc">, input: SaveSchedulePresetInput): Promise<SchedulePreset> {
  const result = validatePresetBlocks(input.blocks);
  if (!result.valid) throw new Error(result.errors.join(" "));
  if (!UUID_STRING_RE.test(input.facilityId) || (input.presetId !== null && !UUID_STRING_RE.test(input.presetId))) throw new Error("A valid facility and shift option are required.");
  if (!input.label.trim() || input.label.trim().length > 60) throw new Error("Use a shift label between 1 and 60 characters.");
  if (!HEX.test(input.color)) throw new Error("Choose a six-digit color, such as #64748B.");
  if (!Number.isInteger(input.sortOrder) || input.sortOrder < 0 || input.sortOrder > 10000) throw new Error("Display order must be a whole number from 0 to 10000.");
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0 || (!input.presetId && input.expectedVersion !== 0)) throw new Error("Reload this option before saving its version.");
  if (!input.allowedStaffRoles.length || input.allowedStaffRoles.some((role) => !(Constants.public.Enums.staff_role as readonly string[]).includes(role))) throw new Error("Select at least one valid staff job role.");
  if (typeof input.roundingCoverage !== "boolean") throw new Error("Choose whether this option supplies resident check coverage.");
  const { data, error } = await client.rpc("schedule_preset_save" as never, { p_facility_id: input.facilityId, p_preset_id: input.presetId, p_expected_version: input.expectedVersion, p_label: input.label.trim(), p_color: input.color.toUpperCase(), p_sort_order: input.sortOrder, p_blocks: input.blocks, p_allowed_staff_roles: [...new Set(input.allowedStaffRoles)], p_active: input.active, p_rounding_coverage: input.roundingCoverage, p_deleted: input.deleted ?? false } as never);
  if (error) throw new Error(error.message);
  if (!data || typeof data !== "object" || Array.isArray(data) || !("id" in data)) throw new Error("The saved shift option was not returned. Reload before trying again.");
  return data as unknown as SchedulePreset;
}
