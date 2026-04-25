import { V2DetailPage } from "@/components/v2/V2DetailPage";

export const dynamic = "force-dynamic";

export default async function ResidentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <V2DetailPage listId="residents" recordId={id} />;
}
