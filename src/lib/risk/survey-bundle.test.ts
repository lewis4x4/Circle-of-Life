import { describe, expect, it } from "vitest";

import { SURVEY_BUNDLE_PRINT_NO_ENTITY_COPY } from "./survey-bundle-print-display-copy";
import { buildSurveyBundlePacket, surveyBundleToMarkdown } from "./survey-bundle";

const EM_DASH = "—";

function minimalPacket(entityName: string | null) {
  return buildSurveyBundlePacket({
    facility: {
      id: "facility-001",
      name: "Facility Alpha",
      entityId: null,
      entityName,
      administratorName: null,
      licenseNumber: null,
      licenseType: null,
      alfLicenseType: null,
      totalLicensedBeds: 0,
    },
    riskSnapshot: null,
    deficiencies: [],
    documents: [],
    incidents: [],
    policies: [],
    renewalPackets: [],
    auditExports: [],
  });
}

describe("surveyBundleToMarkdown entity line", () => {
  it("names a missing entity with the print gap copy", () => {
    const markdown = surveyBundleToMarkdown(minimalPacket(null));
    expect(markdown).toContain(`Entity: ${SURVEY_BUNDLE_PRINT_NO_ENTITY_COPY}`);
    expect(markdown).not.toContain("Unknown entity");
  });

  it("names a blank or em-dash entity with the print gap copy", () => {
    expect(surveyBundleToMarkdown(minimalPacket(""))).toContain(`Entity: ${SURVEY_BUNDLE_PRINT_NO_ENTITY_COPY}`);
    expect(surveyBundleToMarkdown(minimalPacket("   "))).toContain(`Entity: ${SURVEY_BUNDLE_PRINT_NO_ENTITY_COPY}`);
    expect(surveyBundleToMarkdown(minimalPacket(EM_DASH))).toContain(`Entity: ${SURVEY_BUNDLE_PRINT_NO_ENTITY_COPY}`);
  });

  it("keeps a posted entity name", () => {
    const markdown = surveyBundleToMarkdown(minimalPacket("Entity Alpha LLC"));
    expect(markdown).toContain("Entity: Entity Alpha LLC");
  });
});
