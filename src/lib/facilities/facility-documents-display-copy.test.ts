import { describe, expect, it } from "vitest";

import {
  FACILITY_DOCUMENTS_NO_UPLOADER_COPY,
  formatFacilityDocumentUploaderDisplay,
} from "./facility-documents-display-copy";

const EM_DASH = "—";
const POSTED_UPLOADER_ID = "00000000-0000-4000-8000-000000000001";

describe("formatFacilityDocumentUploaderDisplay", () => {
  it("names a missing uploader instead of generic Unknown or an em dash", () => {
    const emptyMap = new Map<string, string>();

    expect(formatFacilityDocumentUploaderDisplay(null, emptyMap)).toBe(
      FACILITY_DOCUMENTS_NO_UPLOADER_COPY,
    );
    expect(formatFacilityDocumentUploaderDisplay(undefined, emptyMap)).toBe(
      FACILITY_DOCUMENTS_NO_UPLOADER_COPY,
    );
    expect(formatFacilityDocumentUploaderDisplay("", emptyMap)).toBe(
      FACILITY_DOCUMENTS_NO_UPLOADER_COPY,
    );
    expect(formatFacilityDocumentUploaderDisplay("   ", emptyMap)).toBe(
      FACILITY_DOCUMENTS_NO_UPLOADER_COPY,
    );
    expect(formatFacilityDocumentUploaderDisplay(POSTED_UPLOADER_ID, emptyMap)).toBe(
      FACILITY_DOCUMENTS_NO_UPLOADER_COPY,
    );
    expect(formatFacilityDocumentUploaderDisplay(POSTED_UPLOADER_ID, new Map())).toBe(
      FACILITY_DOCUMENTS_NO_UPLOADER_COPY,
    );
    expect(
      formatFacilityDocumentUploaderDisplay(
        POSTED_UPLOADER_ID,
        new Map([[POSTED_UPLOADER_ID, ""]]),
      ),
    ).toBe(FACILITY_DOCUMENTS_NO_UPLOADER_COPY);
    expect(
      formatFacilityDocumentUploaderDisplay(
        POSTED_UPLOADER_ID,
        new Map([[POSTED_UPLOADER_ID, "   "]]),
      ),
    ).toBe(FACILITY_DOCUMENTS_NO_UPLOADER_COPY);
    expect(
      formatFacilityDocumentUploaderDisplay(
        POSTED_UPLOADER_ID,
        new Map([[POSTED_UPLOADER_ID, EM_DASH]]),
      ),
    ).toBe(FACILITY_DOCUMENTS_NO_UPLOADER_COPY);
    expect(
      formatFacilityDocumentUploaderDisplay(
        POSTED_UPLOADER_ID,
        new Map([[POSTED_UPLOADER_ID, "Unknown"]]),
      ),
    ).toBe(FACILITY_DOCUMENTS_NO_UPLOADER_COPY);
  });

  it("returns a posted uploader name trimmed", () => {
    const nameByUserId = new Map([[POSTED_UPLOADER_ID, "  Jordan Lee  "]]);
    expect(formatFacilityDocumentUploaderDisplay(POSTED_UPLOADER_ID, nameByUserId)).toBe(
      "Jordan Lee",
    );
  });
});
