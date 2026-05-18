import { V2ListPage } from "@/components/v2/V2ListPage";

export const dynamic = "force-dynamic";

export default async function IncidentsListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <V2ListPage listId="incidents" searchParams={searchParams} />;
}
