/**
 * The taxonomy review packet (COL-354): the document the owner and the
 * compliance reviewer sign against before Homewood's paper incident form and
 * fax are retired.
 *
 * Every line is generated. The tiles and their question rows come from
 * `CARE_EVENT_TILES`, the levels and categories come from `level-cases.json`
 * (the same fixture the TypeScript and SQL level engines are held equal
 * against), and what fires at each level comes from the configuration rows the
 * facility actually runs on. Nothing on the packet is a hand-written list, so a
 * reviewer who signs it has signed what the system does rather than what
 * somebody wrote down about it.
 *
 * No person is named here. The sign-off rows are named by what is being signed;
 * the names are typed on the sheet at print time and are never stored.
 */

import levelCases from "./level-cases.json";
import { CARE_EVENT_TILES, type CareEventQuestion, type CareEventTile } from "./tiles";
import type { CareEventKind, CareEventLevel } from "./level-engine";
import { enumLabel } from "@/lib/display/enum-label";

export type LevelCaseFixture = {
  id: string;
  kind: CareEventKind;
  answers: Record<string, unknown>;
  context?: Record<string, unknown>;
  expect: {
    level: CareEventLevel;
    derived_level: CareEventLevel;
    category: string;
    flags: Record<string, boolean>;
    sentence: string;
  };
};

export const LEVEL_CASES = levelCases as unknown as LevelCaseFixture[];

/**
 * Which paper artefact each tile replaces, from spec 07A Appendix A. This is a
 * reference to the spec's own table, not a taxonomy: it says which sheet in the
 * binder stops, so the reviewer can check the packet against what is on their
 * desk.
 */
const PAPER_REPLACED: Record<CareEventKind, string> = {
  fall: "Incident Form, Section 1 type-of-injury checkboxes and facts; Incident Reports Log fall column",
  injury_found: "Incident Form, Section 1 type-of-injury checkboxes; Incident Reports Log bruise, scrapes or burn, and cut columns",
  condition_change: "Resident Observation Log entry; Incident Form Section 1 when it is promoted",
  behavior: "Incident Form, Section 1 behaviour description; Resident Observation Log entry",
  wandering: "Elopement Incident Form",
  medication: "Medication Incident Report",
  family_complaint: "Grievance Form and Grievance Reports Log",
  environment: "Incident Form, Section 1 for a non-resident event; maintenance log entry",
};

export function paperReplacedByTile(kind: CareEventKind): string {
  return PAPER_REPLACED[kind];
}

export const LEVEL_WORDS: Record<CareEventLevel, string> = {
  1: "Note",
  2: "Heads-up",
  3: "Urgent",
  4: "Emergency",
};

/** A category code as a reviewer reads it, never the raw enum. */
export function categoryLabel(category: string): string {
  return enumLabel(category);
}

/** The answer labels for one fixture, in the tile's own question order. */
export function answerLabels(tile: CareEventTile, answers: Record<string, unknown>): Array<{ prompt: string; answer: string }> {
  return tile.questions.map((question: CareEventQuestion) => {
    const raw = answers[question.key];
    const values = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
    const labels = values.map((value) => {
      const option = question.options.find((candidate) => candidate.value === value);
      return option ? option.label : String(value);
    });
    return { prompt: question.prompt, answer: labels.length > 0 ? labels.join(", ") : "Not answered" };
  });
}

export type TaxonomyCaseRow = {
  id: string;
  answers: Array<{ prompt: string; answer: string }>;
  levelWord: string;
  level: CareEventLevel;
  category: string;
  categoryLabel: string;
  /** True when the reporter's "I'm worried" bump moved it above the derived level. */
  bumped: boolean;
  flagsRaised: string[];
};

export type TaxonomyTileSection = {
  tile: CareEventTile;
  paperReplaced: string;
  questions: CareEventQuestion[];
  cases: TaxonomyCaseRow[];
};

const FLAG_LABELS: Record<string, string> = {
  ahca_reportable: "AHCA reportable",
  insurance_reportable: "Insurance reportable",
  dcf_report_required: "DCF report required",
  grievance_clock: "Grievance clock",
  neuro_checks: "Neuro checks",
  call_911_prompt: "Call 911 prompt",
  photo_prompt: "Photo prompt",
  emar_reminder: "eMAR reminder",
};

export function flagLabel(flag: string): string {
  return FLAG_LABELS[flag] ?? enumLabel(flag);
}

