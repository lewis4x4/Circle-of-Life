import { V2DashboardPage } from "@/components/v2/V2DashboardPage";

export const dynamic = "force-dynamic";

export default async function RoundingDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <V2DashboardPage dashboardId="rounding-operations" searchParams={searchParams} />;
}
