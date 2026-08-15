import { describe, expect, it } from "vitest";

import {
  TRANSPORTATION_NO_NAME_COPY,
  TRANSPORTATION_NO_STAFF_COPY,
  TRANSPORTATION_NO_TIME_COPY,
  formatTransportationAppointmentTime,
  formatTransportationDayTripCount,
  formatTransportationDriverStaffLabel,
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

describe("formatTransportationDriverStaffLabel", () => {
  it("names a missing staff record instead of generic unknown copy", () => {
    expect(formatTransportationDriverStaffLabel(null)).toBe(TRANSPORTATION_NO_STAFF_COPY);
    expect(formatTransportationDriverStaffLabel(undefined)).toBe(TRANSPORTATION_NO_STAFF_COPY);
  });

  it("names a posted staff record with blank first and last names", () => {
    expect(formatTransportationDriverStaffLabel({ first_name: "", last_name: "" })).toBe(
      TRANSPORTATION_NO_NAME_COPY,
    );
    expect(formatTransportationDriverStaffLabel({ first_name: "   ", last_name: "  " })).toBe(
      TRANSPORTATION_NO_NAME_COPY,
    );
  });

  it("returns a posted first name only", () => {
    expect(formatTransportationDriverStaffLabel({ first_name: "Jordan", last_name: "" })).toBe(
      "Jordan",
    );
    expect(formatTransportationDriverStaffLabel({ first_name: "  Jordan  ", last_name: "" })).toBe(
      "Jordan",
    );
  });

  it("returns a posted last name only", () => {
    expect(formatTransportationDriverStaffLabel({ first_name: "", last_name: "Lee" })).toBe("Lee");
    expect(formatTransportationDriverStaffLabel({ first_name: "", last_name: "  Lee  " })).toBe(
      "Lee",
    );
  });

  it("returns posted first and last names joined with a single space", () => {
    expect(
      formatTransportationDriverStaffLabel({ first_name: "Jordan", last_name: "Lee" }),
    ).toBe("Jordan Lee");
    expect(
      formatTransportationDriverStaffLabel({ first_name: "  Jordan  ", last_name: "  Lee  " }),
    ).toBe("Jordan Lee");
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
