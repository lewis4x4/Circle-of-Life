"use client";

import { useCallback, useEffect, useState } from "react";

export interface VendorFacilityRow {
  id: string;
  vendor_id: string;
  is_primary: boolean;
  created_at: string;
  vendor: {
    id: string;
    name: string;
    category: string;
    status: string;
    primary_contact_name: string | null;
    primary_contact_phone: string | null;
    primary_contact_email: string | null;
    notes: string | null;
  } | null;
}

export function useFacilityVendors(facilityId: string) {
  const [rows, setRows] = useState<VendorFacilityRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/facilities/${facilityId}/vendors`);
      if (!res.ok) throw new Error("Failed to load vendors");
      const json = (await res.json()) as { data: VendorFacilityRow[] };
      setRows(json.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setRows([]);
    } finally {
      setIsLoading(false);
    }
  }, [facilityId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { rows, isLoading, error, refetch };
}
