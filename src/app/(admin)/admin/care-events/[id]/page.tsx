import { AdminCareEventPageClient } from "@/components/care-events/admin/AdminCareEventPageClient";

type AdminCareEventPageProps = {
  params: Promise<{ id: string }>;
};

/**
 * The Administrator's card and completion form (spec 07A §5, §6.4).
 * Linked from the push notification deep link and the incident detail page.
 */
export default async function AdminCareEventPage({ params }: AdminCareEventPageProps) {
  const { id } = await params;
  return <AdminCareEventPageClient careEventId={id} />;
}
