import { describe, expect, it } from "vitest";

import {
  formatCarePlanAckMethod,
  formatCarePlanAckRole,
  formatCarePlanAckSigner,
  isCarePlanAckMethod,
  isCarePlanAckSignerRole,
} from "./care-plan-acknowledgement-copy";

describe("care-plan acknowledgement copy", () => {
  it("recognises only the roles and methods the table accepts", () => {
    expect(isCarePlanAckSignerRole("poa")).toBe(true);
    expect(isCarePlanAckSignerRole("nurse")).toBe(false);
    expect(isCarePlanAckMethod("verbal_review")).toBe(true);
    expect(isCarePlanAckMethod("emailed")).toBe(false);
    expect(isCarePlanAckMethod(null)).toBe(false);
  });

  it("labels roles and methods for people, and does not invent one for junk", () => {
    expect(formatCarePlanAckRole("responsible_party")).toBe("Responsible party");
    expect(formatCarePlanAckRole("other")).toBe("Signer");
    expect(formatCarePlanAckMethod("paper_on_file")).toBe("Signed on paper (on file)");
    expect(formatCarePlanAckMethod(undefined)).toBe("Acknowledged");
  });

  it("names the signer with their relationship only when posted", () => {
    expect(formatCarePlanAckSigner("Alice Hardin", "daughter")).toBe("Alice Hardin (daughter)");
    expect(formatCarePlanAckSigner("Alice Hardin", "  ")).toBe("Alice Hardin");
    expect(formatCarePlanAckSigner("  ", null)).toBe("No name posted");
  });
});
