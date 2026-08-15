import { describe, expect, it } from "vitest";

import {
  V2_LIST_NO_RESIDENT_POSTED_COPY,
  formatV2ListResidentPrimary,
} from "./v2-lists-display-copy";

const EM_DASH = "—";

describe("formatV2ListResidentPrimary", () => {
  it("names a missing resident instead of an em dash", () => {
    expect(formatV2ListResidentPrimary(null)).toBe(V2_LIST_NO_RESIDENT_POSTED_COPY);
    expect(formatV2ListResidentPrimary(undefined)).toBe(V2_LIST_NO_RESIDENT_POSTED_COPY);
    expect(formatV2ListResidentPrimary(null)).not.toBe(EM_DASH);
  });

  it("names a blank resident instead of an em dash", () => {
    expect(formatV2ListResidentPrimary("")).toBe(V2_LIST_NO_RESIDENT_POSTED_COPY);
    expect(formatV2ListResidentPrimary("   ")).toBe(V2_LIST_NO_RESIDENT_POSTED_COPY);
    expect(formatV2ListResidentPrimary("")).not.toBe(EM_DASH);
  });

  it("names an em dash resident instead of a silent dash", () => {
    expect(formatV2ListResidentPrimary(EM_DASH)).toBe(V2_LIST_NO_RESIDENT_POSTED_COPY);
    expect(formatV2ListResidentPrimary(`  ${EM_DASH}  `)).toBe(V2_LIST_NO_RESIDENT_POSTED_COPY);
    expect(formatV2ListResidentPrimary(EM_DASH)).not.toBe("Unnamed resident");
  });

  it("returns a posted resident name trimmed", () => {
    expect(formatV2ListResidentPrimary("Jordan Lee")).toBe("Jordan Lee");
    expect(formatV2ListResidentPrimary("  Jordan Lee  ")).toBe("Jordan Lee");
  });
});
