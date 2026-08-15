import { describe, expect, it } from "vitest";

import { FORMAT_USD_NO_AMOUNT_POSTED_COPY } from "@/lib/insurance/format-money";

import {
  EXECUTIVE_NO_CERT_COUNT_POSTED_COPY,
  EXECUTIVE_NO_COMPLETENESS_POSTED_COPY,
  EXECUTIVE_NO_CONFIDENCE_POSTED_COPY,
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
  formatExecutiveArOutstandingCents,
  formatExecutiveCertsExpiringCount,
  formatExecutiveCompletenessPct,
  formatExecutiveConfidenceBand,
  formatExecutiveHospitalCount,
  formatExecutiveInHouseCount,
  formatExecutiveLastGeneratedAt,
  formatExecutiveLeagueScore,
  formatExecutiveOccupancyBarLabel,
  formatExecutiveOccupancyPct,
  formatExecutiveOccupancyPctWithSuffix,
  formatExecutiveOnLeaveCount,
  formatExecutiveOpenIncidentCount,
  formatExecutiveOpenInvoiceCount,
  formatExecutivePacketStatus,
  formatExecutiveRevenueMtdCents,
  formatExecutiveRiskScore,
  formatExecutiveSurveyDeficiencyCount,
} from "./executive-display-copy";

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
