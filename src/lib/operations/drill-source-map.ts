import catalog from "./activity-catalog.json";
import { DRILL_TYPES, OBSERVATION_KINDS } from "./source-records";

/**
 * COL-241 presentation map for the five COL-154 components that have a typed
 * source command. It names which command a component uses and, where the
 * database enforces one, which asset type the record must be written against.
 *
 * Presentation only. Current server eligibility, the allowlist and native
 * authorization always govern, and a mapping here never approves a rule, a
 * cadence or a deadline (Q06, Q09 and Q14 remain open).
 *
 * The review components of the same source rows are deliberately absent:
 * `hfo-al-a07-01`, `hfo-al-a07-02`, `hfo-al-a08-01` and `hfo-al-a08-02` are
 * human reviews that no log can satisfy, and they keep the existing recording
 * path.
 */

type DrillType = (typeof DRILL_TYPES)[number];
type ObservationKind = (typeof OBSERVATION_KINDS)[number];

type DrillEntry = { mode: "drill"; drillType: Extract<DrillType, "fire" | "elopement">; assetType?: never; observationKind?: never };
type ObservationEntry = { mode: "observation"; observationKind: ObservationKind; assetType: string | null; drillType?: never };

const commands: Record<string, DrillEntry | ObservationEntry> = {
  // A fire or elopement drill is written as a draft and becomes final only when a person finalizes it.
  "hfo-al-m05-01": { mode: "drill", drillType: "fire" },
  "hfo-al-m06-01": { mode: "drill", drillType: "elopement" },
  // An observation is recorded final by the person who observed the work, against a named asset.
  "hfo-al-w01-01": { mode: "observation", observationKind: "generator_test", assetType: "generator" },
  // The database does not restrict the asset type of a carbon-monoxide check, so neither does this map.
  "hfo-al-w01-02": { mode: "observation", observationKind: "carbon_monoxide_check", assetType: null },
  "hfo-al-a07-03": { mode: "observation", observationKind: "extinguisher_check", assetType: "fire_extinguisher" },
};

export const DRILL_SOURCE_SOURCE_IDS = ["AL-W01", "AL-M05", "AL-M06", "AL-A07", "AL-A08"] as const;

export type DrillSourceComponent = {
  key: string;
  id: string;
  label: string;
  kind: string;
  subjectKind: string | null;
  sourceId: string;
  questionIds: string[];
  command: DrillEntry | ObservationEntry | null;
  /** What a person still has to do when this component has no typed command. */
  fallback: string;
};

export const drillSourceMap: DrillSourceComponent[] = catalog.entries
  .filter((entry) => (DRILL_SOURCE_SOURCE_IDS as readonly string[]).includes(entry.sourceId))
  .flatMap((entry) =>
    entry.components.map((component) => ({
      ...component,
      sourceId: entry.sourceId,
      questionIds: entry.questionIds,
      command: commands[component.key] ?? null,
      fallback: commands[component.key]
        ? "A recorded source record satisfies this component once. Any separate review, evidence or verification still applies."
        : "Human review through the existing recording path. A log never satisfies its own review.",
    })),
  );

export function drillSourceComponent(activityKey: string | null | undefined): DrillSourceComponent | undefined {
  if (!activityKey) return undefined;
  return drillSourceMap.find((row) => row.key === activityKey && row.command !== null);
}
