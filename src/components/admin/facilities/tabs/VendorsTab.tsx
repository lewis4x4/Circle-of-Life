"use client";

import React from "react";
import { Loader2, Truck } from "lucide-react";
import Link from "next/link";
import { PhoneLink } from "@/components/common/phone-link";
import { useFacilityVendors } from "@/hooks/useFacilityVendors";

interface VendorsTabProps {
  facilityId: string;
}

export function VendorsTab({ facilityId }: VendorsTabProps) {
  const { rows, isLoading, error } = useFacilityVendors(facilityId);

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return <p className="text-destructive text-sm">{error}</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Vendors linked to this facility via vendor assignments. Manage contracts in{" "}
        <Link href="/admin/vendors" className="text-foreground underline hover:text-muted-foreground">
          Vendors &amp; AP
        </Link>
        .
      </p>
      {rows.length === 0 ? (
        <div className="rounded-[8px] border border-dashed border-border p-8 text-center text-muted-foreground">
          <Truck className="h-10 w-10 mx-auto mb-2 opacity-40" />
          No vendors linked to this facility yet.
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-[8px] border border-border bg-card">
          {rows.map((r) => (
            <li key={r.id} className="px-4 py-3 flex flex-wrap justify-between gap-2">
              <div>
                <p className="font-medium text-foreground">{r.vendor?.name ?? "Unknown vendor"}</p>
                <p className="text-xs text-muted-foreground">
                  {r.vendor?.category} · {r.vendor?.status}
                  {r.is_primary && (
                    <span className="ml-2 rounded-[8px] bg-muted/10 border border-border px-1.5 py-0.5 text-xs text-foreground">Primary</span>
                  )}
                </p>
                {r.vendor?.primary_contact_phone ? (
                  <p className="mt-1">
                    <PhoneLink phone={r.vendor.primary_contact_phone} />
                  </p>
                ) : null}
              </div>
              {r.vendor?.id && (
                <Link
                  href={`/admin/vendors/${r.vendor.id}`}
                  className="text-sm text-muted-foreground hover:text-foreground underline self-center"
                >
                  View vendor
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
