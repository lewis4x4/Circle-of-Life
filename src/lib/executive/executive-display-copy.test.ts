import { describe, expect, it } from "vitest";

import { FORMAT_USD_NO_AMOUNT_POSTED_COPY } from "@/lib/insurance/format-money";

import {
  EXECUTIVE_NO_CERT_COUNT_POSTED_COPY,
  EXECUTIVE_NO_COMPLETENESS_POSTED_COPY,
  EXECUTIVE_NO_CONFIDENCE_POSTED_COPY,
  EXECUTIVE_NO_DATE_POSTED_COPY,
  EXECUTIVE_NO_DEFICIENCY_COUNT_POSTED_COPY,
  EXECUTIVE_NO_GENERATE_TIME_POSTED_COPY,
  EXECUTIVE_NO_HOSPITAL_COUNT_POSTED_COPY,
  EXECUTIVE_NO_IN_HOUSE_COUNT_POSTED_COPY,
  EXECUTIVE_NO_INCIDENT_COUNT_POSTED_COPY,
  EXECUTIVE_NO_INVOICE_COUNT_POSTED_COPY,
  EXECUTIVE_NO_LEAVE_COUNT_POSTED_COPY,
  EXECUTIVE_NO_LEAGUE_SCORE_POSTED_COPY,
  EXECUTIVE_NO_OCCUPANCY_POSTED_COPY,
  EXECUTIVE_NO_PACKET_STATUS_POSTED_COPY,
  EXECUTIVE_NO_RISK_SCORE_POSTED_COPY,
  EXECUTIVE_STANDUP_MANUAL_OR_FUTURE_FEED_COPY,
  EXECUTIVE_STANDUP_NO_DELTA_COPY,
  formatExecutiveArOutstandingCents,
  formatExecutiveCertsExpiringCount,
  formatExecutiveCompletenessPct,
  formatExecutiveConfidenceBand,
  formatExecutiveHospitalCount,
  formatExecutiveInHouseCount,
  formatExecutiveLastGeneratedAt,
  formatExecutiveLeagueScore,
  formatExecutiveNoMetricPostedCopy,
  formatExecutiveOccupancyBarLabel,
  formatExecutiveOccupancyPct,
  formatExecutiveOccupancyPctWithSuffix,
  formatExecutiveOfficerCountLabel,
  formatExecutiveOfficerKpiValue,
  formatExecutiveOnLeaveCount,
  formatExecutiveOpenIncidentCount,
  formatExecutiveOpenInvoiceCount,
  formatExecutivePacketStatus,
  formatExecutiveRelativeAge,
  formatExecutiveRevenueMtdCents,
  formatExecutiveRiskScore,
  formatExecutiveSurveyDeficiencyCount,
  formatStandupMetricDelta,
  formatStandupMetricValue,
} from "./executive-display-copy";
import type { StandupMetricRow } from "./standup";

describe("formatExecutiveOccupancyPct", () => {
  it("names the gap when occupancy is missing", () => {
    expect(formatExecutiveOccupancyPct(null)).toBe(EXECUTIVE_NO_OCCUPANCY_POSTED_COPY);
    expect(formatExecutiveOccupancyPct(undefined)).toBe(EXECUTIVE_NO_OCCUPANCY_POSTED_COPY);
  });

  it("keeps real zero as zero", () => {
    expect(formatExecutiveOccupancyPct(0)).toBe("0");
  });

  it("formats posted occupancy values", () => {
    expect(formatExecutiveOccupancyPct(87.5)).toBe("87.5");
  });
});

describe("formatExecutiveOccupancyPctWithSuffix", () => {
  it("keeps real zero as 0%", () => {
    expect(formatExecutiveOccupancyPctWithSuffix(0)).toBe("0%");
  });

  it("names the gap when occupancy is missing", () => {
    expect(formatExecutiveOccupancyPctWithSuffix(null)).toBe(EXECUTIVE_NO_OCCUPANCY_POSTED_COPY);
  });
});

