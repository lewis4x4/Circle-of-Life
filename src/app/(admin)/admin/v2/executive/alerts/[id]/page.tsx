import { redirect } from "next/navigation";
export default async function AlertDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/admin/executive/alerts#alert-${encodeURIComponent(id)}`);
}
