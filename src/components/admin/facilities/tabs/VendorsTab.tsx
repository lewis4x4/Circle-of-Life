"use client";

import React from "react";
import { Loader2, Truck } from "lucide-react";
import Link from "next/link";
import { useFacilityVendors } from "@/hooks/useFacilityVendors";

interface VendorsTabProps {
  facilityId: string;
}

export function VendorsTab({ facilityId }: VendorsTabProps) {
  const { rows, isLoading, error } = useFacilityVendors(facilityId);

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-teal-500" />
      </div>
    );
  }

  if (error) {
    return <p className="text-destructive text-sm">{error}</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Vendors linked to this facility via vendor assignments. Manage contracts in{" "}
        <Link href="/admin/vendors" className="text-teal-400 underline">
          Vendors &amp; AP
        </Link>
        .
      </p>
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-slate-500 dark:text-slate-400">
          <Truck className="h-10 w-10 mx-auto mb-2 opacity-40" />
          No vendors linked to this facility yet.
        </div>
      ) : (
        <ul className="divide-y rounded-lg border border-slate-200/50 dark:border-white/10 bg-white">
          {rows.map((r) => (
            <li key={r.id} className="px-4 py-3 flex flex-wrap justify-between gap-2">
              <div>
                <p className="font-medium">{r.vendor?.name ?? "Unknown vendor"}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {r.vendor?.category} · {r.vendor?.status}
                  {r.is_primary && (
                    <span className="ml-2 rounded bg-teal-500/100/20 px-1.5 py-0.5 text-teal-300">Primary</span>
                  )}
                </p>
                {r.vendor?.primary_contact_phone && (
                  <p className="text-sm mt-1">{r.vendor.primary_contact_phone}</p>
                )}
              </div>
              {r.vendor?.id && (
                <Link
                  href={`/admin/vendors/${r.vendor.id}`}
                  className="text-sm text-teal-400 hover:underline self-center"
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
