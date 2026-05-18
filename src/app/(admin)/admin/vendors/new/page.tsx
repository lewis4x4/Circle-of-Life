import { redirect } from "next/navigation";

/** Canonical entrypoint for “create vendor”; directory hosts the inline creator. */
export default function AdminVendorNewPage() {
  redirect("/admin/vendors/directory");
}