/**
 * The packet body: one section per tile, every fixture under its tile, in the
 * order the tiles appear on the caregiver's screen.
 */
export function buildTaxonomyPacket(): TaxonomyTileSection[] {
  return CARE_EVENT_TILES.map((tile) => {
    const cases = LEVEL_CASES.filter((fixture) => fixture.kind === tile.kind).map((fixture): TaxonomyCaseRow => ({
      id: fixture.id,
      answers: answerLabels(tile, fixture.answers),
      levelWord: LEVEL_WORDS[fixture.expect.level],
      level: fixture.expect.level,
      category: fixture.expect.category,
      categoryLabel: categoryLabel(fixture.expect.category),
      bumped: fixture.expect.level > fixture.expect.derived_level,
      flagsRaised: Object.entries(fixture.expect.flags)
        .filter(([, raised]) => raised)
        .map(([flag]) => flagLabel(flag)),
    }));
    return {
      tile,
      paperReplaced: paperReplacedByTile(tile.kind),
      questions: [...tile.questions],
      cases,
    };
  });
}

export type LevelEffectRow = {
  level: CareEventLevel;
  word: string;
  /** From care_event_escalation_policies: who is told, on which channel, after how long. */
  steps: Array<{ step: number; afterMinutes: number; target: string; channels: string[] }>;
  ackWithinMinutes: number | null;
  /** From incident_followup_protocols: the tasks this level creates. */
  followups: Array<{ taskType: string; description: string; dueOffsetMinutes: number; kind: string; requiresFlag: string | null }>;
};

/** What fires at each level, per the rows the facility is actually configured with. */
export function buildLevelEffects(input: {
  policies: Array<{
    level: string;
    step: number;
    after_minutes: number;
    target_kind: string;
    channels: string[];
    ack_within_minutes: number | null;
    route_name: string | null;
  }>;
  protocols: Array<{
    kind: string;
    min_level: string;
    task_type: string;
    description: string;
    due_offset_minutes: number;
    requires_flag: string | null;
  }>;
}): LevelEffectRow[] {
  const levels: CareEventLevel[] = [1, 2, 3, 4];
  return levels.map((level) => {
    const token = `level_${level}`;
    const forLevel = input.policies.filter((policy) => policy.level === token).sort((a, b) => a.step - b.step);
    return {
      level,
      word: LEVEL_WORDS[level],
      steps: forLevel.map((policy) => ({
        step: policy.step,
        afterMinutes: policy.after_minutes,
        target:
          policy.target_kind === "route"
            ? (policy.route_name ?? "Configured route")
            : policy.target_kind === "on_call_primary"
              ? "On-call primary"
              : "On-call secondary",
        channels: policy.channels,
      })),
      ackWithinMinutes: forLevel.find((policy) => policy.ack_within_minutes !== null)?.ack_within_minutes ?? null,
      followups: input.protocols
        .filter((protocol) => Number(protocol.min_level.replace("level_", "")) <= level)
        .sort((a, b) => a.due_offset_minutes - b.due_offset_minutes)
        .map((protocol) => ({
          taskType: protocol.task_type,
          description: protocol.description,
          dueOffsetMinutes: protocol.due_offset_minutes,
          kind: protocol.kind,
          requiresFlag: protocol.requires_flag,
        })),
    };
  });
}

/** Minutes as an operator says them. */
export function offsetWords(minutes: number): string {
  if (minutes === 0) return "immediately";
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return days === 1 ? "in 1 day" : `in ${days} days`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "in 1 hour" : `in ${hours} hours`;
  }
  return minutes === 1 ? "in 1 minute" : `in ${minutes} minutes`;
}

export function channelWords(channels: readonly string[]): string {
  const words: Record<string, string> = { in_app: "in-app", push: "push", sms: "text", voice: "voice call" };
  return channels.map((channel) => words[channel] ?? channel).join(", ");
}

/**
 * The sign-off page. Named by what is being signed, never by who: the reviewer
 * writes their own name on the line.
 */
export const TAXONOMY_SIGN_OFF_ROWS = [
  {
    subject: "Taxonomy and owner decisions D1 to D7",
    detail:
      "The eight tiles, their questions, the level each answer produces, and the seven owner decisions in spec 07A section 8 are what this facility means.",
  },
  {
    subject: "Paper and fax retirement",
    detail:
      "The paper incident form, the paper witness statement and the paper Incident Reports Log may stop. The physician sheet print and fax continue until a fax decision is made.",
  },
] as const;
