import { V2ListPage } from "@/components/v2/V2ListPage";

export const dynamic = "force-dynamic";

export default async function ResidentsListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <V2ListPage listId="residents" searchParams={searchParams} />;
}
