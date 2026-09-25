"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";

/**
 * COL-333: prior records a person should review, from
 * public.referral_conversion_reconciliation (migration 539). Nothing here
 * changes a record: a referral marked converted with no confirmed arrival, an
 * arrived admission whose referral is still open, and an admission at move-in
 * with no arrival are listed for an administrator to look at. Readers other
 * than owner, org admin and administrator are refused by the database, and the
 * card then shows nothing.
 */
export type ReconciliationRow = {
  kind: "converted_without_arrival" | "arrived_referral_open" | "move_in_without_arrival";
  facility_id: string;
  referral_lead_id: string | null;
  admission_case_id: string | null;
  at: string | null;
};

export const RECONCILIATION_KIND_COPY: Record<ReconciliationRow["kind"], { one: string; many: string }> = {
  converted_without_arrival: {
    one: "1 referral is marked moved in with no confirmed arrival behind it.",
    many: "{n} referrals are marked moved in with no confirmed arrival behind them.",
  },
  arrived_referral_open: {
    one: "1 admission arrived while its referral is still open.",
    many: "{n} admissions arrived while their referrals are still open.",
  },
  move_in_without_arrival: {
    one: "1 admission is at move-in with no confirmed arrival (the old status path).",
    many: "{n} admissions are at move-in with no confirmed arrival (the old status path).",
  },
};

export function reconciliationLine(kind: ReconciliationRow["kind"], count: number): string {
  const copy = RECONCILIATION_KIND_COPY[kind];
  return count === 1 ? copy.one : copy.many.replace("{n}", count.toLocaleString("en-US"));
}

export function reconciliationHref(row: ReconciliationRow): string {
  if (row.kind !== "converted_without_arrival" && row.admission_case_id) return `/admin/admissions/${row.admission_case_id}`;
  return row.referral_lead_id ? `/admin/referrals/${row.referral_lead_id}` : "/admin/referrals";
}

function parseRows(data: unknown): ReconciliationRow[] | null {
  if (!Array.isArray(data)) return null;
  return data.filter((row): row is ReconciliationRow =>
    !!row && typeof row === "object" && ["converted_without_arrival", "arrived_referral_open", "move_in_without_arrival"].includes((row as { kind?: string }).kind ?? ""));
}

export function ReferralConversionReconciliation({ facilityId }: { facilityId: string }) {
  const [rows, setRows] = useState<ReconciliationRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    const client = createClient();
    const rpc = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>;
    void rpc("referral_conversion_reconciliation", { p_facility: facilityId }).then(({ data, error }) => {
      if (!live) return;
      if (error) {
        // Refused (not an administrator): show nothing. Anything else: say it could not be read.
        setFailed(error.code !== "42501");
        setRows(null);
        return;
      }
      setRows(parseRows(data));
      setFailed(false);
    });
    return () => {
      live = false;
    };
  }, [facilityId]);

  if (failed) {
    return <p role="alert" className="text-sm">Referral conversions to review could not be read.</p>;
  }
  if (!rows || rows.length === 0) return null;
  const kinds = (Object.keys(RECONCILIATION_KIND_COPY) as ReconciliationRow["kind"][]).filter((kind) => rows.some((row) => row.kind === kind));
  return (
    <section aria-labelledby="referral-reconciliation-heading" className="space-y-2 rounded-[8px] border border-border bg-card p-4 text-sm">
      <h2 id="referral-reconciliation-heading" className="font-semibold">Referral conversions to review</h2>
      <p className="text-muted-foreground">Listed for a person to look at. Nothing here changes a record.</p>
      {kinds.map((kind) => {
        const matching = rows.filter((row) => row.kind === kind);
        return (
          <div key={kind} className="space-y-1">
            <p>{reconciliationLine(kind, matching.length)}</p>
            <ul className="list-inside list-disc">
              {matching.map((row, index) => (
                <li key={`${row.referral_lead_id ?? ""}:${row.admission_case_id ?? ""}:${index}`}>
                  <Link href={reconciliationHref(row)} className="underline underline-offset-2">
                    {row.kind === "converted_without_arrival" ? "Open the referral" : "Open the admission"}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
