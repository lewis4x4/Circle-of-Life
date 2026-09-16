"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AdminEmptyState, AdminLiveDataFallbackNotice, AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { RecordDetailHeader, RecordDetailSection } from "@/design-system/components/record-detail";
import {
  acknowledgeCareEvent,
  completeAdminSection,
  describeAdminSectionError,
  fetchCareEventDeliveries,
  loadCareEventCard,
  type AdminSection,
  type AdminSectionResult,
  type CareEventAdminCard,
} from "@/lib/care-events/admin-data";
import { formatLiveDataLoadError } from "@/lib/live-data-fallback";
import { createClient } from "@/lib/supabase/client";
import { UUID_STRING_RE } from "@/lib/supabase/env";

import { CareEventCard } from "./CareEventCard";
import { CareEventDeliveryLedger } from "./CareEventDeliveryLedger";
import { CareEventWitnesses } from "./CareEventWitnesses";
import { CorrectiveSection, EmsSection, FamilySection, PhysicianSection } from "./CompletionNotifySections";
import { AhcaSection, CloseSection, DcfSection, LowerLevelSection, VideoSection } from "./CompletionRegulatorySections";

type PageState =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error"; message: string }
  | { kind: "ready"; card: CareEventAdminCard };

const LEDGER_POLL_MS = 10_000;
const CLOCK_TICK_MS = 30_000;

const SECTION_NOTICES: Record<string, string> = {
  family: "Family decision saved.",
  physician: "Physician decision saved.",
  ems: "EMS decision saved.",
  corrective: "Corrective action saved.",
  ahca: "AHCA decision saved.",
  dcf: "DCF report time saved.",
  video: "Video decision saved.",
  lower: "Level lowered.",
  close: "Event closed.",
};

export function AdminCareEventPageClient({ careEventId }: { careEventId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<PageState>({ kind: "loading" });
  const [reloadTick, setReloadTick] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [acknowledging, setAcknowledging] = useState(false);
  const [busySection, setBusySection] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const validId = UUID_STRING_RE.test(careEventId);

  useEffect(() => {
    if (!validId) return;
    let cancelled = false;
    loadCareEventCard(supabase, careEventId)
      .then((card) => {
        if (cancelled) return;
        setState(card ? { kind: "ready", card } : { kind: "missing" });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({ kind: "error", message: formatLiveDataLoadError(error, "The care event could not be loaded. Try again.") });
      });
    return () => {
      cancelled = true;
    };
  }, [careEventId, supabase, validId, reloadTick]);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const open = state.kind === "ready" && state.card.status === "open";
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => {
      fetchCareEventDeliveries(supabase, careEventId)
        .then((deliveries) => {
          setState((current) => (current.kind === "ready" ? { kind: "ready", card: { ...current.card, deliveries } } : current));
        })
        .catch(() => {
          /* the next tick tries again; the card stays as it was */
        });
    }, LEDGER_POLL_MS);
    return () => clearInterval(id);
  }, [open, careEventId, supabase]);

  const reload = useCallback(
    async (knownGate?: AdminSectionResult | null) => {
      const card = await loadCareEventCard(supabase, careEventId, knownGate);
      setState(card ? { kind: "ready", card } : { kind: "missing" });
    },
    [careEventId, supabase],
  );

  async function acknowledge() {
    setActionError(null);
    setAcknowledging(true);
    try {
      await acknowledgeCareEvent(supabase, careEventId);
      await reload();
      setNotice("Acknowledged. The escalation clock has stopped.");
    } catch (error) {
      setActionError(describeAdminSectionError(error));
    } finally {
      setAcknowledging(false);
    }
  }

  function send(sectionKey: string, section: AdminSection) {
    setActionError(null);
    setNotice(null);
    setBusySection(sectionKey);
    completeAdminSection(supabase, careEventId, section)
      .then((result) => reload(result))
      .then(() => setNotice(SECTION_NOTICES[sectionKey] ?? "Saved."))
      .catch((error: unknown) => setActionError(describeAdminSectionError(error)))
      .finally(() => setBusySection(null));
  }

  if (!validId || state.kind === "missing") {
    return (
      <div className="space-y-6">
        <AdminEmptyState title="Care event not found" description="The link may be old, or the event is outside your facilities." />
        <Link href="/admin/incidents" className="text-sm text-foreground underline-offset-4 hover:underline">
          Back to the incidents board
        </Link>
      </div>
    );
  }

  if (state.kind === "loading") {
    return <AdminTableLoadingState />;
  }

  if (state.kind === "error") {
    return <AdminLiveDataFallbackNotice message={state.message} onRetry={() => setReloadTick((tick) => tick + 1)} />;
  }

  const { card } = state;
  const locked = card.status === "closed" || card.gate === null;
  const sectionProps = { card, busySection, locked, send };
  const showAhca = card.level >= 3;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 pb-12">
      <RecordDetailHeader
        title={`${card.tileWord} for ${card.resident?.name ?? "the building"}`}
        subtitle={card.incident ? `Incident ${card.incident.incidentNumber}` : "No incident record for a Note"}
        backLink={{ label: "Incidents board", href: "/admin/incidents" }}
      />

      <CareEventCard card={card} nowMs={nowMs} acknowledging={acknowledging} onAcknowledge={() => void acknowledge()} />

      {notice ? (
        <p role="status" className="text-sm font-medium text-success">
          {notice}
        </p>
      ) : null}
      {actionError ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {actionError}
        </p>
      ) : null}

      <RecordDetailSection title="Completion" description="Sections 2 and 4 of the incident form. Each tap saves on its own.">
        <div className="space-y-6">
          <FamilySection {...sectionProps} />
          <PhysicianSection {...sectionProps} />
          <EmsSection {...sectionProps} />
          <CorrectiveSection {...sectionProps} />
          {showAhca ? <AhcaSection {...sectionProps} /> : null}
          {card.flags.dcf_report_required ? <DcfSection {...sectionProps} /> : null}
          <VideoSection {...sectionProps} />
          <LowerLevelSection {...sectionProps} />
          <CloseSection {...sectionProps} />
        </div>
      </RecordDetailSection>

      <RecordDetailSection
        title="Witness statements"
        description="Section 3 of the incident form. Everyone on that shift was asked, except the person who reported it."
      >
        <CareEventWitnesses
          careEventId={careEventId}
          incidentId={card.incident?.id ?? null}
          facilityId={card.facilityId}
          timeZone={card.timeZone}
          canManage={!locked}
        />
      </RecordDetailSection>

      <RecordDetailSection title="Who was told" description={open ? "Refreshes every 10 seconds while the event is open." : undefined}>
        <CareEventDeliveryLedger
          rows={card.deliveries}
          timeZone={card.timeZone}
          emptyLine={card.level === 1 ? "A Note interrupts nobody. It shows on the Today board and in the next shift handoff." : undefined}
        />
      </RecordDetailSection>
    </div>
  );
}
