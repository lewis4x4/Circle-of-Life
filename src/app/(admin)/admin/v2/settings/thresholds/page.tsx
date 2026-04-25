import { notFound } from "next/navigation";

import { SettingsShell } from "@/components/v2/settings/SettingsShell";
import { ThresholdsEditor } from "@/components/v2/settings/ThresholdsEditor";
import { uiV2 } from "@/lib/flags";
import { loadV2Thresholds } from "@/lib/v2-thresholds";

export const dynamic = "force-dynamic";

export default async function SettingsThresholdsPage() {
  if (!uiV2()) notFound();
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
