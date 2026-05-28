import { notFound } from "next/navigation";

import { ThresholdsSettingsPage } from "@/components/v2/settings/ThresholdsSettingsPage";
import { uiV2 } from "@/lib/flags";

export const dynamic = "force-dynamic";

export default async function SettingsThresholdsPage() {
  if (!uiV2()) notFound();
  return <ThresholdsSettingsPage />;
}
