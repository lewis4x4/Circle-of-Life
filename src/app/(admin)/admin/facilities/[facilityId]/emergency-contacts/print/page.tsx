import { redirect } from "next/navigation";

/**
 * The emergency list print sheet moved out of the app shell to
 * /print/facilities/[facilityId]/emergency-contacts (COL-662). Bookmarks to the
 * old address still land on the sheet.
 */
export default async function LegacyEmergencyContactsPrintRedirect({
  params,
}: {
  params: Promise<{ facilityId: string }>;
}) {
  const { facilityId } = await params;
  redirect(`/print/facilities/${encodeURIComponent(facilityId)}/emergency-contacts`);
}
