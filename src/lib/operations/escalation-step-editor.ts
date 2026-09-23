import { OCE_TEMPLATE_ASSIGNEE_ROLES } from "@/lib/operations/constants";
import { normalizeEscalationLadder, type OperationEscalationStep } from "@/lib/operations/templates";

/**
 * COL-689 — the escalation ladder on an operations template is edited as rows, not JSON.
 *
 * A row is who is escalated to, how, and after how many minutes. The stored shape is
 * unchanged: `[{ role, sla_minutes, channel, enabled }]`, the same array
 * `normalizeEscalationLadder` reads and `parseEscalationLadder` runs.
 */
export type EscalationStepDraft = {
  role: string;
  channel: string;
  sla_minutes: string;
  enabled: boolean;
};

/** The channels the escalation runner delivers (src/lib/operations/escalation.ts). */
export const ESCALATION_CHANNELS = [
  { value: "in_app", label: "In the app" },
  { value: "sms", label: "Text message" },
  { value: "voice", label: "Phone call" },
] as const;

export const ESCALATION_ROLES: readonly string[] = OCE_TEMPLATE_ASSIGNEE_ROLES;

/** The step a new template starts with (the ladder the JSON field used to show). */
export const DEFAULT_ESCALATION_STEP: EscalationStepDraft = {
  role: "facility_administrator",
  channel: "in_app",
  sla_minutes: "30",
  enabled: true,
};

export function blankEscalationStep(): EscalationStepDraft {
  return { role: "", channel: "in_app", sla_minutes: "", enabled: true };
}

export function ladderToDrafts(ladder: unknown): EscalationStepDraft[] {
  return normalizeEscalationLadder(ladder).map((step) => ({
    role: step.role,
    channel: step.channel,
    sla_minutes: String(step.sla_minutes),
    enabled: step.enabled,
  }));
}

/** Rows back to the stored ladder, or the first problem in staff words. */
export function draftsToLadder(
  drafts: readonly EscalationStepDraft[],
): { steps: OperationEscalationStep[] } | { error: string } {
  const steps: OperationEscalationStep[] = [];
  for (const [index, draft] of drafts.entries()) {
    const n = index + 1;
    if (!draft.role.trim()) return { error: `Step ${n}: choose who it escalates to.` };
    if (!draft.channel.trim()) return { error: `Step ${n}: choose how they are reached.` };
    const text = draft.sla_minutes.trim();
    const minutes = Number(text);
    if (!text || !Number.isInteger(minutes) || minutes < 0) {
      return { error: `Step ${n}: enter the minutes to wait as a whole number (0 or more).` };
    }
    steps.push({ role: draft.role.trim(), channel: draft.channel.trim(), sla_minutes: minutes, enabled: draft.enabled });
  }
  return { steps };
}

export function moveEscalationStep(
  drafts: readonly EscalationStepDraft[],
  index: number,
  direction: -1 | 1,
): EscalationStepDraft[] {
  const target = index + direction;
  if (index < 0 || index >= drafts.length || target < 0 || target >= drafts.length) return [...drafts];
  const next = [...drafts];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function removeEscalationStep(drafts: readonly EscalationStepDraft[], index: number): EscalationStepDraft[] {
  return drafts.filter((_, i) => i !== index);
}