describe("formatExecutiveOccupancyBarLabel", () => {
  it("formats posted occupancy with one decimal", () => {
    expect(formatExecutiveOccupancyBarLabel(82.456)).toBe("82.5%");
  });

  it("keeps real zero as 0.0%", () => {
    expect(formatExecutiveOccupancyBarLabel(0)).toBe("0.0%");
  });
});

describe("formatExecutivePacketStatus", () => {
  it("names the gap when packet status is missing", () => {
    expect(formatExecutivePacketStatus(null)).toBe(EXECUTIVE_NO_PACKET_STATUS_POSTED_COPY);
    expect(formatExecutivePacketStatus("")).toBe(EXECUTIVE_NO_PACKET_STATUS_POSTED_COPY);
  });

  it("returns posted status unchanged", () => {
    expect(formatExecutivePacketStatus("published")).toBe("published");
  });
});

describe("formatExecutiveConfidenceBand", () => {
  it("names the gap when confidence is missing", () => {
    expect(formatExecutiveConfidenceBand(null)).toBe(EXECUTIVE_NO_CONFIDENCE_POSTED_COPY);
    expect(formatExecutiveConfidenceBand("   ")).toBe(EXECUTIVE_NO_CONFIDENCE_POSTED_COPY);
  });

  it("returns posted confidence unchanged", () => {
    expect(formatExecutiveConfidenceBand("high")).toBe("high");
  });
});

describe("formatExecutiveLeagueScore", () => {
  it("names the gap when league score is missing", () => {
    expect(formatExecutiveLeagueScore(null)).toBe(EXECUTIVE_NO_LEAGUE_SCORE_POSTED_COPY);
  });

  it("keeps real zero as 0/100", () => {
    expect(formatExecutiveLeagueScore(0)).toBe("0/100");
  });
});

describe("formatExecutiveRiskScore", () => {
  it("names the gap when risk score is missing", () => {
    expect(formatExecutiveRiskScore(undefined)).toBe(EXECUTIVE_NO_RISK_SCORE_POSTED_COPY);
  });

  it("keeps real zero as 0/100", () => {
    expect(formatExecutiveRiskScore(0)).toBe("0/100");
  });
});

describe("formatExecutiveCompletenessPct", () => {
  it("names the gap when completeness is missing", () => {
    expect(formatExecutiveCompletenessPct(null)).toBe(EXECUTIVE_NO_COMPLETENESS_POSTED_COPY);
  });

  it("keeps real zero as 0%", () => {
    expect(formatExecutiveCompletenessPct(0)).toBe("0%");
  });
});

describe("formatExecutiveRevenueMtdCents", () => {
  it("names the gap when revenue is missing", () => {
    expect(formatExecutiveRevenueMtdCents(null)).toBe(FORMAT_USD_NO_AMOUNT_POSTED_COPY);
    expect(formatExecutiveRevenueMtdCents(undefined)).toBe(FORMAT_USD_NO_AMOUNT_POSTED_COPY);
  });

  it("keeps real zero as $0.00", () => {
    expect(formatExecutiveRevenueMtdCents(0)).toBe("$0.00");
  });
});

describe("formatExecutiveArOutstandingCents", () => {
  it("names the gap when AR is missing", () => {
    expect(formatExecutiveArOutstandingCents(null)).toBe(FORMAT_USD_NO_AMOUNT_POSTED_COPY);
    expect(formatExecutiveArOutstandingCents(undefined)).toBe(FORMAT_USD_NO_AMOUNT_POSTED_COPY);
  });

  it("keeps real zero as $0.00", () => {
    expect(formatExecutiveArOutstandingCents(0)).toBe("$0.00");
  });
});

describe("formatExecutiveSurveyDeficiencyCount", () => {
  it("names the gap when deficiency count is missing", () => {
    expect(formatExecutiveSurveyDeficiencyCount(null)).toBe(EXECUTIVE_NO_DEFICIENCY_COUNT_POSTED_COPY);
    expect(formatExecutiveSurveyDeficiencyCount(undefined)).toBe(EXECUTIVE_NO_DEFICIENCY_COUNT_POSTED_COPY);
  });

  it("keeps real zero as 0", () => {
    expect(formatExecutiveSurveyDeficiencyCount(0)).toBe("0");
  });
});

