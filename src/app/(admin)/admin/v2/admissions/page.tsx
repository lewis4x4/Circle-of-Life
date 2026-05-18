import { V2ListPage } from "@/components/v2/V2ListPage";

export const dynamic = "force-dynamic";

export default async function AdmissionsListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <V2ListPage listId="admissions" searchParams={searchParams} />;
}
