import { describe, expect, it } from "vitest";

import {
  SURVEY_BUNDLE_PRINT_NO_ADMINISTRATOR_COPY,
  SURVEY_BUNDLE_PRINT_NO_ENTITY_COPY,
} from "./survey-bundle-print-display-copy";
import { buildSurveyBundlePacket, surveyBundleToMarkdown } from "./survey-bundle";

const EM_DASH = "—";

function minimalPacket(
  entityName: string | null,
  administratorName: string | null = null,
) {
  return buildSurveyBundlePacket({
    facility: {
      id: "facility-001",
      name: "Facility Alpha",
      entityId: null,
      entityName,
      administratorName,
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

describe("surveyBundleToMarkdown administrator line", () => {
  it("names a missing administrator with the print gap copy", () => {
    const markdown = surveyBundleToMarkdown(minimalPacket(null, null));
    expect(markdown).toContain(`Administrator: ${SURVEY_BUNDLE_PRINT_NO_ADMINISTRATOR_COPY}`);
    expect(markdown).not.toContain("Administrator: Unknown");
  });

  it("names a blank or em-dash administrator with the print gap copy", () => {
    expect(surveyBundleToMarkdown(minimalPacket(null, ""))).toContain(
      `Administrator: ${SURVEY_BUNDLE_PRINT_NO_ADMINISTRATOR_COPY}`,
    );
    expect(surveyBundleToMarkdown(minimalPacket(null, "   "))).toContain(
      `Administrator: ${SURVEY_BUNDLE_PRINT_NO_ADMINISTRATOR_COPY}`,
    );
    expect(surveyBundleToMarkdown(minimalPacket(null, EM_DASH))).toContain(
      `Administrator: ${SURVEY_BUNDLE_PRINT_NO_ADMINISTRATOR_COPY}`,
    );
  });

  it("keeps a posted administrator name", () => {
    const markdown = surveyBundleToMarkdown(minimalPacket(null, "Admin Alpha"));
    expect(markdown).toContain("Administrator: Admin Alpha");
  });
});
