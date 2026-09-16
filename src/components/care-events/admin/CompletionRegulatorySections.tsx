"use client";

import { Loader2, Lock } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  CLOSE_READY_LINE,
  ahcaReasonLabel,
  ahcaReasonOptions,
  careEventCloseGateLine,
  formatClockTime,
  loweredLevelLine,
  lowerLevelReasonOptions,
  videoSecuredOptions,
} from "@/lib/care-events/admin-copy";
import { formatLevelWord, type IncidentLevelNumber } from "@/lib/incidents/incidents-display-copy";

import { ChoiceRow, SectionBlock, chipClass } from "./CompletionChoices";
import type { CompletionSectionProps } from "./CompletionNotifySections";

const YES_NO = [
  { code: "yes", label: "Yes" },
  { code: "no", label: "No" },
] as const;

/** Shown only when the final level is 3 or 4. */
export function AhcaSection({ card, busySection, locked, send }: CompletionSectionProps) {
  const [pendingYes, setPendingYes] = useState(false);
  const decided = card.admin.ahcaReportable;
  const value = pendingYes ? "yes" : decided === null ? null : decided ? "yes" : "no";
  const reasonLabel = ahcaReasonLabel(card.admin.ahcaReason);
  const stamped = decided === null ? null : decided ? `Reportable${reasonLabel ? `: ${reasonLabel}` : ""}` : "Not reportable";
  const busy = busySection === "ahca";
  const showReasons = value === "yes";
  return (
    <div className="space-y-3">
      <ChoiceRow
        label="AHCA reportable"
        options={YES_NO}
        value={value}
        disabled={locked}
        busy={busy}
        stamped={stamped}
        onChange={(code) => {
          if (code === "no") {
            setPendingYes(false);
            send("ahca", { ahca: { reportable: false } });
          } else {
            setPendingYes(true);
          }
        }}
      />
      {showReasons ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Reason under s. 429.23">
          {ahcaReasonOptions.map((option) => {
            const on = !pendingYes && card.admin.ahcaReason === option.code;
            return (
              <button
                key={option.code}
                type="button"
                aria-pressed={on}
                disabled={locked || busy}
                className={chipClass(on)}
                onClick={() => {
                  setPendingYes(false);
                  send("ahca", { ahca: { reportable: true, reason_code: option.code } });
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      ) : null}
      {pendingYes ? <p className="text-xs text-muted-foreground">Pick the reason to record the decision.</p> : null}
    </div>
  );
}

/** Shown only when flags.dcf_report_required. */
export function DcfSection({ card, busySection, locked, send }: CompletionSectionProps) {
  const time = formatClockTime(card.admin.dcfReportedAt, card.timeZone);
  const busy = busySection === "dcf";
  return (
    <SectionBlock label="DCF report made" stamped={time ? `DCF report made ${time}` : null}>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="lg"
          className="min-h-11"
          disabled={locked || busy || Boolean(time)}
          onClick={() => send("dcf", { dcf_reported_at: new Date().toISOString() })}
        >
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          Yes, now
        </Button>
        <Button type="button" variant="outline" size="lg" className="min-h-11" disabled aria-pressed={!time}>
          Not yet
        </Button>
      </div>
    </SectionBlock>
  );
}

export function VideoSection({ card, busySection, locked, send }: CompletionSectionProps) {
  return (
    <ChoiceRow
      label="Video secured"
      options={videoSecuredOptions}
      value={card.admin.videoSecured}
      disabled={locked}
      busy={busySection === "video"}
      onChange={(code) => send("video", { video_secured: code as "yes" | "no" | "na" })}
    />
  );
}

export function LowerLevelSection({ card, busySection, locked, send }: CompletionSectionProps) {
  const [level, setLevel] = useState<IncidentLevelNumber | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const busy = busySection === "lower";
  const below = ([1, 2, 3] as const).filter((candidate) => candidate < card.level);
  const stamped = card.level < card.derivedLevel ? loweredLevelLine(card.derivedLevel, card.level, card.levelChangeReason) : null;
  if (below.length === 0) {
    return <SectionBlock label="Lower the level" stamped={stamped}><p className="text-sm text-muted-foreground">Already at the lowest level.</p></SectionBlock>;
  }
  return (
    <SectionBlock label="Lower the level" stamped={stamped}>
      <div className="flex flex-wrap gap-2" role="group" aria-label="New level">
        {below.map((candidate) => (
          <button
            key={candidate}
            type="button"
            aria-pressed={level === candidate}
            disabled={locked || busy}
            className={chipClass(level === candidate)}
            onClick={() => setLevel(candidate)}
          >
            {formatLevelWord(candidate)}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Reason">
        {lowerLevelReasonOptions.map((option) => (
          <button
            key={option.code}
            type="button"
            aria-pressed={reason === option.code}
            disabled={locked || busy}
            className={chipClass(reason === option.code)}
            onClick={() => setReason(option.code)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="min-h-11"
        disabled={locked || busy || level === null || reason === null}
        onClick={() => {
          if (level === null || reason === null) return;
          send("lower", { lower_level: { level, reason } });
          setLevel(null);
          setReason(null);
        }}
      >
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {level ? `Lower to ${formatLevelWord(level)}` : "Lower the level"}
      </Button>
    </SectionBlock>
  );
}

export function CloseSection({ card, busySection, locked, send }: CompletionSectionProps) {
  const busy = busySection === "close";
  if (card.status === "closed") {
    const time = formatClockTime(card.closedAt, card.timeZone);
    return (
      <p role="status" className="inline-flex items-center gap-2 text-sm font-medium text-success">
        <Lock className="size-4" aria-hidden />
        {time ? `Closed ${time}` : "Closed"}
      </p>
    );
  }
  const missing = card.gate?.missing ?? [];
  const gateLine = card.gate ? careEventCloseGateLine(missing) : "Completion is for the Administrator or Assistant.";
  const ready = card.gate !== null && missing.length === 0;
  return (
    <div className="space-y-2">
      <Button type="button" size="lg" className="min-h-12 w-full sm:w-auto" disabled={locked || busy || !ready} onClick={() => send("close", { close: true })}>
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        Close
      </Button>
      <p role="status" className="text-sm text-muted-foreground">
        {gateLine ?? CLOSE_READY_LINE}
      </p>
    </div>
  );
}
