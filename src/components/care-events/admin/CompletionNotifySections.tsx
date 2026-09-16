"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  correctiveActionChips,
  correctiveActionLabel,
  emsTreatmentOptions,
  familyMethodLabel,
  familyMethodOptions,
  formatClockTime,
} from "@/lib/care-events/admin-copy";
import type { AdminSection, CareEventAdminCard } from "@/lib/care-events/admin-data";

import { ChipRow, ChoiceRow, SectionBlock, chipClass } from "./CompletionChoices";
import { VoiceNoteButton } from "./VoiceNoteButton";

export type CompletionSectionProps = {
  card: CareEventAdminCard;
  busySection: string | null;
  locked: boolean;
  send: (sectionKey: string, section: AdminSection) => void;
};

function NowLaterButtons({
  busy,
  locked,
  onNow,
  onLater,
  nowDisabled,
}: {
  busy: boolean;
  locked: boolean;
  onNow: () => void;
  onLater: () => void;
  nowDisabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="lg" className="min-h-11" disabled={locked || busy || nowDisabled} onClick={onNow}>
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        Yes, now
      </Button>
      <Button type="button" variant="outline" size="lg" className="min-h-11" disabled={locked || busy} onClick={onLater}>
        Later
      </Button>
    </div>
  );
}

/** Section 2 of the paper form: family, physician, EMS. Section 4: corrective action. */
export function FamilySection({ card, busySection, locked, send }: CompletionSectionProps) {
  const [method, setMethod] = useState<string | null>(null);
  const stampedAt = card.incident?.familyNotifiedAt ?? card.admin.familyNotifiedAt;
  const stampedMethod = familyMethodLabel(card.incident?.familyNotifiedMethod);
  const time = formatClockTime(stampedAt, card.timeZone);
  const stamped = time
    ? `Family notified ${time}${stampedMethod ? ` by ${stampedMethod.toLowerCase()}` : ""}`
    : card.admin.familyLater
      ? "Marked for later"
      : null;
  const busy = busySection === "family";
  return (
    <SectionBlock label="Family notified" stamped={stamped}>
      <div className="flex flex-wrap gap-2" role="group" aria-label="How the family was reached">
        {familyMethodOptions.map((option) => (
          <button
            key={option.code}
            type="button"
            aria-pressed={method === option.code}
            disabled={locked || busy}
            className={chipClass(method === option.code)}
            onClick={() => setMethod(option.code)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <NowLaterButtons
        busy={busy}
        locked={locked}
        onNow={() => send("family", { family_notified: { now: true, method: method ?? undefined } })}
        onLater={() => send("family", { family_notified: { now: false } })}
      />
    </SectionBlock>
  );
}

export function PhysicianSection({ card, busySection, locked, send }: CompletionSectionProps) {
  const [orders, setOrders] = useState("");
  const stampedAt = card.incident?.physicianNotifiedAt ?? card.admin.physicianNotifiedAt;
  const time = formatClockTime(stampedAt, card.timeZone);
  const stamped = time
    ? `Physician notified ${time}${card.incident?.physicianOrders ? `. Orders: ${card.incident.physicianOrders}` : ""}`
    : card.admin.physicianLater
      ? "Marked for later"
      : null;
  const busy = busySection === "physician";
  return (
    <SectionBlock label="Physician notified" stamped={stamped}>
      <VoiceNoteButton
        label="Add voice note for orders"
        disabled={locked || busy}
        onTranscript={(text) => setOrders((current) => (current ? `${current} ${text}` : text))}
      />
      {orders ? <p className="text-sm text-foreground">Orders: {orders}</p> : null}
      <NowLaterButtons
        busy={busy}
        locked={locked}
        onNow={() => send("physician", { physician_notified: { now: true, orders: orders || undefined } })}
        onLater={() => send("physician", { physician_notified: { now: false } })}
      />
    </SectionBlock>
  );
}

const EMS_CODES = new Set(emsTreatmentOptions.map((option) => option.code));

export function EmsSection({ card, busySection, locked, send }: CompletionSectionProps) {
  const fromIncident = card.incident?.injuryTreatment && EMS_CODES.has(card.incident.injuryTreatment) ? card.incident.injuryTreatment : null;
  return (
    <ChoiceRow
      label="EMS or 911"
      options={emsTreatmentOptions}
      value={card.admin.ems ?? fromIncident}
      disabled={locked}
      busy={busySection === "ems"}
      onChange={(code) => send("ems", { ems: { treatment: code as "er_visit" | "hospitalization" | "none" } })}
    />
  );
}

export function CorrectiveSection({ card, busySection, locked, send }: CompletionSectionProps) {
  const chips = card.admin.correctiveActions;
  const busy = busySection === "corrective";
  const other = card.admin.correctiveOther;
  return (
    <div className="space-y-3">
      <ChipRow
        label="Corrective action"
        options={correctiveActionChips}
        values={chips}
        disabled={locked}
        busy={busy}
        onToggle={(code) => {
          const next = chips.includes(code) ? chips.filter((chip) => chip !== code) : [...chips, code];
          send("corrective", { corrective_actions: { chips: next, other: other ?? undefined } });
        }}
      />
      {chips.includes("other") ? (
        <VoiceNoteButton
          label="Add voice note for Other"
          disabled={locked || busy}
          onTranscript={(text) =>
            send("corrective", { corrective_actions: { chips, other: other ? `${other} ${text}` : text } })
          }
        />
      ) : null}
      {other ? <p className="text-xs text-muted-foreground">Other: {other}</p> : null}
      {chips.length > 0 ? (
        <p className="text-xs text-muted-foreground">On file: {chips.map(correctiveActionLabel).join(", ")}</p>
      ) : null}
    </div>
  );
}
