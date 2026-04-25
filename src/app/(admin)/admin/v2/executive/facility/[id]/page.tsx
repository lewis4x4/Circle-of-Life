import { V2AnalyticsPage } from "@/components/v2/V2AnalyticsPage";

export const dynamic = "force-dynamic";

export default async function FacilityDeepDivePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <V2AnalyticsPage analyticsId="facility-deep-dive" contextId={id} />;
}
