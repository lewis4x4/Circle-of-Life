import type { FamilyDeliveryMethod } from "@/lib/admin/family-messages-data";

export function formatFamilyDeliveryMethod(method: FamilyDeliveryMethod | string): string {
  switch (method) {
    case "portal_only":
      return "Portal only";
    case "portal_and_email":
      return "Portal and email";
    case "portal_and_sms":
      return "Portal and SMS";
    case "portal_and_call":
      return "Portal and call";
    default:
      return method.replace(/_/g, " ");
  }
}

export function formatFamilyPortalTimestamp(isoOrLabel: string): string {
  const parsed = new Date(isoOrLabel);
  if (Number.isNaN(parsed.getTime())) return isoOrLabel;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  }).format(parsed);
}
