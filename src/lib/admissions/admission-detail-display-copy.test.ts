import { describe, expect, it } from "vitest";

import {
  ADMISSION_DETAIL_NO_BED_COPY,
  ADMISSION_DETAIL_NO_CHECKLIST_RECEIVED_COPY,
  ADMISSION_DETAIL_NO_EFFECTIVE_DATE_COPY,
  ADMISSION_DETAIL_NO_FORM1823_RECORD_COPY,
  ADMISSION_DETAIL_NO_REFERRAL_LEAD_COPY,
  formatAdmissionDetailBedLabel,
  formatAdmissionDetailChecklistReceivedAt,
  formatAdmissionDetailEffectiveDate,
  formatAdmissionDetailForm1823LatestUpdated,
  formatAdmissionDetailReferralLeadName,
} from "./admission-detail-display-copy";

const EM_DASH = "—";

describe("formatAdmissionDetailBedLabel", () => {
  it("names a missing bed instead of an em dash", () => {
    expect(formatAdmissionDetailBedLabel(null)).toBe(ADMISSION_DETAIL_NO_BED_COPY);
    expect(formatAdmissionDetailBedLabel("")).toBe(ADMISSION_DETAIL_NO_BED_COPY);
    expect(formatAdmissionDetailBedLabel("   ")).toBe(ADMISSION_DETAIL_NO_BED_COPY);
    expect(formatAdmissionDetailBedLabel(null)).not.toBe(EM_DASH);
  });

  it("returns a posted bed label trimmed", () => {
    expect(formatAdmissionDetailBedLabel("12A")).toBe("12A");
    expect(formatAdmissionDetailBedLabel(" 12A ")).toBe("12A");
  });
});

describe("formatAdmissionDetailEffectiveDate", () => {
  it("names a missing effective date instead of an em dash", () => {
    expect(formatAdmissionDetailEffectiveDate(null)).toBe(ADMISSION_DETAIL_NO_EFFECTIVE_DATE_COPY);
    expect(formatAdmissionDetailEffectiveDate("")).toBe(ADMISSION_DETAIL_NO_EFFECTIVE_DATE_COPY);
    expect(formatAdmissionDetailEffectiveDate("   ")).toBe(ADMISSION_DETAIL_NO_EFFECTIVE_DATE_COPY);
    expect(formatAdmissionDetailEffectiveDate(null)).not.toBe(EM_DASH);
  });

  it("returns a posted effective date trimmed", () => {
    expect(formatAdmissionDetailEffectiveDate("2026-08-24")).toBe("2026-08-24");
    expect(formatAdmissionDetailEffectiveDate(" 2026-08-24 ")).toBe("2026-08-24");
  });
});

describe("formatAdmissionDetailReferralLeadName", () => {
  it("names a missing referral lead instead of an em dash", () => {
    expect(formatAdmissionDetailReferralLeadName(null)).toBe(ADMISSION_DETAIL_NO_REFERRAL_LEAD_COPY);
    expect(formatAdmissionDetailReferralLeadName({ first_name: "", last_name: "" })).toBe(
      ADMISSION_DETAIL_NO_REFERRAL_LEAD_COPY,
    );
    expect(formatAdmissionDetailReferralLeadName(null)).not.toBe(EM_DASH);
  });

  it("returns a posted lead name without fabrication", () => {
    expect(
      formatAdmissionDetailReferralLeadName({ first_name: "Alex", last_name: "Rivera" }),
    ).toBe("Alex Rivera");
  });
});

describe("formatAdmissionDetailForm1823LatestUpdated", () => {
  it("names a missing record instead of an em dash", () => {
    expect(formatAdmissionDetailForm1823LatestUpdated(null)).toBe(
      ADMISSION_DETAIL_NO_FORM1823_RECORD_COPY,
    );
    expect(formatAdmissionDetailForm1823LatestUpdated(null)).not.toBe(EM_DASH);
  });

  it("formats a posted updated_at timestamp", () => {
    const formatted = formatAdmissionDetailForm1823LatestUpdated({
      updated_at: "2026-08-24T12:00:00.000Z",
    });
    expect(formatted).toBe(new Date("2026-08-24T12:00:00.000Z").toLocaleString());
  });
});

describe("formatAdmissionDetailChecklistReceivedAt", () => {
  it("names a missing received date instead of an em dash", () => {
    expect(formatAdmissionDetailChecklistReceivedAt(null)).toBe(
      ADMISSION_DETAIL_NO_CHECKLIST_RECEIVED_COPY,
    );
    expect(formatAdmissionDetailChecklistReceivedAt("")).toBe(
      ADMISSION_DETAIL_NO_CHECKLIST_RECEIVED_COPY,
    );
    expect(formatAdmissionDetailChecklistReceivedAt(null)).not.toBe(EM_DASH);
  });

  it("formats a posted received_at timestamp", () => {
    const formatted = formatAdmissionDetailChecklistReceivedAt("2026-08-24T12:00:00.000Z");
    expect(formatted).toBe(new Date("2026-08-24T12:00:00.000Z").toLocaleString());
  });
});
