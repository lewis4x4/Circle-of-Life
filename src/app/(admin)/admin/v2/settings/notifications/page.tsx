import { notFound } from "next/navigation";

import { SettingsShell } from "@/components/v2/settings/SettingsShell";
import { uiV2 } from "@/lib/flags";

export const dynamic = "force-dynamic";

export default function SettingsNotificationsPage() {
  if (!uiV2()) notFound();

  return (
    <SettingsShell
      activeId="notifications"
      title="Notifications"
      subtitle="Per-user notification preferences."
      sections={[
        {
          id: "notifications-stub",
          label: "Coming in S11.5",
          description:
            "V2 notification preferences inherit the V1 surface for now. The V1 notification settings remain the canonical write path.",
          body: (
            <p className="text-sm text-text-secondary">
              Manage notifications in the existing V1 settings surface while the V2
              notifications editor is being authored. The V2 surface will reuse the
              same backing table when it lands so preferences carry over.
            </p>
          ),
        },
      ]}
    />
  );
}
