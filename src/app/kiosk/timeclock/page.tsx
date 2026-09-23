import { redirect } from "next/navigation";

/** The COL-352 kiosk moved into the front-door kiosk (COL-692, spec 40 §7). */
export default function TimeclockKioskPage() {
  redirect("/kiosk/staff");
}
