import { describe, expect, it } from "vitest";

import {
  FACILITY_FACTS_NO_ADMINISTRATOR_POSTED_COPY,
  FACILITY_FACTS_NO_ASSISTANT_ADMINISTRATOR_POSTED_COPY,
  formatFacilityFactsAdministratorName,
  formatFacilityFactsAssistantAdministratorName,
} from "./facility-facts-display-copy";

const EM_DASH = "—";

describe("formatFacilityFactsAdministratorName", () => {
  it("names a missing administrator instead of an em dash", () => {
    expect(formatFacilityFactsAdministratorName(null)).toBe(
      FACILITY_FACTS_NO_ADMINISTRATOR_POSTED_COPY,
    );
    expect(formatFacilityFactsAdministratorName(undefined)).toBe(
      FACILITY_FACTS_NO_ADMINISTRATOR_POSTED_COPY,
    );
    expect(formatFacilityFactsAdministratorName("")).toBe(
      FACILITY_FACTS_NO_ADMINISTRATOR_POSTED_COPY,
    );
    expect(formatFacilityFactsAdministratorName("   ")).toBe(
      FACILITY_FACTS_NO_ADMINISTRATOR_POSTED_COPY,
    );
    expect(formatFacilityFactsAdministratorName(EM_DASH)).toBe(
      FACILITY_FACTS_NO_ADMINISTRATOR_POSTED_COPY,
    );
    expect(formatFacilityFactsAdministratorName(null)).not.toBe(EM_DASH);
  });

  it("returns a posted administrator name trimmed as-is", () => {
    expect(formatFacilityFactsAdministratorName("Jordan Lee")).toBe("Jordan Lee");
    expect(formatFacilityFactsAdministratorName("  Jordan Lee  ")).toBe("Jordan Lee");
  });
});

describe("formatFacilityFactsAssistantAdministratorName", () => {
  it("names a missing assistant administrator instead of an em dash", () => {
    expect(formatFacilityFactsAssistantAdministratorName(null)).toBe(
      FACILITY_FACTS_NO_ASSISTANT_ADMINISTRATOR_POSTED_COPY,
    );
    expect(formatFacilityFactsAssistantAdministratorName(undefined)).toBe(
      FACILITY_FACTS_NO_ASSISTANT_ADMINISTRATOR_POSTED_COPY,
    );
    expect(formatFacilityFactsAssistantAdministratorName("")).toBe(
      FACILITY_FACTS_NO_ASSISTANT_ADMINISTRATOR_POSTED_COPY,
    );
    expect(formatFacilityFactsAssistantAdministratorName("   ")).toBe(
      FACILITY_FACTS_NO_ASSISTANT_ADMINISTRATOR_POSTED_COPY,
    );
    expect(formatFacilityFactsAssistantAdministratorName(EM_DASH)).toBe(
      FACILITY_FACTS_NO_ASSISTANT_ADMINISTRATOR_POSTED_COPY,
    );
    expect(formatFacilityFactsAssistantAdministratorName(null)).not.toBe(EM_DASH);
  });

  it("returns a posted assistant administrator name trimmed as-is", () => {
    expect(formatFacilityFactsAssistantAdministratorName("Jordan Lee")).toBe("Jordan Lee");
    expect(formatFacilityFactsAssistantAdministratorName("  Jordan Lee  ")).toBe("Jordan Lee");
  });
});
