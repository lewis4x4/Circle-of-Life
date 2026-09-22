"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

import {
  ResidentFallRiskPresentation,
  hospiceElectionPhrase,
  polstMolstFriendly,
  resolveCodeStatusPresentation,
} from "@/components/residents/resident-clinical-overview-widgets";
import { Button, buttonVariants } from "@/components/ui/button";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { diagnosisDisplayTitle } from "@/lib/residents/clinical-text-format";
import {
  loadResidentOverviewDetail,
  type ResidentContactRowView,
  type ResidentOverviewDetail,
} from "@/lib/residents/resident-detail-overview-load";
import { recordedDiagnoses } from "@/lib/residents/resident-diagnosis-display";
import { formatResidentOverviewGenderLabel } from "@/lib/residents/resident-overview-display-copy";
import { presenceSinceSummary, presenceStatusLabel } from "@/lib/residents/resident-presence-history";
import { RESPONSIBLE_PARTY_CONTACT_ID, RESPONSIBLE_PARTY_CONTACT_NOTE } from "@/lib/residents/resident-responsible-party";
import { UUID_STRING_RE } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

/**
 * COL-599: the resident face sheet — one page for an EMS transport, a hospital
 * handoff or a surveyor: identity, code status, allergies, diagnoses, contacts,
 * physician and payer.
 *
 * It reads the same loader as the resident overview, through the operator's
 * own session and RLS, so the sheet can never say something the record does
 * not. Absent facts print as "Not recorded" — a blank on a transfer sheet reads
 * as "none", and "no allergies" is not the same as "never reviewed".
 * Served outside the app shell (see `(print)/layout.tsx`); `?auto=0` leaves the
 * print dialog closed. Nothing is written.
 */
const PAGE_CSS = `@page { margin: 0.5in; }`;

const printedAtFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

function dayLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`) : new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d);
}

function reviewLine(verb: string, iso: string | null, who: string | null): string {
  const day = dayLabel(iso);
  if (!day) return `${verb}: not recorded`;
  return `${verb} ${day} by ${who?.trim() ? who : "staff (not attributed)"}`;
}

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={cn("break-inside-avoid", wide && "col-span-2")}>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-neutral-700">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function ContactLine({ tier, row }: { tier: string; row: ResidentContactRowView | null }) {
  return (
    <Field label={tier}>
      {row ? (
        <>
          {row.name} ({row.relationship ?? "relationship not recorded"}) · {row.phone ?? "phone not recorded"}
          {row.id === RESPONSIBLE_PARTY_CONTACT_ID ? (
            <span className="block text-xs text-neutral-700">{RESPONSIBLE_PARTY_CONTACT_NOTE}</span>
          ) : null}
        </>
      ) : (
        "Not recorded"
      )}
    </Field>
  );
}

export default function ResidentFaceSheetPage() {
  const params = useParams<{ id: string }>();
  const residentId = typeof params.id === "string" ? params.id : "";
  const searchParams = useSearchParams();
  const autoPrint = searchParams.get("auto") !== "0";
  const printed = useRef(false);
  const { fullName: printedBy, loading: authLoading } = useHavenAuth();

  const [detail, setDetail] = useState<ResidentOverviewDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [printedAt] = useState(() => new Date());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!UUID_STRING_RE.test(residentId)) {
        setError("Open this page from a resident record; no resident was named.");
        setLoading(false);
        return;
      }
      try {
        // No facility filter: the sheet is opened from one resident's record,
        // and RLS still decides whether this operator may read it.
        const row = await loadResidentOverviewDetail(residentId, null);
        if (cancelled) return;
        if (!row) setError("This resident could not be found, or is outside your facility access.");
        else setDetail(row);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "The face sheet could not be loaded.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [residentId]);

  useEffect(() => {
    if (!autoPrint || !detail || authLoading || printed.current) return;
    printed.current = true;
    const t = window.setTimeout(() => window.print(), 250);
    return () => window.clearTimeout(t);
  }, [autoPrint, detail, authLoading]);

  const backHref = `/admin/residents/${residentId}`;

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-neutral-500" aria-label="Loading face sheet" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="space-y-4 p-6">
        <p className="text-sm text-red-700">{error ?? "The face sheet could not be loaded."}</p>
        <Link href={backHref} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          Back to resident
        </Link>
      </div>
    );
  }

  const code = resolveCodeStatusPresentation(detail.codeStatusRaw);
  const diagnoses = recordedDiagnoses(detail.primaryDiagnosisRaw, detail.diagnosisListRaw);
  const emergency = [...detail.contacts].filter((c) => c.isEmergencyContact).sort((a, b) => a.sortOrder - b.sortOrder);
  const poa = [...detail.contacts]
    .filter((c) => c.isHealthcareProxy || c.isPowerOfAttorney)
    .sort((a, b) => a.sortOrder - b.sortOrder)[0] ?? null;
  const presence = presenceSinceSummary(detail.presenceHistory, detail.rawStatus);
  const allergies =
    detail.allergiesTokens.length > 0
      ? detail.allergiesTokens.map((t) => diagnosisDisplayTitle(t)).join("; ")
      : detail.allergyReviewedAt
        ? "No known drug allergies"
        : "Not reviewed — allergies unknown";

  return (
    <>
      <style>{PAGE_CSS}</style>
      <div className="mx-auto mb-4 flex max-w-3xl flex-wrap items-center gap-2 px-8 pt-4 print:hidden">
        <Link href={backHref} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
          Back to resident
        </Link>
        <Button size="sm" onClick={() => window.print()}>
          Print
        </Button>
        <p className="text-xs text-neutral-600">Choose “Save as PDF” in the print dialog for a file.</p>
      </div>

      <article id="resident-face-sheet" className="mx-auto max-w-3xl bg-white p-8 text-black print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-black pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide">Resident face sheet</p>
            <h1 className="text-2xl font-bold">{detail.fullName}</h1>
            {detail.preferredName ? <p className="text-sm">Preferred name: {detail.preferredName}</p> : null}
            <p className="text-sm">{detail.facilityName ?? "Facility not recorded"}</p>
          </div>
          {detail.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- resident photo is a stored URL; the sheet prints it as-is
            <img src={detail.photoUrl} alt={`Photo of ${detail.fullName}`} className="h-24 w-20 border border-black object-cover" />
          ) : (
            <p className="flex h-24 w-20 items-center justify-center border border-dashed border-neutral-500 text-center text-[10px] text-neutral-600">
              No photo on file
            </p>
          )}
        </header>

        <section aria-label="Identity" className="mt-3">
          <dl className="grid grid-cols-4 gap-x-4 gap-y-2">
            <Field label="Date of birth">{detail.dobLabel}</Field>
            <Field label="Age">{detail.ageYears != null ? detail.ageYears : "Not recorded"}</Field>
            <Field label="Gender">{formatResidentOverviewGenderLabel(detail.gender)}</Field>
            <Field label="Admitted">{detail.admissionLabel}</Field>
            <Field label="Room">{detail.roomLabel}</Field>
            <Field label="Unit">{detail.unitName}</Field>
            <Field label="Presence" wide>
              {presenceStatusLabel(detail.rawStatus ?? "")} · {presence.sinceLabel}
            </Field>
          </dl>
        </section>

        <section aria-label="Code status and directives" className="mt-4 border-2 border-black p-3">
          <dl className="grid grid-cols-3 gap-x-4 gap-y-2">
            <Field label="Code status">
              <span className="text-base font-bold">{code.label}</span>
              <span className="block text-xs">{reviewLine("Verified", detail.codeStatusVerifiedAt, detail.codeStatusVerifiedByName)}</span>
            </Field>
            <Field label="POLST / MOLST">{polstMolstFriendly(detail.polstMolstRawStatus)}</Field>
            <Field label="Hospice">{hospiceElectionPhrase(detail.hospiceStatus)}</Field>
            <Field label="Advance directive">
              {detail.advanceDirectiveType ?? "Type not recorded"}
              {detail.advanceDirectiveOnFile ? " · on file" : " · not on file"}
            </Field>
          </dl>
        </section>

        <section aria-label="Allergies" className="mt-3 border-2 border-black p-3">
          <dl>
            <Field label="Allergies">
              <span className="font-bold">{allergies}</span>
              <span className="block text-xs">{reviewLine("Reviewed", detail.allergyReviewedAt, detail.allergyReviewedByName)}</span>
            </Field>
          </dl>
        </section>

        <section aria-label="Clinical" className="mt-4">
          <h2 className="border-b border-black pb-1 text-sm font-bold uppercase tracking-wide">Clinical</h2>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
            <Field label="Diagnoses" wide>
              {diagnoses.conditions.length === 0 ? (
                "None recorded"
              ) : (
                <>
                  {diagnoses.primary ? <span className="block">Primary: {diagnoses.primary}</span> : null}
                  {diagnoses.conditions.some((c) => c !== diagnoses.primary) ? (
                    <span className="block">
                      {diagnoses.primary ? "Also: " : ""}
                      {diagnoses.conditions.filter((c) => c !== diagnoses.primary).join("; ")}
                    </span>
                  ) : null}
                </>
              )}
            </Field>
            <Field label="Diet order">{diagnosisDisplayTitle(detail.dietOrder ?? "") || "Not recorded"}</Field>
            <Field label="Fall risk">
              <ResidentFallRiskPresentation raw={detail.fallRiskRaw} />
            </Field>
          </dl>
        </section>

        <section aria-label="Contacts" className="mt-4">
          <h2 className="border-b border-black pb-1 text-sm font-bold uppercase tracking-wide">Contacts and physician</h2>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
            <ContactLine tier="Primary contact" row={emergency[0] ?? null} />
            <ContactLine tier="Secondary contact" row={emergency[1] ?? null} />
            <ContactLine tier="POA / healthcare proxy" row={poa} />
            <Field label="Primary care physician">
              {detail.primaryPhysicianName
                ? `${detail.primaryPhysicianName} · ${detail.primaryPhysicianPhone ?? "phone not recorded"}`
                : "Not recorded"}
            </Field>
          </dl>
        </section>

        <section aria-label="Coverage" className="mt-4">
          <h2 className="border-b border-black pb-1 text-sm font-bold uppercase tracking-wide">Coverage</h2>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
            <Field label="Primary payer">{detail.primaryPayer ?? "Not recorded"}</Field>
          </dl>
        </section>

        <footer className="mt-6 flex flex-wrap justify-between gap-2 border-t border-neutral-300 pt-2 text-[10px] text-neutral-700">
          <span>
            Printed {printedAtFormatter.format(printedAt)} by {printedBy?.trim() || "signed-in user"}
          </span>
          <span>Haven · Contains protected health information</span>
        </footer>
      </article>
    </>
  );
}
