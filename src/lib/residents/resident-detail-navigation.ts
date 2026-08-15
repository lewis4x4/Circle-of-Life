import type {
  ResidentDetailHrefConfig,
  ResidentDetailTabId,
} from "@/components/residents/ResidentDetailTabStrip";

export function adminResidentDetailHrefs(residentId: string): ResidentDetailHrefConfig {
  const residentRootHref = `/admin/residents/${residentId}`;

  return {
    rosterHref: "/admin/residents",
    residentRootHref,
    overviewHref: residentRootHref,
    assessmentsHref: `${residentRootHref}/assessments`,
    carePlanHref: `${residentRootHref}/care-plan`,
    medicationsHref: `${residentRootHref}/medications`,
    vitalsHref: `${residentRootHref}/vitals`,
    billingHref: `${residentRootHref}/billing`,
  };
}

export function residentDetailTabFromSegment(
  segment: string | null,
): ResidentDetailTabId {
  switch (segment) {
    case "assessments":
    case "care-plan":
    case "medications":
    case "vitals":
    case "billing":
      return segment;
    default:
      return "overview";
  }
}
