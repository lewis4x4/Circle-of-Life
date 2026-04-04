/**
 * Maps stored infection_surveillance.infection_type to outbreak grouping (spec 09).
 * infection_outbreaks.infection_type stores the group name.
 */
export type InfectionOutbreakGroup =
  | "uti"
  | "respiratory"
  | "gi"
  | "skin"
  | "eye"
  | "bloodstream"
  | "covid"
  | "influenza"
  | "other";

export function infectionOutbreakGroup(stored: string): InfectionOutbreakGroup {
  if (stored === "respiratory_upper" || stored === "respiratory_lower") return "respiratory";
  if (stored === "skin_wound" || stored === "skin_fungal") return "skin";
  if (
    stored === "uti" ||
    stored === "gi" ||
    stored === "eye" ||
    stored === "bloodstream" ||
    stored === "covid" ||
    stored === "influenza" ||
    stored === "other"
  ) {
    return stored;
  }
  return "other";
}

/** Stored types that belong to the same outbreak group (for SQL IN (...)). */
export function storedTypesForOutbreakGroup(group: InfectionOutbreakGroup): string[] {
  switch (group) {
    case "respiratory":
      return ["respiratory_upper", "respiratory_lower"];
    case "skin":
      return ["skin_wound", "skin_fungal"];
    default:
      return [group];
  }
}
