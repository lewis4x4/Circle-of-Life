"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { formatCarePlanDateOnly, formatCarePlanItemDescription, formatCarePlanItemTitle, formatCarePlanVersion } from "@/lib/care-plans/care-plan-display-copy";
import {
  CARE_PLAN_PRINT_NO_ITEMS_COPY,
  CARE_PLAN_PRINT_TITLE,
  CARE_PLAN_PRINT_UNSIGNED_COPY,
  formatCarePlanPrintApprover,
  formatCarePlanPrintAssistanceLevel,
  formatCarePlanPrintBanner,
  formatCarePlanPrintDateOfBirth,
  formatCarePlanPrintTimestamp,
} from "@/lib/care-plans/care-plan-print-copy";
import {
  CARE_PLAN_ACK_PRINT_REPRESENTATIVE_LINE,
  CARE_PLAN_ACK_PRINT_RESIDENT_LINE,
  formatCarePlanAckMethod,
  formatCarePlanAckRole,
  formatCarePlanAckSigner,
} from "@/lib/care-plans/care-plan-acknowledgement-copy";
import type { CarePlanPrintPacket } from "@/lib/care-plans/care-plan-print-packet";
import { UUID_STRING_RE } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

/**
 * Survey / family printout of one care-plan version, served outside the app
 * shell so the sheet is the whole document and pages break where the content
 * says. Opens the browser print dialog once the packet is loaded ("Save as
 * PDF" is the PDF path); `?auto=0` leaves the dialog closed. Nothing is
 * written; the route decides access.
 */
const PAGE_CSS = `@page { margin: 0.6in; }`;

