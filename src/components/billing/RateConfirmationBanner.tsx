"use client";

import React, { useEffect, useState } from "react";

import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

type Props = {
  facilityId: string | null;
};

/**
 * Warns when any active `rate_schedule_versions` row has `rate_confirmed = false`.
 */
export function RateConfirmationBanner({ facilityId }: Props) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!isValidFacilityIdForQuery(facilityId)) {
      const resetTimer = window.setTimeout(() => {
        setShow(false);
      }, 0);

      return () => window.clearTimeout(resetTimer);
    }

    let disposed = false;
    const ac = new AbortController();
    const loadTimer = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/admin/facilities/${facilityId}/rates?active_only=true`, {
            signal: ac.signal,
          });
          if (!res.ok) {
            if (!disposed) setShow(false);
            return;
          }
          const json = (await res.json()) as {
            data: { effective_to: string | null; rate_confirmed?: boolean }[];
          };
          const pending = (json.data ?? []).some(
            (rate) => rate.effective_to == null && rate.rate_confirmed === false,
          );
          if (!disposed) setShow(pending);
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") return;
          if (!disposed) setShow(false);
        }
      })();
    }, 0);

    return () => {
      disposed = true;
      window.clearTimeout(loadTimer);
      ac.abort();
    };
  }, [facilityId]);

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
