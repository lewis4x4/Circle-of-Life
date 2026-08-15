import { describe, expect, it } from "vitest";

import {
  TRANSPORTATION_NO_TIME_COPY,
  formatTransportationAppointmentTime,
  formatTransportationDayTripCount,
} from "./transportation-display-copy";

const EM_DASH = "—";

describe("formatTransportationAppointmentTime", () => {
  it("names a missing appointment time instead of an em dash", () => {
    expect(formatTransportationAppointmentTime(null)).toBe(TRANSPORTATION_NO_TIME_COPY);
    expect(formatTransportationAppointmentTime(undefined)).toBe(TRANSPORTATION_NO_TIME_COPY);
    expect(formatTransportationAppointmentTime("")).toBe(TRANSPORTATION_NO_TIME_COPY);
    expect(formatTransportationAppointmentTime("   ")).toBe(TRANSPORTATION_NO_TIME_COPY);
    expect(formatTransportationAppointmentTime(null)).not.toBe(EM_DASH);
  });

  it("formats a posted appointment time", () => {
    expect(formatTransportationAppointmentTime("14:30:00")).toBe("2:30 PM");
    expect(formatTransportationAppointmentTime("09:15:00")).toBe("9:15 AM");
  });
});

describe("formatTransportationDayTripCount", () => {
  it("keeps a real zero as numeric trip copy", () => {
    expect(formatTransportationDayTripCount(0)).toBe("0 trips");
    expect(formatTransportationDayTripCount(0)).not.toBe(EM_DASH);
  });

  it("formats singular and plural trip counts", () => {
    expect(formatTransportationDayTripCount(1)).toBe("1 trip");
    expect(formatTransportationDayTripCount(3)).toBe("3 trips");
  });
});
