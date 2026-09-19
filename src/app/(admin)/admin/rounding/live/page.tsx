import { redirect } from "next/navigation";

/**
 * `/admin/rounding/live` is where the Live board used to live. The board is now
 * the hub root, so this route keeps every link, bookmark and caregiver-facing
 * reference that pointed at it working rather than answering a 404.
 */
export default function AdminRoundingLiveRedirect() {
  redirect("/admin/rounding");
}
