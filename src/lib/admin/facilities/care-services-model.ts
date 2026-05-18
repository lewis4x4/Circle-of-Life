/**
 * AHCA-assisted living license pathway is mutually exclusive within CARE_LICENSE_SCOPE;
 * respite/adult-day are layered service offerings alongside the pathway.
 */

import {
  CARE_LICENSE_SCOPE,
  CARE_SERVICE_ADDONS,
  type CareLicenseScope,
  type CareServiceAddon,
} from "@/lib/admin/facilities/facility-constants";

export type { CareLicenseScope, CareServiceAddon };

export function isCareLicenseScopeKey(v: string): v is CareLicenseScope {
  return (CARE_LICENSE_SCOPE as readonly string[]).includes(v);
}

export function isCareAddonServiceKey(v: string): v is CareServiceAddon {
  return (CARE_SERVICE_ADDONS as readonly string[]).includes(v as CareServiceAddon);
}

export function parseCareServicesArray(
  arr: string[] | null | undefined,
  alfLicenseTypeFallback: string | null | undefined,
): { scopeKey: CareLicenseScope | null; addonKeys: CareServiceAddon[] } {
  const uniq = [...new Set((arr ?? []).map((x) => String(x).trim()).filter(Boolean))];
  const addonKeys = uniq.filter((x): x is CareServiceAddon => isCareAddonServiceKey(x));
  const scopes = uniq.filter((x): x is CareLicenseScope => isCareLicenseScopeKey(x));
  let scopeKey: CareLicenseScope | null = scopes[0] ?? null;

  if (!scopeKey && typeof alfLicenseTypeFallback === "string" && isCareLicenseScopeKey(alfLicenseTypeFallback)) {
    scopeKey = alfLicenseTypeFallback;
  }
  return { scopeKey, addonKeys };
}

export function buildCareServicesPayload(scopeKey: CareLicenseScope, addonKeys: CareServiceAddon[]): string[] {
  const sortedAddons = [...addonKeys].sort();
  return [scopeKey, ...sortedAddons];
}
