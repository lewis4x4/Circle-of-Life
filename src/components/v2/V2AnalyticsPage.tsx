import { notFound } from "next/navigation";

import { uiV2 } from "@/lib/flags";
import { loadV2Analytics, type V2AnalyticsId } from "@/lib/v2-analytics";

import { W3AnalyticsClient } from "./W3AnalyticsClient";

export async function V2AnalyticsPage({
  analyticsId,
  contextId,
}: {
  analyticsId: V2AnalyticsId;
  contextId?: string;
}) {
  if (!uiV2()) notFound();
  const load = await loadV2Analytics(analyticsId, { contextId });
  return <W3AnalyticsClient load={load} />;
}
