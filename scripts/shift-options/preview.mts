// Actual UI and interval math with explicitly synthetic, local persistence.
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { scheduleWallTime } from "../../src/lib/schedules/week-grid";
import { addFacilityCalendarDays } from "../../src/lib/facility-wall-clock";
import type { SchedulePreset } from "../../src/lib/schedules/presets";
const root = process.cwd(), here = path.join(root, "scripts/shift-options"), run = process.env.SHIFT_RUN_DIR;
if (!run?.includes("/.hermes/tmp/agent-runs/")) throw new Error("Owned scratch path required");
const facility = "11111111-1111-4111-8111-111111111111", weekId = "33333333-3333-4333-8333-333333333333", userId = "44444444-4444-4444-8444-444444444444", org = "55555555-5555-4555-8555-555555555555";
const people = [
  { id: "22222222-2222-4222-8222-222222222221", facility_id: facility, first_name: "Casey", last_name: "Care", staff_role: "medication_tech", employment_status: "active", user_id: "44444444-4444-4444-8444-444444444441", role_assignments: [] },
  { id: "22222222-2222-4222-8222-222222222222", facility_id: facility, first_name: "Riley", last_name: "Cook", staff_role: "cook", employment_status: "active", user_id: userId, role_assignments: [] },
  { id: "22222222-2222-4222-8222-222222222223", facility_id: facility, first_name: "Alex", last_name: "Admin", staff_role: "administrator", employment_status: "active", user_id: "44444444-4444-4444-8444-444444444443", role_assignments: [] },
];
const presets: SchedulePreset[] = [
  { id: "66666666-6666-4666-8666-666666666661", organization_id: org, facility_id: facility, label: "Day", color: "#F9A8D4", allowed_staff_roles: ["medication_tech"], rounding_coverage: true, blocks: [{ start: "06:00", end: "18:00" }], sort_order: 0, active: true, version: 1, roster_shift_type: "day" },
  { id: "66666666-6666-4666-8666-666666666662", organization_id: org, facility_id: facility, label: "Night", color: "#93C5FD", allowed_staff_roles: ["medication_tech"], rounding_coverage: true, blocks: [{ start: "18:00", end: "06:00" }], sort_order: 1, active: true, version: 1, roster_shift_type: "night" },
  { id: "66666666-6666-4666-8666-666666666663", organization_id: org, facility_id: facility, label: "Cook split", color: "#4ADE80", allowed_staff_roles: ["cook"], rounding_coverage: false, blocks: [{ start: "06:00", end: "13:00" }, { start: "16:00", end: "18:00" }], sort_order: 2, active: true, version: 1, roster_shift_type: "custom" },
  { id: "66666666-6666-4666-8666-666666666664", organization_id: org, facility_id: facility, label: "Office", color: "#18181B", allowed_staff_roles: ["administrator"], rounding_coverage: false, blocks: [{ start: "09:00", end: "17:00" }], sort_order: 3, active: true, version: 1, roster_shift_type: "custom" },
];
const week = { id: weekId, organization_id: org, facility_id: facility, week_start_date: "2026-09-28", status: "draft", updated_at: new Date().toISOString(), published_at: null as string | null, notes: null };
let assignments: Record<string, unknown>[] = [];
let writes = 0;
function intervals() { return week.status !== "published" ? [] : assignments.filter((a) => !a.deleted_at).map((a) => ({ assignment_id: a.id, schedule_id: weekId, staff_id: a.staff_id, facility_id: facility, service_date: a.shift_date, starts_at: a.schedule_starts_at, ends_at: a.schedule_ends_at, time_zone: "America/New_York", preset_id: a.schedule_preset_id, preset_version: a.schedule_preset_version, label: a.schedule_preset_name, color: a.schedule_preset_color, staff_role: a.schedule_role_snapshot, group_id: a.schedule_group_id, block_index: a.schedule_block_index, block_count: a.schedule_block_count, legacy_shift_type: a.shift_type, status: a.status, is_legacy: false })); }
function queryRows(table: string, args: Record<string, unknown> = {}) {
  if (table === "schedules") return [week];
  if (table === "facilities") return [{ id: facility, name: "Synthetic east facility", timezone: "America/New_York" }];
  if (table === "staff" || table === "schedule_people_for_week") return people;
  if (table === "facility_schedule_presets") return presets;
  if (table === "shift_assignments") return assignments.map((a) => ({ ...a, schedules: { status: week.status, deleted_at: null } }));
  if (table === "schedule_assignment_intervals") return intervals().filter((a) => (!args.p_staff_id || a.staff_id === args.p_staff_id) && (!args.p_facility_id || a.facility_id === args.p_facility_id) && Date.parse(String(a.ends_at)) > Date.parse(String(args.p_from)) && Date.parse(String(a.starts_at)) < Date.parse(String(args.p_to)));
  return [];
}
function mutate(name: string, args: Record<string, unknown>) {
  if (name === "schedule_preset_save") {
    const existing = presets.find((p) => p.id === args.p_preset_id);
    if ((existing?.version ?? 0) !== args.p_expected_version) throw new Error("This shift option changed. Reload before saving.");
    const saved = { ...existing, id: existing?.id ?? randomUUID(), facility_id: facility, organization_id: org, label: String(args.p_label), color: String(args.p_color), sort_order: Number(args.p_sort_order), blocks: args.p_blocks as SchedulePreset["blocks"], allowed_staff_roles: args.p_allowed_staff_roles as string[], rounding_coverage: args.p_rounding_coverage === true, active: args.p_active === true, version: (existing?.version ?? 0) + 1, roster_shift_type: existing?.roster_shift_type ?? "custom" as const };
    if (existing) presets.splice(presets.indexOf(existing), 1, saved); else presets.push(saved); writes++; return saved;
  }
  if (args.p_expected_updated_at !== week.updated_at) throw new Error("Schedule changed. Reload before saving.");
  if (name === "schedule_bulk_upsert") {
    if (week.status !== "draft") throw new Error("Published schedule is immutable");
    for (const cell of args.p_cells as Array<Record<string, unknown>>) {
      const person = people.find((p) => p.id === cell.staff_id)!;
      const preset = presets.find((p) => p.id === cell.preset_id);
      if (preset && (!preset.active || preset.version !== cell.expected_preset_version || !preset.allowed_staff_roles.includes(person.staff_role))) throw new Error("The selected option changed or does not apply to this job role.");
      assignments = assignments.filter((a) => !(a.staff_id === cell.staff_id && a.shift_date === cell.shift_date));
      const blocks = preset?.blocks ?? cell.custom_blocks as SchedulePreset["blocks"] | undefined ?? (cell.custom_start_time ? [{ start: String(cell.custom_start_time), end: String(cell.custom_end_time) }] : []);
      const group = randomUUID();
      for (const [index, block] of blocks.entries()) {
        const date = String(cell.shift_date), endDate = block.end < block.start ? addFacilityCalendarDays(date, 1, "America/New_York") : date;
        assignments.push({ id: randomUUID(), organization_id: org, facility_id: facility, schedule_id: weekId, staff_id: person.id, shift_date: date, shift_type: preset?.roster_shift_type ?? "custom", status: "assigned", deleted_at: null, custom_start_time: block.start, custom_end_time: block.end, shift_definition_id: null, notes: null, schedule_preset_id: preset?.id ?? null, schedule_preset_version: preset?.version ?? null, schedule_preset_name: preset?.label ?? "Custom", schedule_preset_color: preset?.color ?? "#64748B", schedule_role_snapshot: person.staff_role, schedule_rounding_coverage: preset?.rounding_coverage ?? cell.custom_rounding_coverage === true, schedule_time_zone: "America/New_York", schedule_starts_at: scheduleWallTime(date, block.start, "America/New_York")!.toISOString(), schedule_ends_at: scheduleWallTime(endDate, block.end, "America/New_York")!.toISOString(), schedule_group_id: group, schedule_block_index: index, schedule_block_count: blocks.length });
      }
    }
  } else if (name === "schedule_publish") { week.status = "published"; week.published_at = new Date().toISOString(); }
  else throw new Error(`Unsupported synthetic mutation ${name}`);
  writes++; week.updated_at = new Date(Date.now() + writes).toISOString(); return weekId;
}
const server = await createServer({ root: here, configFile: false, define: { "process.env": {} }, cacheDir: path.join(run, "vite-cache"), plugins: [react(), { name: "synthetic-shift-options", configureServer(server) {
  server.middlewares.use(async (req, res, next) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1:8950");
    if (!url.pathname.startsWith("/__fixture")) return next();
    res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store");
    try {
      if (url.pathname === "/__fixture/proof") { res.end(JSON.stringify({ week, presets, assignments, writes })); return; }
      if (url.pathname === "/__fixture/attendance") { res.end(JSON.stringify({ first_name: "Riley", state: "out", next_actions: ["in"], today_worked_minutes: 252, planned_context: { status: "ready", blocks: intervals().filter((a) => a.staff_id === people[1].id).map((a) => ({ label: a.label, color: a.color, starts_at: a.starts_at, ends_at: a.ends_at, time_zone: a.time_zone, block_index: a.block_index, block_count: a.block_count })) } })); return; }
      let raw = ""; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      if (url.pathname === "/__fixture/mutate") { res.end(JSON.stringify({ data: mutate(body.name, body.args), error: null })); return; }
      let rows = queryRows(body.table, body.args) as Array<Record<string, unknown>>;
      for (const f of body.filters ?? []) rows = rows.filter((row) => { const value = f.key.split(".").reduce((v: unknown, key: string) => (v as Record<string, unknown> | undefined)?.[key], row); if (f.op === "eq") return value === f.value; if (f.op === "is") return value == null; if (f.op === "in") return f.value.includes(value); if (f.op === "gte") return String(value) >= String(f.value); if (f.op === "lte") return String(value) <= String(f.value); return true; });
      const count = rows.length;
      if (body.single) res.end(JSON.stringify({ data: rows[0] ?? null, error: null }));
      else res.end(JSON.stringify({ data: rows.slice(body.from ?? 0, body.to == null ? undefined : body.to + 1), count, error: null }));
    } catch (error) { res.end(JSON.stringify({ data: null, error: { message: error instanceof Error ? error.message : "Synthetic fixture error" } })); }
  });
} }], resolve: { alias: [
  { find: "next/link", replacement: path.join(root, "scripts/workforce/fixture-link.tsx") }, { find: "next/navigation", replacement: path.join(here, "fixture-navigation.ts") },
  { find: "@/contexts/haven-auth-context", replacement: path.join(here, "fixture-auth.ts") }, { find: "@/components/workforce/WorkforceContext", replacement: path.join(here, "fixture-workforce.ts") },
  { find: "@/lib/supabase/client", replacement: path.join(here, "fixture-db.ts") }, { find: "@/lib/caregiver/facility-context", replacement: path.join(here, "fixture-context.ts") },
  { find: "@", replacement: path.join(root, "src") },
] }, css: { postcss: path.join(root, "postcss.config.mjs") }, server: { host: "127.0.0.1", port: 8950, strictPort: true, fs: { allow: [root] } }, logLevel: "error" });
await server.listen();
fs.writeFileSync(path.join(run, "preview.json"), JSON.stringify({ origin: "http://127.0.0.1:8950", synthetic_only: true, week: weekId, actual_components: true, hosted_auth_database: false }, null, 2));
console.log(`Shift options preview http://127.0.0.1:8950/admin/schedules/${weekId}`);
