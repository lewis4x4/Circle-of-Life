import catalog from "./activity-catalog.json";
import { ASSET_SERVICE_KINDS, DIETARY_RECORD_KINDS, FACILITY_SERVICE_KINDS, OBSERVATION_KINDS } from "./source-records";

/**
 * COL-244 presentation map for the eleven COL-159 components that have a typed
 * source command, plus the rows of the same twenty-one source items that stay
 * on the human recording path.
 *
 * Presentation only. Current server eligibility, the allowlist and native
 * authorization always govern, and a mapping here never approves a rule, a
 * threshold, a reading definition, an equipment list or a deadline (Q09, Q11,
 * Q14 and Q28 remain open; COL-226 owns the approvals).
 *
 * AL-W01 and AL-A07 appear for context only: their records belong to COL-154
 * and are entered on the drill and generator surface, so this map gives them
 * no command and no second screen.
 */

type ObservationKind = (typeof OBSERVATION_KINDS)[number];
type AssetServiceKind = (typeof ASSET_SERVICE_KINDS)[number];
type FacilityServiceKind = (typeof FACILITY_SERVICE_KINDS)[number];
type DietaryKind = (typeof DIETARY_RECORD_KINDS)[number];

export type SourceCommandDescriptor =
  | { mode: "observation"; kind: ObservationKind; assetTypes: readonly string[] }
  | { mode: "asset-service"; kind: AssetServiceKind; assetTypes: readonly string[] }
  | { mode: "facility-service"; kind: FacilityServiceKind; assetTypes?: never }
  | { mode: "dietary"; kind: DietaryKind; assetTypes?: never };

/** Asset types exactly as migration 360 enforces them; a kind with a narrower list is refused against anything else by name. */
const commands: Record<string, SourceCommandDescriptor> = {
  "hfo-al-w04-01": { mode: "observation", kind: "aed_operation_check", assetTypes: ["aed"] },
  "hfo-al-w04-02": { mode: "observation", kind: "aed_equipment_check", assetTypes: ["aed"] },
  "hfo-al-m01-01": { mode: "dietary", kind: "emergency_food_supply_check" },
  "hfo-al-m08-01": { mode: "dietary", kind: "meal_substitution" },
  "hfo-al-y01-01": { mode: "dietary", kind: "menu_approval" },
  "hfo-al-m11-01": { mode: "asset-service", kind: "ac_filter_change", assetTypes: ["ac_unit"] },
  "hfo-al-y03-01": { mode: "asset-service", kind: "extinguisher_inspection", assetTypes: ["fire_extinguisher"] },
  "hfo-al-y05-01": { mode: "asset-service", kind: "hood_cleaning", assetTypes: ["hood_suppression", "kitchen_equipment"] },
  "hfo-al-y02-01": { mode: "facility-service", kind: "fire_safety_inspection" },
  "hfo-al-y04-01": { mode: "facility-service", kind: "fire_inspection" },
  "hfo-al-y04-02": { mode: "facility-service", kind: "sprinkler_inspection" },
};

/** The twenty-one COL-159 source items. */
export const DIETARY_SERVICE_SOURCE_IDS = "AL-D01 AL-D02 AL-D03 AL-D11 AL-D16 AL-W01 AL-W03 AL-W04 AL-M01 AL-M08 AL-M10 AL-M11 AL-A07 AL-A08 AL-Y01 AL-Y02 AL-Y03 AL-Y04 AL-Y05 AL-Y06 AL-Y07".split(" ");

/** Components whose record belongs to COL-154 and is entered on the drill and generator surface. */
const COL_154_COMPONENTS = new Set(["hfo-al-w01-01", "hfo-al-w01-02", "hfo-al-a07-03"]);

export type DietaryServiceComponent = {
  key: string;
  id: string;
  label: string;
  kind: string;
  subjectKind: string | null;
  sourceId: string;
  questionIds: string[];
  command: SourceCommandDescriptor | null;
  fallback: string;
};

export const dietaryServiceSourceMap: DietaryServiceComponent[] = catalog.entries
  .filter((entry) => DIETARY_SERVICE_SOURCE_IDS.includes(entry.sourceId))
  .flatMap((entry) =>
    entry.components.map((component) => ({
      ...component,
      sourceId: entry.sourceId,
      questionIds: entry.questionIds,
      command: commands[component.key] ?? null,
      fallback: commands[component.key]
        ? "A recorded source record satisfies this component once. Any separate review, evidence or verification still applies."
        : COL_154_COMPONENTS.has(component.key)
          ? "Entered on the drill and generator surface; this surface does not record it a second time."
          : "Human recording or review through the existing path. A log never satisfies its own review, and nothing here publishes or sends anything.",
    })),
  );

export function dietaryServiceComponent(activityKey: string | null | undefined): DietaryServiceComponent | undefined {
  if (!activityKey) return undefined;
  return dietaryServiceSourceMap.find((row) => row.key === activityKey && row.command !== null);
}
