"use client";

/**
 * Canonical phone dialing primitive for admin surfaces — `tel:` + national format + handset icon.
 * Re-exports `@/components/common/phone-link` without duplicating dialing rules.
 */

export {
  digitsOnly,
  formatPhoneNational,
  PhoneLink as PhoneDialLink,
  toTelHref,
} from "@/components/common/phone-link";
