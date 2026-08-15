import { describe, expect, it } from "vitest";

import {
  V2_FORM_OPTIONS_NO_RESIDENT_POSTED_COPY,
  formatV2FormResidentOptionLabel,
} from "./v2-form-options-display-copy";

const EM_DASH = "—";

describe("formatV2FormResidentOptionLabel", () => {
  it("names a missing resident instead of legacy generic copy", () => {
    expect(formatV2FormResidentOptionLabel(null)).toBe(V2_FORM_OPTIONS_NO_RESIDENT_POSTED_COPY);
    expect(formatV2FormResidentOptionLabel(undefined)).toBe(V2_FORM_OPTIONS_NO_RESIDENT_POSTED_COPY);
    expect(formatV2FormResidentOptionLabel(null)).not.toBe("Unnamed resident");
  });

  it("names a blank resident instead of inventing a label", () => {
    expect(formatV2FormResidentOptionLabel("")).toBe(V2_FORM_OPTIONS_NO_RESIDENT_POSTED_COPY);
    expect(formatV2FormResidentOptionLabel("   ")).toBe(V2_FORM_OPTIONS_NO_RESIDENT_POSTED_COPY);
    expect(formatV2FormResidentOptionLabel("")).not.toBe(EM_DASH);
  });

  it("names an em dash resident instead of a silent dash", () => {
    expect(formatV2FormResidentOptionLabel(EM_DASH)).toBe(V2_FORM_OPTIONS_NO_RESIDENT_POSTED_COPY);
    expect(formatV2FormResidentOptionLabel(`  ${EM_DASH}  `)).toBe(
      V2_FORM_OPTIONS_NO_RESIDENT_POSTED_COPY,
    );
    expect(formatV2FormResidentOptionLabel(EM_DASH)).not.toBe("Unnamed resident");
  });

  it("maps legacy Unnamed resident and Unknown to the named gap copy", () => {
    expect(formatV2FormResidentOptionLabel("Unnamed resident")).toBe(
      V2_FORM_OPTIONS_NO_RESIDENT_POSTED_COPY,
    );
    expect(formatV2FormResidentOptionLabel("  Unnamed resident  ")).toBe(
      V2_FORM_OPTIONS_NO_RESIDENT_POSTED_COPY,
    );
    expect(formatV2FormResidentOptionLabel("Unknown")).toBe(V2_FORM_OPTIONS_NO_RESIDENT_POSTED_COPY);
    expect(formatV2FormResidentOptionLabel("  Unknown  ")).toBe(
      V2_FORM_OPTIONS_NO_RESIDENT_POSTED_COPY,
    );
    expect(formatV2FormResidentOptionLabel("Unnamed resident")).not.toBe("Unnamed resident");
    expect(formatV2FormResidentOptionLabel("Unknown")).not.toBe("Unknown");
  });

  it("returns a posted resident name trimmed", () => {
    expect(formatV2FormResidentOptionLabel("Jordan Lee")).toBe("Jordan Lee");
    expect(formatV2FormResidentOptionLabel("  Jordan Lee  ")).toBe("Jordan Lee");
  });
});
