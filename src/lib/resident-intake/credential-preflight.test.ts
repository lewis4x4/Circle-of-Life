import { describe, expect, it } from "vitest";

import { credentialPreflight } from "./credential-preflight";

describe("credentialPreflight", () => {
  it("quarantines deterministic credential filenames without returning matched content", () => {
    const result = credentialPreflight({ fileName: "facility-wifi-password.jpg", mime: "image/jpeg" });
    expect(result).toEqual({ disposition: "quarantine", patternCodes: ["credential_filename", "network_secret_filename"] });
    expect(JSON.stringify(result)).not.toContain("password.jpg");
  });

  it("requires human clearance when local inspection is not trustworthy", () => {
    expect(credentialPreflight({ fileName: "scan-01.pdf", mime: "application/pdf" })).toEqual({
      disposition: "human_clearance_required",
      patternCodes: [],
    });
  });

  it("allows a source only after trustworthy inspection or human clearance", () => {
    expect(credentialPreflight({
      fileName: "scan-01.pdf",
      mime: "application/pdf",
      humanClearanceRecorded: true,
    })).toEqual({ disposition: "allowed", patternCodes: [] });
  });

  it("returns only a pattern code for a locally visible secret", () => {
    const result = credentialPreflight({
      fileName: "notes.txt",
      mime: "text/plain",
      locallyInspectedText: "api_key = super-secret-canary",
      localInspectionTrustworthy: true,
    });
    expect(result).toEqual({ disposition: "quarantine", patternCodes: ["credential_assignment"] });
    expect(JSON.stringify(result)).not.toContain("super-secret-canary");
  });

  it("blocks a full sensitive identifier from provider staging", () => {
    const result = credentialPreflight({
      fileName: "provider-response.json",
      mime: "application/json",
      locallyInspectedText: '{"value":"123-45-6789"}',
      localInspectionTrustworthy: true,
    });
    expect(result).toEqual({ disposition: "quarantine", patternCodes: ["full_sensitive_identifier"] });
    expect(JSON.stringify(result)).not.toContain("123-45-6789");
  });
});
