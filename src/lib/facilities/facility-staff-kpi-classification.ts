import { facilityDateIsoDaysFromToday, todayFacilityDateIso } from "@/lib/facility-wall-clock";

export type StaffCertBucket = "current" | "expiring" | "expired";

/** Eastern calendar today + 30-day window for cert and background-check KPIs. */
export function getFacilityStaffKpiDateWindow(now: Date = new Date()) {
  const today = todayFacilityDateIso(now);
  const plus30 = facilityDateIsoDaysFromToday(30, now);
  return { today, plus30 };
}

export function classifyStaffCertification(
  expirationDate: string | null,
  status: string,
  now: Date = new Date(),
): StaffCertBucket {
  const { today, plus30 } = getFacilityStaffKpiDateWindow(now);

  if (status === "expired" || status === "revoked") return "expired";
  if (expirationDate && expirationDate < today) return "expired";
  if (status === "pending_renewal") return "expiring";
  if (expirationDate && expirationDate >= today && expirationDate <= plus30) return "expiring";
  return "current";
}

export function isBackgroundCheckExpiringWithin30Days(
  expiresAt: string | null,
  now: Date = new Date(),
): boolean {
  const { today, plus30 } = getFacilityStaffKpiDateWindow(now);
  const exp = expiresAt?.slice(0, 10);
  if (!exp) return false;
  return exp >= today && exp <= plus30;
}
