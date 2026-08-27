import { redirect } from "next/navigation";

/** Create flow is not shipped. Bookmarks return to the conferences list. */
export default function FamilyPortalConferenceNewStubPage() {
  redirect("/admin/family-portal#care-conferences");
}
