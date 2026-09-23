import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { SettingsShell } from "@/components/v2/settings/SettingsShell";
import { ThresholdsEditor } from "@/components/v2/settings/ThresholdsEditor";
import { loadV2Thresholds } from "@/lib/v2-thresholds";

export async function ThresholdsSettingsPage() {
  const load = await loadV2Thresholds();

  return (
    <div className="space-y-3">
      <Link
        href="/admin/settings"
        className="mx-auto flex w-full max-w-7xl items-center gap-1 px-4 pt-6 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground sm:px-6 lg:px-8"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Settings
      </Link>
      <SettingsShell
        activeId="thresholds"
        title="Threshold targets"
        subtitle="Per-facility metric thresholds. They set the red, amber and green callouts on dashboards and lists."
        sections={[
          {
            id: "thresholds-editor",
            label: "Targets by facility",
            description:
              "Only an owner or org admin can edit these; changes show the next time a dashboard loads.",
            body: <ThresholdsEditor load={load} />,
          },
        ]}
      />
    </div>
  );
}
