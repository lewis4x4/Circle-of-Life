import { SettingsShell } from "@/components/v2/settings/SettingsShell";
import { ThresholdsEditor } from "@/components/v2/settings/ThresholdsEditor";
import { loadV2Thresholds } from "@/lib/v2-thresholds";

export async function ThresholdsSettingsPage() {
  const load = await loadV2Thresholds();

  return (
    <SettingsShell
      activeId="thresholds"
      title="Threshold targets"
      subtitle="Per-facility metric thresholds. Drives red/amber/green callouts across W1 dashboards and W2 lists."
      sections={[
        {
          id: "thresholds-editor",
          label: "Targets by facility",
          description:
            "Editing requires the owner or org_admin role; updates take effect on the next dashboard load.",
          body: <ThresholdsEditor load={load} />,
        },
      ]}
    />
  );
}