describe("formatExecutiveOpenIncidentCount", () => {
  it("names the gap when incident count is missing", () => {
    expect(formatExecutiveOpenIncidentCount(null)).toBe(EXECUTIVE_NO_INCIDENT_COUNT_POSTED_COPY);
    expect(formatExecutiveOpenIncidentCount(undefined)).toBe(EXECUTIVE_NO_INCIDENT_COUNT_POSTED_COPY);
  });

  it("keeps real zero as 0", () => {
    expect(formatExecutiveOpenIncidentCount(0)).toBe("0");
  });
});

describe("formatExecutiveOpenInvoiceCount", () => {
  it("names the gap when invoice count is missing", () => {
    expect(formatExecutiveOpenInvoiceCount(null)).toBe(EXECUTIVE_NO_INVOICE_COUNT_POSTED_COPY);
    expect(formatExecutiveOpenInvoiceCount(undefined)).toBe(EXECUTIVE_NO_INVOICE_COUNT_POSTED_COPY);
  });

  it("keeps real zero as 0", () => {
    expect(formatExecutiveOpenInvoiceCount(0)).toBe("0");
  });
});

describe("formatExecutiveCertsExpiringCount", () => {
  it("names the gap when cert count is missing", () => {
    expect(formatExecutiveCertsExpiringCount(null)).toBe(EXECUTIVE_NO_CERT_COUNT_POSTED_COPY);
    expect(formatExecutiveCertsExpiringCount(undefined)).toBe(EXECUTIVE_NO_CERT_COUNT_POSTED_COPY);
  });

  it("keeps real zero as 0", () => {
    expect(formatExecutiveCertsExpiringCount(0)).toBe("0");
  });
});

describe("formatExecutiveInHouseCount", () => {
  it("names the gap when presence is missing", () => {
    expect(formatExecutiveInHouseCount(null)).toBe(EXECUTIVE_NO_IN_HOUSE_COUNT_POSTED_COPY);
    expect(formatExecutiveInHouseCount(undefined)).toBe(EXECUTIVE_NO_IN_HOUSE_COUNT_POSTED_COPY);
  });

  it("keeps real zero as 0", () => {
    expect(formatExecutiveInHouseCount({ inHouse: 0, hospital: 0, onLeave: 0, onHold: 0, total: 0 })).toBe("0");
  });

  it("formats posted in-house count", () => {
    expect(formatExecutiveInHouseCount({ inHouse: 12, hospital: 1, onLeave: 0, onHold: 1, total: 13 })).toBe("12");
  });
});

describe("formatExecutiveHospitalCount", () => {
  it("names the gap when presence is missing", () => {
    expect(formatExecutiveHospitalCount(null)).toBe(EXECUTIVE_NO_HOSPITAL_COUNT_POSTED_COPY);
  });

  it("keeps real zero as 0", () => {
    expect(formatExecutiveHospitalCount({ inHouse: 5, hospital: 0, onLeave: 0, onHold: 0, total: 5 })).toBe("0");
  });
});

describe("formatExecutiveOnLeaveCount", () => {
  it("names the gap when presence is missing", () => {
    expect(formatExecutiveOnLeaveCount(undefined)).toBe(EXECUTIVE_NO_LEAVE_COUNT_POSTED_COPY);
  });

  it("keeps real zero as 0", () => {
    expect(formatExecutiveOnLeaveCount({ inHouse: 5, hospital: 0, onLeave: 0, onHold: 0, total: 5 })).toBe("0");
  });
});

describe("formatExecutiveLastGeneratedAt", () => {
  it("names the gap when generate time is missing", () => {
    expect(formatExecutiveLastGeneratedAt(null)).toBe(EXECUTIVE_NO_GENERATE_TIME_POSTED_COPY);
    expect(formatExecutiveLastGeneratedAt("")).toBe(EXECUTIVE_NO_GENERATE_TIME_POSTED_COPY);
    expect(formatExecutiveLastGeneratedAt("   ")).toBe(EXECUTIVE_NO_GENERATE_TIME_POSTED_COPY);
  });

  it("formats posted generate timestamps", () => {
    const formatted = formatExecutiveLastGeneratedAt("2026-01-15T12:00:00.000Z");
    expect(formatted).toBe(new Date("2026-01-15T12:00:00.000Z").toLocaleString());
  });
});

