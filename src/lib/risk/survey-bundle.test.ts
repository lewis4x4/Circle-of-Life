import { describe, expect, it } from "vitest";

import {
  SURVEY_BUNDLE_PRINT_NO_ADMINISTRATOR_COPY,
  SURVEY_BUNDLE_PRINT_NO_ENTITY_COPY,
  SURVEY_BUNDLE_PRINT_NO_LICENSE_COPY,
  SURVEY_BUNDLE_PRINT_NO_LICENSE_TYPE_COPY,
} from "./survey-bundle-print-display-copy";
import { buildSurveyBundlePacket, surveyBundleToMarkdown } from "./survey-bundle";

const EM_DASH = "—";

function minimalPacket(
  entityName: string | null,
  administratorName: string | null = null,
  licenseNumber: string | null = null,
  licenseType: string | null = null,
  alfLicenseType: string | null = null,
) {
  return buildSurveyBundlePacket({
    facility: {
      id: "facility-001",
      name: "Facility Alpha",
      entityId: null,
      entityName,
      administratorName,
      licenseNumber,
      licenseType,
      alfLicenseType,
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

describe("surveyBundleToMarkdown license line", () => {
  it("names a missing license number with the print gap copy", () => {
    const markdown = surveyBundleToMarkdown(minimalPacket(null, null, null));
    expect(markdown).toContain(
      `License: ${SURVEY_BUNDLE_PRINT_NO_LICENSE_COPY} (${SURVEY_BUNDLE_PRINT_NO_LICENSE_TYPE_COPY})`,
    );
    expect(markdown).not.toContain("License: Missing");
    expect(markdown).not.toContain("unspecified");
  });

  it("names a blank or em-dash license number with the print gap copy", () => {
    expect(surveyBundleToMarkdown(minimalPacket(null, null, ""))).toContain(
      `License: ${SURVEY_BUNDLE_PRINT_NO_LICENSE_COPY} (${SURVEY_BUNDLE_PRINT_NO_LICENSE_TYPE_COPY})`,
    );
    expect(surveyBundleToMarkdown(minimalPacket(null, null, "   "))).toContain(
      `License: ${SURVEY_BUNDLE_PRINT_NO_LICENSE_COPY} (${SURVEY_BUNDLE_PRINT_NO_LICENSE_TYPE_COPY})`,
    );
    expect(surveyBundleToMarkdown(minimalPacket(null, null, EM_DASH))).toContain(
      `License: ${SURVEY_BUNDLE_PRINT_NO_LICENSE_COPY} (${SURVEY_BUNDLE_PRINT_NO_LICENSE_TYPE_COPY})`,
    );
  });

  it("keeps a posted license number", () => {
    const markdown = surveyBundleToMarkdown(minimalPacket(null, null, "ALF-001"));
    expect(markdown).toContain(
      `License: ALF-001 (${SURVEY_BUNDLE_PRINT_NO_LICENSE_TYPE_COPY})`,
    );
  });

  it("names a missing license type with the print gap copy", () => {
    const markdown = surveyBundleToMarkdown(minimalPacket(null, null, "ALF-001", null, null));
    expect(markdown).toContain(`License: ALF-001 (${SURVEY_BUNDLE_PRINT_NO_LICENSE_TYPE_COPY})`);
    expect(markdown).not.toContain("unspecified");
  });

  it("names a blank or em-dash license type with the print gap copy", () => {
    expect(surveyBundleToMarkdown(minimalPacket(null, null, "ALF-001", "", null))).toContain(
      `License: ALF-001 (${SURVEY_BUNDLE_PRINT_NO_LICENSE_TYPE_COPY})`,
    );
    expect(surveyBundleToMarkdown(minimalPacket(null, null, "ALF-001", "   ", null))).toContain(
      `License: ALF-001 (${SURVEY_BUNDLE_PRINT_NO_LICENSE_TYPE_COPY})`,
    );
    expect(surveyBundleToMarkdown(minimalPacket(null, null, "ALF-001", EM_DASH, null))).toContain(
      `License: ALF-001 (${SURVEY_BUNDLE_PRINT_NO_LICENSE_TYPE_COPY})`,
    );
    expect(surveyBundleToMarkdown(minimalPacket(null, null, "ALF-001", null, ""))).toContain(
      `License: ALF-001 (${SURVEY_BUNDLE_PRINT_NO_LICENSE_TYPE_COPY})`,
    );
    expect(surveyBundleToMarkdown(minimalPacket(null, null, "ALF-001", null, EM_DASH))).toContain(
      `License: ALF-001 (${SURVEY_BUNDLE_PRINT_NO_LICENSE_TYPE_COPY})`,
    );
  });

  it("prefers alfLicenseType over licenseType", () => {
    const markdown = surveyBundleToMarkdown(
      minimalPacket(null, null, "ALF-001", "limited", "standard"),
    );
    expect(markdown).toContain("License: ALF-001 (standard)");
    expect(markdown).not.toContain("limited");
  });

  it("falls back to licenseType when alfLicenseType is missing", () => {
    const markdown = surveyBundleToMarkdown(minimalPacket(null, null, "ALF-001", "limited", null));
    expect(markdown).toContain("License: ALF-001 (limited)");
  });
});
