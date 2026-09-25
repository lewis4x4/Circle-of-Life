"use client";

import { useEffect, useState } from "react";

import { ThursdayPrintReport } from "@/components/stand-up/ThursdayPrintReport";

/**
 * COL-754: the Thursday Stand Up, printable for the call. The (print) group has
 * no shell, so the page prints exactly the report. Facility and week come from
 * the query (`?facility=&week=`); without a facility it prints every facility
 * the reader may see.
 */
export default function ThursdayStandUpPrintPage() {
  const [query, setQuery] = useState<{ facilityId: string | null; week: string | null } | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const week = params.get("week");
    // Read once on mount: the query names the report to print.
    setQuery({ facilityId: params.get("facility"), week: week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : null });
  }, []);
  if (!query) return <p role="status" className="p-6">Loading the report…</p>;
  return <ThursdayPrintReport facilityId={query.facilityId} week={query.week} />;
}
