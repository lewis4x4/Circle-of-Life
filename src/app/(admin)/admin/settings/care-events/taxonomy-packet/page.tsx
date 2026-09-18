import { TaxonomyPacketPageClient } from "@/components/care-events/print/TaxonomyPacketPageClient";

/**
 * The taxonomy review packet the owner and the compliance reviewer sign against
 * before Homewood's paper incident form and fax are retired (COL-354).
 * Owner and org_admin only; `care_event_print_record` refuses anyone else
 * before the sheet renders.
 */
export default function TaxonomyPacketPage() {
  return <TaxonomyPacketPageClient />;
}
