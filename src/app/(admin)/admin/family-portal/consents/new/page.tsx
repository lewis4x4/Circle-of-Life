import { redirect } from "next/navigation";

/** Create flow is not shipped. Bookmarks return to Family Connections. */
export default function FamilyPortalConsentNewStubPage() {
  redirect("/admin/family-portal");
}
