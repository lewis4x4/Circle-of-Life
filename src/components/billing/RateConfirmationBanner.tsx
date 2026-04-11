"use client";

import React, { useCallback, useEffect, useState } from "react";

import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

type Props = {
  facilityId: string | null;
};

/**
 * Warns when any active `rate_schedule_versions` row has `rate_confirmed = false`.
 */
export function RateConfirmationBanner({ facilityId }: Props) {
  const [show, setShow] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!isValidFacilityIdForQuery(facilityId)) {
        setShow(false);
        return;
      }
      try {
        const res = await fetch(`/api/admin/facilities/${facilityId}/rates?active_only=true`, {
          signal,
        });
        if (!res.ok) {
          setShow(false);
          return;
        }
        const json = (await res.json()) as {
          data: { effective_to: string | null; rate_confirmed?: boolean }[];
        };
        const pending = (json.data ?? []).some(
          (r) => r.effective_to == null && r.rate_confirmed === false,
        );
        setShow(pending);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setShow(false);
      }
    },
    [facilityId],
  );

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [load]);

  if (!show) return null;

  return (
    <div
      role="status"
      className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
    >
      <strong className="font-semibold">Rate pending client confirmation.</strong> Review facility
      rate lines before finalizing invoices.
    </div>
  );
}
