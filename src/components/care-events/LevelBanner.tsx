"use client";

import type { CareEventDerivation, CareEventKind } from "@/lib/care-events/level-engine";
import {
  CARE_EVENT_CALL_911_LINE,
  careEventConsequenceLine,
  careEventEmarReminderLine,
  careEventShowsCall911Line,
} from "@/lib/care-events/level-copy";
import { formatLevelWord } from "@/lib/incidents/incidents-display-copy";
import { cn } from "@/lib/utils";

const LEVEL_CLASSES: Record<1 | 2 | 3 | 4, { box: string; word: string }> = {
  1: { box: "border-border bg-muted/40", word: "text-muted-foreground" },
  2: { box: "border-info/40 bg-info/10", word: "text-info" },
  3: { box: "border-warning/40 bg-warning/10", word: "text-warning" },
  4: { box: "border-destructive/50 bg-destructive/10", word: "text-destructive" },
};

/**
 * Live read-back of the derived level in plain words (spec 07A §2 tap 3).
 * Semantic color only: 1 muted, 2 info, 3 warning, 4 destructive.
 */
export function LevelBanner({ kind, derivation }: { kind: CareEventKind; derivation: CareEventDerivation }) {
  const classes = LEVEL_CLASSES[derivation.level];
  const show911 = careEventShowsCall911Line(kind, derivation.flags);
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={cn("rounded-lg border px-4 py-4", classes.box)}
    >
      <p className={cn("text-2xl font-semibold leading-tight", classes.word)}>{formatLevelWord(derivation.level)}</p>
      <p className="mt-1 text-sm leading-relaxed text-foreground">{careEventConsequenceLine(derivation.level)}</p>
      {show911 ? (
        <p className="mt-2 text-base font-semibold leading-snug text-destructive">{CARE_EVENT_CALL_911_LINE}</p>
      ) : null}
      {derivation.flags.emar_reminder ? (
        <p className="mt-2 text-sm leading-relaxed text-foreground">{careEventEmarReminderLine}</p>
      ) : null}
    </div>
  );
}
