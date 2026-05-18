"use client";

import { useCallback, useEffect, useState } from "react";

export interface VendorFacilityRow {
  id: string;
  vendor_id: string | null;
  is_primary: boolean;
  created_at: string;
  source?: string;
  coi_on_file?: boolean | null;
  coi_expiration?: string | null;
  service_contract_status?: string | null;
  service_contract_expiration?: string | null;
  last_invoice_at?: string | null;
  last_payment_at?: string | null;
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

export type FacilityVendorFacilityKpi = {
  canonical_vendor_count: number;
  migration_residue_count: number;
};

export function useFacilityVendors(facilityId: string, options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const [rows, setRows] = useState<VendorFacilityRow[]>([]);
  const [kpi, setKpi] = useState<FacilityVendorFacilityKpi | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/facilities/${facilityId}/vendors`);
      if (!res.ok) throw new Error("Failed to load vendors");
      const json = (await res.json()) as {
        data: VendorFacilityRow[];
        kpi?: FacilityVendorFacilityKpi;
      };
      setRows(json.data ?? []);
      setKpi(json.kpi ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setRows([]);
      setKpi(null);
    } finally {
      setIsLoading(false);
    }
  }, [facilityId]);

  useEffect(() => {
    if (!enabled) {
      setRows([]);
      setKpi(null);
      setError(null);
      setIsLoading(false);
      return;
    }
    void refetch();
  }, [enabled, refetch]);

  return { rows, kpi, isLoading, error, refetch };
}
