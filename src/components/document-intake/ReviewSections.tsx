"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { RecordDetailSection } from "@/design-system/components/record-detail";
import { destinationHref, type CheckVerdict, type CheckVerdicts, type EventRow, type FilingRow, type IntakeItem, type ProposalRow, type StageStatus } from "@/lib/document-intake/contracts";
import { enumLabel } from "@/lib/display/enum-label";
import { formatFacilityTimestampEt } from "@/lib/facility-wall-clock";

import {
  CHECK_RESULT_LABELS,
  CHECK_RESULT_TONES,
  DESTINATION_KIND_LABELS,
  eventLabel,
  flaggedJevChecks,
  jevAnswerLine,
  principalLabel,
  stageStatusLabel,
  stageTone,
} from "./model";
import { JevVerdictControl } from "./JevVerdictControl";

const OPEN_LABELS: Record<FilingRow["destination_kind"], string> = {
  resident_document: "Open the resident’s documents",
  benefits_document: "Open the Medicaid case",
  employee_file: "Open the staff file",
  facility_document: "Open facility documents",
};

type JevBlock = { model?: string; questions_version?: string; answers?: Record<string, Parameters<typeof jevAnswerLine>[0]> };

export function AssessmentSection({
  item,
  proposal,
  verdicts = {},
  onVerdictChange,
}: {
  item: Pick<IntakeItem, "processing_state" | "processing_reason">;
  proposal: ProposalRow | null;
  /** Reviewer grades of flagged Jev checks; the control shows only while the document can be filed. */
  verdicts?: CheckVerdicts;
  onVerdictChange?: (code: string, verdict: CheckVerdict) => void;
}) {
  const [showJev, setShowJev] = useState(false);
  const reader = proposal?.stage_status?.reader as StageStatus | undefined;
  const jevStatus = proposal?.stage_status?.jev as StageStatus | undefined;
  const jev = (proposal?.jev ?? {}) as JevBlock;
  const answers = Object.entries(jev.answers ?? {});
  const checks = proposal?.checks ?? [];
  const warnings = proposal?.warnings ?? [];
  const flagged = new Set(onVerdictChange ? flaggedJevChecks(proposal).map((c) => c.code) : []);

  return (
    <RecordDetailSection title="Assessment" description="What the reader and Jev found. A person decides; nothing here files the document.">
      <dl className="grid gap-2 text-sm">
        {(["reader", "jev"] as const).map((stage) => {
          const status = stage === "reader" ? reader : jevStatus;
          return (
            <div key={stage} className="flex flex-wrap items-center gap-2">
              <dt className="w-16 shrink-0 text-muted-foreground">{stage === "reader" ? "Reader" : "Jev"}</dt>
              <dd className="flex flex-wrap items-center gap-2">
                <StatusPill tone={stageTone(status, item.processing_state)}>{stageStatusLabel(stage, status, proposal ? undefined : item.processing_state)}</StatusPill>
                {status?.reason ? <span className="text-muted-foreground">{status.reason}</span> : null}
                {!status && !proposal && item.processing_reason ? <span className="text-muted-foreground">{item.processing_reason}</span> : null}
              </dd>
            </div>
          );
        })}
      </dl>

      {answers.length ? (
        <div className="mt-3">
          <Button type="button" variant="outline" size="sm" aria-expanded={showJev} onClick={() => setShowJev((v) => !v)}>
            {showJev ? "Hide details" : "Show details"}
          </Button>
          {showJev ? (
            <div className="mt-2 grid gap-1 text-sm">
              <ul className="grid gap-1">
                {answers.map(([question, answer]) => {
                  const line = jevAnswerLine(answer);
                  return (
                    <li key={question} className="flex flex-wrap gap-x-2">
                      <span className="text-muted-foreground">{enumLabel(question)}:</span>
                      <span className="font-medium text-foreground">{line.chosen}</span>
                      {line.probability ? <span className="tabular-nums text-muted-foreground">{line.probability}</span> : null}
                    </li>
                  );
                })}
              </ul>
              <p className="text-xs text-muted-foreground">
                Probabilities are Jev’s own numbers for its answer, not a measure of accuracy.
                {jev.model ? ` Model ${jev.model}.` : ""}
                {jev.questions_version ? ` Questions ${jev.questions_version}.` : ""}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {checks.length ? (
        <div className="mt-3 grid gap-1">
          <h3 className="text-xs font-semibold text-muted-foreground">Checks</h3>
          <ul className="grid gap-1 text-sm">
            {checks.map((check) => (
              <li key={check.code} className="grid gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone={CHECK_RESULT_TONES[check.result]}>{CHECK_RESULT_LABELS[check.result]}</StatusPill>
                  <span className="text-foreground">{check.label}</span>
                  {check.detail ? <span className="text-muted-foreground">{check.detail}</span> : null}
                </div>
                {onVerdictChange && flagged.has(check.code) ? (
                  <JevVerdictControl checkLabel={check.label} value={verdicts[check.code] ?? null} onChange={(v) => onVerdictChange(check.code, v)} />
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {warnings.length ? (
        <div className="mt-3 grid gap-1">
          <h3 className="text-xs font-semibold text-muted-foreground">Warnings</h3>
          <ul className="grid gap-1 text-sm">
            {warnings.map((w) => (
              <li key={w.code} className="text-foreground">
                {w.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </RecordDetailSection>
  );
}

function eventDetail(event: EventRow): string | null {
  const reason = event.detail.reason;
  if (typeof reason === "string" && reason.trim()) return reason;
  const title = event.detail.title;
  if (event.event === "set_title" && typeof title === "string") return title;
  if (event.event === "received" && event.detail.channel === "email") return "By email";
  if (event.event === "received" && event.detail.channel === "split") return "From a split";
  return null;
}

export function HistorySection({ events, names }: { events: EventRow[]; names: Record<string, string> }) {
  return (
    <RecordDetailSection title="History">
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">No history yet.</p>
      ) : (
        <ol className="grid gap-2 text-sm">
          {events.map((event) => {
            const detail = eventDetail(event);
            return (
              <li key={event.id} className="grid gap-0.5 border-l-2 border-border pl-3">
                <span className="font-medium text-foreground">{eventLabel(event.event)}</span>
                <span className="text-xs text-muted-foreground">
                  {principalLabel(event.principal, event.actor_id ? (names[event.actor_id] ?? null) : null)} · {formatFacilityTimestampEt(event.created_at)} ET
                </span>
                {detail ? <span className="text-muted-foreground">{detail}</span> : null}
              </li>
            );
          })}
        </ol>
      )}
    </RecordDetailSection>
  );
}

export function FilingReceipt({
  filing,
  href,
  typeLabel,
  names,
  onCorrect,
}: {
  filing: FilingRow;
  href: string | null;
  typeLabel: string;
  names: Record<string, string>;
  onCorrect: (() => void) | null;
}) {
  const link = href ?? destinationHref(filing.destination_kind, filing);
  const corrected = filing.state === "corrected";
  return (
    <RecordDetailSection title={corrected ? "Filing corrected" : "Filed"} description={corrected ? "This filing was marked as a mistake. The history keeps both." : "This document is part of the record."}>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Title</dt>
          <dd className="font-medium text-foreground">{filing.title}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Type</dt>
          <dd className="text-foreground">{typeLabel}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Filed to</dt>
          <dd className="text-foreground">{DESTINATION_KIND_LABELS[filing.destination_kind]}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Approved</dt>
          <dd className="text-foreground">
            {names[filing.approved_by] ?? "A reviewer"}
            {filing.approved_at ? ` · ${formatFacilityTimestampEt(filing.approved_at)} ET` : ""}
          </dd>
        </div>
        {corrected ? (
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">Correction</dt>
            <dd className="text-foreground">
              {filing.correction_reason}
              {filing.corrected_by ? ` · ${names[filing.corrected_by] ?? "a reviewer"}` : ""}
              {filing.corrected_at ? `, ${formatFacilityTimestampEt(filing.corrected_at)} ET` : ""}
            </dd>
          </div>
        ) : null}
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        {!corrected ? (
          <Link href={link} className="inline-flex min-h-11 items-center rounded-[var(--radius)] border border-border px-3 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {OPEN_LABELS[filing.destination_kind]}
          </Link>
        ) : null}
        {onCorrect && !corrected ? (
          <Button type="button" variant="outline" onClick={onCorrect}>
            Correct filing
          </Button>
        ) : null}
      </div>
    </RecordDetailSection>
  );
}