export default function CarePlanPrintSheetPage() {
  const params = useParams<{ id: string }>();
  const planId = typeof params.id === "string" ? params.id : "";
  const searchParams = useSearchParams();
  const autoPrint = searchParams.get("auto") !== "0";
  const printed = useRef(false);

  const [packet, setPacket] = useState<CarePlanPrintPacket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!UUID_STRING_RE.test(planId)) {
        setError("Open this page from a care plan; no plan was named.");
        setLoading(false);
        return;
      }
      try {
        const response = await fetch(`/api/care-plans/${planId}/print`, { cache: "no-store" });
        const body = (await response.json().catch(() => ({}))) as Partial<CarePlanPrintPacket> & { error?: string };
        if (!response.ok) throw new Error(body.error || "Care plan could not be loaded for printing");
        if (!cancelled) setPacket(body as CarePlanPrintPacket);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Care plan could not be loaded for printing");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [planId]);

  useEffect(() => {
    if (!autoPrint || !packet || printed.current) return;
    printed.current = true;
    const t = window.setTimeout(() => window.print(), 250);
    return () => window.clearTimeout(t);
  }, [autoPrint, packet]);

  const backHref = packet ? `/admin/residents/${packet.resident.id}/care-plan` : "/admin/care-plans/reviews-due";

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-neutral-500" />
      </div>
    );
  }

  if (error || !packet) {
    return (
      <div className="space-y-4 p-6">
        <p className="text-sm text-red-700">{error ?? "Care plan could not be loaded for printing"}</p>
        <Link href={backHref} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          Back to care plans
        </Link>
      </div>
    );
  }

  const banner = formatCarePlanPrintBanner(packet.plan.status, packet.plan.supersededByVersion);

  return (
    <>
      <style>{PAGE_CSS}</style>
      <div className="mx-auto mb-4 flex max-w-3xl flex-wrap items-center gap-2 px-8 pt-4 print:hidden">
        <Link href={backHref} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
          Back to care plan
        </Link>
        <Button size="sm" onClick={() => window.print()}>
          Print
        </Button>
        <p className="text-xs text-neutral-600">Choose “Save as PDF” in the print dialog for a file.</p>
      </div>

      <article id="care-plan-print" className="mx-auto max-w-3xl bg-white p-8 text-black print:p-0">
        {banner ? (
          <p className="mb-4 border-2 border-black p-2 text-center text-sm font-bold uppercase tracking-wide">{banner}</p>
        ) : null}

        <header className="border-b border-black pb-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">{CARE_PLAN_PRINT_TITLE}</h1>
              <p className="text-sm">{packet.facility.name}</p>
              {packet.facility.addressLines.map((line) => (
                <p key={line} className="text-xs text-neutral-700">{line}</p>
              ))}
              {packet.facility.phone ? <p className="text-xs text-neutral-700">{packet.facility.phone}</p> : null}
              {packet.facility.licenseNumber ? (
                <p className="text-xs text-neutral-700">License {packet.facility.licenseNumber}</p>
              ) : null}
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="font-semibold">Resident</dt>
              <dd>{packet.resident.name}</dd>
              <dt className="font-semibold">Date of birth</dt>
              <dd className="tabular-nums">{formatCarePlanPrintDateOfBirth(packet.resident.dateOfBirth)}</dd>
              <dt className="font-semibold">Room</dt>
              <dd>{packet.resident.room}</dd>
            </dl>
          </div>
        </header>

        <section className="mt-4 grid grid-cols-3 gap-4 border-b border-neutral-300 pb-4 text-sm">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-700">Plan</p>
            <p className="tabular-nums">{formatCarePlanVersion(packet.plan.version)} · {packet.plan.status.replace(/_/g, " ")}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-700">Effective</p>
            <p className="tabular-nums">{formatCarePlanDateOnly(packet.plan.effectiveDate)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-700">Review due</p>
            <p className="tabular-nums">{formatCarePlanDateOnly(packet.plan.reviewDueDate)}</p>
          </div>
          {packet.form1823 ? (
            <div className="col-span-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-700">Based on</p>
              <p>
                Form 1823 exam {formatCarePlanDateOnly(packet.form1823.examDate)}
                {packet.form1823.examinerName ? ` · ${packet.form1823.examinerName}${packet.form1823.examinerTitle ? ` (${packet.form1823.examinerTitle})` : ""}` : ""}
              </p>
            </div>
          ) : null}
          {packet.plan.notes ? (
            <div className="col-span-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-700">Notes</p>
              <p className="whitespace-pre-wrap">{packet.plan.notes}</p>
            </div>
          ) : null}
        </section>

        {packet.sections.length === 0 ? (
          <p className="mt-6 text-sm">{CARE_PLAN_PRINT_NO_ITEMS_COPY}</p>
        ) : (
          <div className="mt-6 space-y-6">
            {packet.sections.map((section) => (
              <section key={section.category} className="break-inside-avoid">
                <h2 className="border-b border-black pb-1 text-sm font-bold uppercase tracking-wide">{section.label}</h2>
                <ul className="mt-2 space-y-3">
                  {section.items.map((item) => (
                    <li key={item.id} className="break-inside-avoid text-sm">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="font-semibold">{formatCarePlanItemTitle(item.title)}</p>
                        <p className="text-xs text-neutral-700">{formatCarePlanPrintAssistanceLevel(item.assistanceLevel)}</p>
                      </div>
                      <p>{formatCarePlanItemDescription(item.description)}</p>
                      {item.frequency ? <p className="text-xs"><span className="font-semibold">Frequency:</span> {item.frequency}</p> : null}
                      {item.interventions.length > 0 ? (
                        <ul className="mt-1 list-disc pl-5">
                          {item.interventions.map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                      ) : null}
                      {item.goal ? <p className="text-xs"><span className="font-semibold">Goal:</span> {item.goal}</p> : null}
                      {item.specialInstructions ? (
                        <p className="mt-1 border border-black p-2 text-xs"><span className="font-semibold">Special instructions:</span> {item.specialInstructions}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        <section className="mt-8 break-inside-avoid border-t border-black pt-4">
          <h2 className="text-sm font-bold uppercase tracking-wide">Approval</h2>
          {packet.signature ? (
            <div className="mt-2 flex flex-wrap items-end justify-between gap-4 text-sm">
              <div>
                {packet.signature.signatureData ? (
                  // eslint-disable-next-line @next/next/no-img-element -- signature is an inline data URL captured at approval
                  <img src={packet.signature.signatureData} alt="Approver signature" className="h-16 max-w-xs border-b border-black" />
                ) : (
                  <p className="text-xs text-neutral-700">No signature image was captured.</p>
                )}
                <p className="mt-1">{formatCarePlanPrintApprover(packet.signature.approverName)}</p>
              </div>
              <p className="tabular-nums text-xs">Approved {formatCarePlanPrintTimestamp(packet.signature.approvedAt)}</p>
            </div>
          ) : (
            <p className="mt-2 text-sm">{CARE_PLAN_PRINT_UNSIGNED_COPY}</p>
          )}
        </section>

        <section className="mt-6 break-inside-avoid border-t border-black pt-4">
          <h2 className="text-sm font-bold uppercase tracking-wide">Resident / representative acknowledgement</h2>
          {packet.acknowledgements.length > 0 ? (
            <ul className="mt-2 space-y-3 text-sm">
              {packet.acknowledgements.map((ack) => (
                <li key={ack.id} className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <p className="font-semibold">{formatCarePlanAckRole(ack.signerRole)} · {formatCarePlanAckSigner(ack.signerName, ack.relationship)}</p>
                    <p className="text-xs text-neutral-700">{formatCarePlanAckMethod(ack.method)} · {formatCarePlanPrintTimestamp(ack.acknowledgedAt)}</p>
                  </div>
                  {ack.signatureData ? (
                    // eslint-disable-next-line @next/next/no-img-element -- inline data URL captured at acknowledgement
                    <img src={ack.signatureData} alt={`${formatCarePlanAckRole(ack.signerRole)} signature`} className="h-14 max-w-xs border-b border-black" />
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            // No acknowledgement on record: leave the lines the paper copy needs.
            <dl className="mt-4 grid grid-cols-[auto_1fr_auto_8rem] items-end gap-x-3 gap-y-6 text-sm">
              <dt className="font-semibold">{CARE_PLAN_ACK_PRINT_RESIDENT_LINE}</dt>
              <dd className="border-b border-black" aria-label="Resident signature line" />
              <dt className="font-semibold">Date</dt>
              <dd className="border-b border-black" aria-label="Resident signature date line" />
              <dt className="font-semibold">{CARE_PLAN_ACK_PRINT_REPRESENTATIVE_LINE}</dt>
              <dd className="border-b border-black" aria-label="Representative signature line" />
              <dt className="font-semibold">Date</dt>
              <dd className="border-b border-black" aria-label="Representative signature date line" />
            </dl>
          )}
        </section>

        <footer className="mt-6 flex flex-wrap justify-between gap-2 border-t border-neutral-300 pt-2 text-[10px] text-neutral-700">
          <span>Printed {formatCarePlanPrintTimestamp(packet.printedAt)} by {packet.printedBy}</span>
          <span>Haven · {formatCarePlanVersion(packet.plan.version)} · Contains protected health information</span>
        </footer>
      </article>
    </>
  );
}
