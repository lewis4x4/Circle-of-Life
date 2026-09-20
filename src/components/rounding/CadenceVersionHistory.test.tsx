import { describe, expect, it } from "vitest";
import type { ChangeLogEntry } from "@/lib/rounding/cadence-settings";
import { changedRows } from "./CadenceVersionHistory";

describe("policy history", () => {
  it.each(["protocol_text", "target_staff_roles", "include_assigned_staff", "use_standing_alert_routes", "shift_overrides", "sort_order"])("shows a %s-only change", (field) => {
    const before = { rung_key: "final", label: "Final", offset_minutes: 90, channels: ["in_app"], [field]: "before" };
    const after = { ...before, [field]: "after" };
    const rows = changedRows({ previous_rows: [before], rows: [after] } as ChangeLogEntry);
    expect(rows).toHaveLength(1);
    expect(rows[0].before).toContain("before");
    expect(rows[0].after).toContain("after");
  });
});