describe("formatExecutiveRelativeAge", () => {
  it("names the gap when the timestamp is missing or invalid", () => {
    expect(formatExecutiveRelativeAge(null)).toBe(EXECUTIVE_NO_DATE_POSTED_COPY);
    expect(formatExecutiveRelativeAge("not-a-date")).toBe(EXECUTIVE_NO_DATE_POSTED_COPY);
  });

  it("formats a recent posted timestamp", () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(formatExecutiveRelativeAge(fiveMinutesAgo)).toBe("5m ago");
  });
});

describe("formatExecutiveNoMetricPostedCopy", () => {
  it("lowercases the metric label in gap copy", () => {
    expect(formatExecutiveNoMetricPostedCopy("Open incidents")).toBe("No open incidents posted");
  });
});

describe("formatExecutiveOfficerKpiValue", () => {
  it("keeps loading and zero behavior", () => {
    expect(formatExecutiveOfficerKpiValue(undefined, true, "Open incidents")).toBe("…");
    expect(formatExecutiveOfficerKpiValue(0, false, "Open incidents")).toBe("0");
  });

  it("names the gap when the KPI is missing", () => {
    expect(formatExecutiveOfficerKpiValue(undefined, false, "Open incidents")).toBe("No open incidents posted");
  });
});

describe("formatExecutiveOfficerCountLabel", () => {
  it("names the gap when the count is missing", () => {
    expect(formatExecutiveOfficerCountLabel(undefined, "overdue")).toBe("No overdue posted");
  });

  it("keeps real zero in the lane stat", () => {
    expect(formatExecutiveOfficerCountLabel(0, "overdue")).toBe("0 overdue");
  });
});

function standupMetric(overrides: Partial<StandupMetricRow> = {}): StandupMetricRow {
  return {
    key: "current_total_census",
    sectionKey: "ar_census",
    label: "Current total census",
    valueType: "count",
    sourceMode: "auto",
    description: "Live census total",
    valueNumeric: 42,
    valueText: null,
    freshnessAt: null,
    confidenceBand: "high",
    sourceRefJson: [],
    overrideNote: null,
    ...overrides,
  };
}

describe("formatStandupMetricValue", () => {
  it("names the gap when the metric row is missing", () => {
    expect(formatStandupMetricValue(undefined, "Current AR")).toBe("No current AR posted");
  });

  it("keeps real zero as 0", () => {
    expect(formatStandupMetricValue(standupMetric({ valueNumeric: 0 }))).toBe("0");
  });

  it("uses manual copy for unresolved manual rows", () => {
    expect(
      formatStandupMetricValue(
        standupMetric({ valueNumeric: null, sourceMode: "manual", valueType: "hours" }),
      ),
    ).toBe(EXECUTIVE_STANDUP_MANUAL_OR_FUTURE_FEED_COPY);
  });

  it("formats currency values from cents", () => {
    expect(
      formatStandupMetricValue(
        standupMetric({ key: "current_ar_cents", label: "Current AR", valueType: "currency", valueNumeric: 125000 }),
      ),
    ).toBe("$1,250");
  });
});

describe("formatStandupMetricDelta", () => {
  it("names the gap when either side is missing", () => {
    expect(formatStandupMetricDelta(undefined, standupMetric())).toBe(EXECUTIVE_STANDUP_NO_DELTA_COPY);
    expect(
      formatStandupMetricDelta(standupMetric(), standupMetric({ valueNumeric: null, sourceMode: "manual" })),
    ).toBe(EXECUTIVE_STANDUP_NO_DELTA_COPY);
  });

  it("reports no change for identical values", () => {
    expect(formatStandupMetricDelta(standupMetric({ valueNumeric: 10 }), standupMetric({ valueNumeric: 10 }))).toBe(
      "No change",
    );
  });
});
