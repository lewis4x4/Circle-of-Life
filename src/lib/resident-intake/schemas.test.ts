import { describe, expect, it } from "vitest";

import { providerExtractionSchema, residentIntakeCommandBodySchema, validateResidentIntakeCommandFacts } from "./schemas";

const requestKey = "0f3ddfcb-76fd-4a95-815b-6ad5b75b1b77";
const revision = "50d2c3d8-6ad0-4308-b923-838f4ab49fde";
const sourceId = "7a6cae60-acd2-4056-8e60-d22685d43b3d";

describe("resident intake schemas", () => {
  it("rejects unknown provider fact codes and facts on excluded sources", () => {
    const base = { source_classification: "facility", document_class: null, pages: [{ page_number: 1, classification: "facility", document_class: null, confidence: 0.9 }], warnings: [] };
    expect(providerExtractionSchema.safeParse({ ...base, facts: [{ field_code: "sql.table", value: "x", display_value: "x", page_numbers: [1], confidence: 1, evidence: null }] }).success).toBe(false);
    expect(providerExtractionSchema.safeParse({ ...base, facts: [{ field_code: "resident.first_name", value: "A", display_value: "A", page_numbers: [1], confidence: 1, evidence: null }] }).success).toBe(false);
  });

  it("allows only confirmed SSN last four", () => {
    const parsed = residentIntakeCommandBodySchema.parse({
      command: "propose_manual_fact",
      request_key: requestKey,
      expected_revision: revision,
      payload: { source_id: sourceId, field_code: "resident.ssn_last_four", value: "123-45-6789", display_value: "ending 6789", reason: "Reviewed source" },
    });
    expect(validateResidentIntakeCommandFacts(parsed).success).toBe(false);
  });
});
