import { useState } from "react";
import { CadenceConfigurationEditor } from "@/components/rounding/CadenceConfigurationEditor";
import { CadenceRungEditor } from "@/components/rounding/CadenceRungEditor";
import { CadenceTemplatePortfolio } from "@/components/rounding/CadenceTemplatePortfolio";
import type { ConfigurationSnapshot, RungDraft } from "@/lib/rounding/cadence-settings";

export function SettingsFixture() {
  const [configuration, setConfiguration] = useState<ConfigurationSnapshot>({ shifts: [{ shift_key: "day", label: "Day", starts_at_local: "06:00", ends_at_local: "18:00", roster_shift_type: "day", enabled: true, sort_order: 0 }], monitoring_interval_presets_minutes: [30, 60], monitoring_grace_divisor: 4, watchlist_rules: [{ signal_key: "fixture", label: "Fixture signal", threshold_count: 2, lookback_days: 7, severity_class: "elevated", enabled: true }], thresholds: { maximum_unobserved_gap_minutes: 240, maximum_windows_per_resident_per_day: 8, simulation_lookback_days: 14, change_log_page_size: 10 } });
  const [rung, setRung] = useState<RungDraft>({ rung_key: "final", label: "Final escalation", offset_minutes: 90, is_terminal: true, assigned_staff_only: false, include_assigned_staff: true, use_standing_alert_routes: false, target_staff_roles: ["administrator"], channels: ["in_app"], protocol_text: "Call the on-call lead", sort_order: 0, enabled: true, shift_overrides: [] });
  const windows = [{ window_key: "morning", label: "Morning check", due_at_local: "08:00", grace_before_minutes: 0, grace_after_minutes: 30, shift_key: "day", sort_order: 0, enabled: true }];
  return <>
    <CadenceConfigurationEditor value={configuration} onChange={setConfiguration} disabled={false} />
    <CadenceRungEditor draft={rung} onChange={setRung} channels={["in_app", "push"]} roles={[{ staff_role: "administrator", holder_count: 1 }]} shifts={configuration.shifts.map((shift) => ({ ...shift, starts_minute: 360, ends_minute: 1080 }))} />
    <CadenceTemplatePortfolio facilityId="fixture-a" windows={windows} rungs={[rung]} />
  </>;
}
