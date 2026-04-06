"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, CreditCard } from "lucide-react";

import { AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { UUID_STRING_RE, isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { BillingInvoiceLedger, PayerTypeBadge, mapDbPayerTypeToUi } from "../../../billing/billing-invoice-ledger";

type SupabaseResident = {
  id: string;
  facility_id: string;
  first_name: string | null;
  last_name: string | null;
  deleted_at: string | null;
};

type SupabasePayer = {
  id: string;
  payer_type: string;
  is_primary: boolean;
  payer_name: string | null;
  effective_date: string;
  end_date: string | null;
  deleted_at: string | null;
};

type QueryResult<T> = { data: T | null; error: { message: string } | null };
type QueryListResult<T> = { data: T[] | null; error: { message: string } | null };

function formatDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d);
}

export default function ResidentBillingPage() {
  const params = useParams();
  const rawId = typeof params?.id === "string" ? params.id : "";
  const residentId = UUID_STRING_RE.test(rawId) ? rawId : "";
  const { selectedFacilityId } = useFacilityStore();

  const [residentName, setResidentName] = useState("");
  const [payers, setPayers] = useState<SupabasePayer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    if (!residentId) {
      setNotFound(true);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setNotFound(false);
    try {
      const supabase = createClient();
      const res = (await supabase
        .from("residents" as never)
        .select("id, facility_id, first_name, last_name, deleted_at")
        .eq("id", residentId)
        .is("deleted_at", null)
        .maybeSingle()) as unknown as QueryResult<SupabaseResident>;
      if (res.error) throw res.error;
      const r = res.data;
      if (!r) {
        setNotFound(true);
        setIsLoading(false);
        return;
      }
      if (isValidFacilityIdForQuery(selectedFacilityId) && r.facility_id !== selectedFacilityId) {
        setNotFound(true);
        setIsLoading(false);
        return;
      }
      const fn = r.first_name?.trim() ?? "";
      const ln = r.last_name?.trim() ?? "";
      setResidentName(`${fn} ${ln}`.trim() || "Resident");

      const payRes = (await supabase
        .from("resident_payers" as never)
        .select("id, payer_type, is_primary, payer_name, effective_date, end_date, deleted_at")
        .eq("resident_id", residentId)
        .is("deleted_at", null)
        .order("effective_date", { ascending: false })) as unknown as QueryListResult<SupabasePayer>;
      if (payRes.error) throw payRes.error;
      setPayers(payRes.data ?? []);
    } catch {
      setNotFound(true);
      setPayers([]);
    } finally {
      setIsLoading(false);
    }
  }, [residentId, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!residentId || notFound) {
    return (
      <div className="space-y-6 p-1">
        <Card>
          <CardHeader>
            <CardTitle>Resident not found</CardTitle>
            <CardDescription>Check the ID or facility selector.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/admin/residents" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              Back to residents
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6 p-1">
        <AdminTableLoadingState />
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Link
          href={`/admin/residents/${residentId}`}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex w-fit gap-1")}
        >
          <ArrowLeft className="h-4 w-4" />
          {residentName}
        </Link>
      </div>

      <header>
        <h2 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          Billing
        </h2>
        <p className="mt-1 text-slate-500 dark:text-slate-400">Invoices and payer coverage for this resident.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <CreditCard className="h-4 w-4" />
            Payers on file
          </CardTitle>
          <CardDescription>Primary and secondary coverage from resident_payers.</CardDescription>
        </CardHeader>
        <CardContent className="p-0 sm:p-0">
          {payers.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-slate-500 dark:text-slate-400">No payer rows returned.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden sm:table-cell">Effective</TableHead>
                  <TableHead className="hidden sm:table-cell">End</TableHead>
                  <TableHead> </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payers.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <PayerTypeBadge payerType={mapDbPayerTypeToUi(p.payer_type)} />
                    </TableCell>
                    <TableCell className="font-medium">{p.payer_name?.trim() || "—"}</TableCell>
                    <TableCell className="hidden text-slate-600 sm:table-cell">{formatDate(p.effective_date)}</TableCell>
                    <TableCell className="hidden text-slate-600 sm:table-cell">
                      {p.end_date ? formatDate(p.end_date) : "—"}
                    </TableCell>
                    <TableCell>
                      {p.is_primary ? (
                        <Badge variant="outline" className="text-xs">
                          Primary
                        </Badge>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <BillingInvoiceLedger
        title="Invoices"
        description={`Open and historical invoices for ${residentName}.`}
        cardTitle="Resident invoices"
        cardDescription="Scoped to this resident; facility filter still applies when set."
        residentIdFilter={residentId}
      />
    </div>
  );
}
