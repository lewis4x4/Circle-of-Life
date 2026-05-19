"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { useParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useFacility } from "@/hooks/useFacility";
import { useFacilityEmergencyContacts } from "@/hooks/useFacilityEmergencyContacts";
import { PhoneLink, formatPhoneNational } from "@/components/common/phone-link";
import type { ContactCategory } from "@/lib/admin/facilities/facility-constants";
import { CONTACT_CATEGORY_LABELS } from "@/lib/admin/facilities/facility-constants";
import { CATEGORY_GROUP, GROUP_ORDER, PARENT_GROUP_LABEL, type ParentGroupId } from "@/lib/admin/facilities/emergency-directory";

/**
 * Wall-post / clipboard printout. Open from Emergency Contacts → “Print emergency list”.
 * Browser print dialog hides most chrome; site shell may still appear depending on layout.
 */
export default function EmergencyContactsPrintPage() {
  const params = useParams<{ facilityId: string }>();
  const facilityId = typeof params.facilityId === "string" ? params.facilityId : "";
  const printed = useRef(false);

  const { facility, isLoading: facLoading } = useFacility(facilityId);
  const { contacts, isLoading: conLoading } = useFacilityEmergencyContacts(facilityId, {
    enabled: Boolean(facilityId),
  });

  const loading = facLoading || conLoading;

  const grouped = useMemo(() => {
    const map = new Map<ParentGroupId, typeof contacts>();
    for (const g of GROUP_ORDER) map.set(g, []);
    const rest: typeof contacts = [];
    for (const c of contacts) {
      const g = CATEGORY_GROUP[c.contact_category as ContactCategory];
      if (g && map.has(g)) map.get(g)!.push(c);
      else rest.push(c);
    }
    return { map, rest };
  }, [contacts]);

  useEffect(() => {
    if (loading || !facility || printed.current) return;
    printed.current = true;
    const t = window.setTimeout(() => window.print(), 250);
    return () => window.clearTimeout(t);
  }, [loading, facility]);

  if (!facilityId) {
    return <p className="p-6 text-sm text-destructive">Missing facility.</p>;
  }

  if (loading || !facility) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const addr = [facility.address_line_1, facility.city, facility.state, facility.zip]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="mx-auto max-w-3xl bg-white p-8 text-black print:p-6">
      <header className="border-b border-black pb-4">
        <h1 className="text-2xl font-bold">{facility.name}</h1>
        {addr ? <p className="mt-1 text-sm">{addr}</p> : null}
        <p className="mt-2 text-xs text-neutral-600">
          Verification summary: confirm quarterly with the licensing file; directory verification dates are not tracked here.
        </p>
        <p className="mt-1 text-xs text-neutral-600">Dial 911 for life-threatening emergencies.</p>
      </header>

      <div className="mt-6 space-y-6">
        {GROUP_ORDER.map((group) => {
          const list = grouped.map.get(group) ?? [];
          if (group !== "public_safety" && list.length === 0) return null;
          return (
            <section key={group} className="break-inside-avoid">
              <h2 className="border-b border-black pb-1 text-sm font-bold uppercase tracking-wide">
                {PARENT_GROUP_LABEL[group]}
              </h2>
              <ul className="mt-2 space-y-2">
                {group === "public_safety" ? (
                  <>
                    <li className="flex flex-wrap justify-between gap-2 text-sm">
                      <span>Poison Control (US)</span>
                      <span className="tabular-nums">{formatPhoneNational("1-800-222-1222")}</span>
                    </li>
                    <li className="flex flex-wrap justify-between gap-2 text-sm">
                      <span>Adult Protective Services (FL)</span>
                      <span className="tabular-nums">{formatPhoneNational("1-800-962-2873")}</span>
                    </li>
                  </>
                ) : null}
                {list.map((c) => (
                  <li key={c.id} className="flex flex-wrap justify-between gap-3 border-b border-neutral-200 py-2 text-sm last:border-b-0">
                    <div>
                      <p className="font-semibold">{c.contact_name}</p>
                      <p className="text-xs text-neutral-700">
                        {c.contact_category === "hospital"
                          ? "Closest receiving hospital / ER"
                          : CONTACT_CATEGORY_LABELS[c.contact_category as keyof typeof CONTACT_CATEGORY_LABELS] ??
                            c.contact_category}
                      </p>
                      {c.address ? <p className="text-xs text-neutral-600">{c.address}</p> : null}
                      {c.notes ? <p className="text-xs text-neutral-600">{c.notes}</p> : null}
                    </div>
                    <div className="shrink-0 text-right">
                      <PhoneLink phone={c.phone_primary} className="text-black print:text-black" />
                      {c.phone_secondary ? (
                        <div className="mt-1">
                          <PhoneLink phone={c.phone_secondary} className="text-black print:text-black" />
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}

        {grouped.rest.length > 0 ? (
          <section className="break-inside-avoid">
            <h2 className="border-b border-black pb-1 text-sm font-bold uppercase tracking-wide">Other</h2>
            <ul className="mt-2 space-y-2">
              {grouped.rest.map((c) => (
                <li key={c.id} className="flex flex-wrap justify-between gap-2 border-b border-neutral-200 py-2 text-sm">
                  <span className="font-medium">{c.contact_name}</span>
                  <PhoneLink phone={c.phone_primary} className="text-black" />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
