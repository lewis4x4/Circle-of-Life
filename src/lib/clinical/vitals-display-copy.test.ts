import { describe, expect, it } from "vitest";

import {
  VITALS_NO_BLOOD_PRESSURE_COPY,
  VITALS_NO_DIASTOLIC_COPY,
  VITALS_NO_OXYGEN_COPY,
  VITALS_NO_PULSE_COPY,
  VITALS_NO_RESPIRATION_COPY,
  VITALS_NO_SYSTOLIC_COPY,
  VITALS_NO_TEMPERATURE_COPY,
  VITALS_NO_WEIGHT_COPY,
  formatVitalsBloodPressure,
  formatVitalsOxygenSaturation,
  formatVitalsPulse,
  formatVitalsRespiration,
  formatVitalsTemperature,
  formatVitalsWeight,
  isPostedVitalNumeric,
} from "./vitals-display-copy";

const EM_DASH = "—";

describe("isPostedVitalNumeric", () => {
  it("treats null and undefined as not posted", () => {
    expect(isPostedVitalNumeric(null)).toBe(false);
    expect(isPostedVitalNumeric(undefined)).toBe(false);
  });

  it("treats NaN as not posted", () => {
    expect(isPostedVitalNumeric(Number.NaN)).toBe(false);
  });

  it("keeps real zero as posted", () => {
    expect(isPostedVitalNumeric(0)).toBe(true);
  });
});

describe("formatVitalsBloodPressure", () => {
  it("names the gap when both components are missing", () => {
    expect(formatVitalsBloodPressure(null, undefined)).toBe(VITALS_NO_BLOOD_PRESSURE_COPY);
  });

  it("names a missing systolic while keeping diastolic", () => {
    expect(formatVitalsBloodPressure(null, 80)).toBe(`${VITALS_NO_SYSTOLIC_COPY}/80`);
  });

  it("names a missing diastolic while keeping systolic", () => {
    expect(formatVitalsBloodPressure(120, null)).toBe(`120/${VITALS_NO_DIASTOLIC_COPY}`);
  });

  it("formats posted values including real zeros", () => {
    expect(formatVitalsBloodPressure(120, 80)).toBe("120/80");
    expect(formatVitalsBloodPressure(0, 80)).toBe("0/80");
    expect(formatVitalsBloodPressure(120, 0)).toBe("120/0");
    expect(formatVitalsBloodPressure(0, 0)).toBe("0/0");
  });

  it("never returns an em dash", () => {
    expect(formatVitalsBloodPressure(null, null)).not.toBe(EM_DASH);
  });
});

describe("formatVitalsPulse", () => {
  it("names a missing pulse", () => {
    expect(formatVitalsPulse(null)).toBe(VITALS_NO_PULSE_COPY);
    expect(formatVitalsPulse(undefined)).toBe(VITALS_NO_PULSE_COPY);
  });

  it("keeps real zero with bpm suffix", () => {
    expect(formatVitalsPulse(0)).toBe("0 bpm");
  });

  it("formats a posted pulse", () => {
    expect(formatVitalsPulse(72)).toBe("72 bpm");
  });
});

describe("formatVitalsOxygenSaturation", () => {
  it("names missing oxygen", () => {
    expect(formatVitalsOxygenSaturation(null)).toBe(VITALS_NO_OXYGEN_COPY);
  });

  it("keeps real zero with percent suffix", () => {
    expect(formatVitalsOxygenSaturation(0)).toBe("0%");
  });

  it("formats a posted reading", () => {
    expect(formatVitalsOxygenSaturation(98)).toBe("98%");
  });
});

describe("formatVitalsRespiration", () => {
  it("names missing respiration", () => {
    expect(formatVitalsRespiration(undefined)).toBe(VITALS_NO_RESPIRATION_COPY);
  });

  it("keeps real zero with resp suffix", () => {
    expect(formatVitalsRespiration(0)).toBe("0 resp");
  });

  it("formats a posted rate", () => {
    expect(formatVitalsRespiration(16)).toBe("16 resp");
  });
});

describe("formatVitalsTemperature", () => {
  it("names missing temperature", () => {
    expect(formatVitalsTemperature(null)).toBe(VITALS_NO_TEMPERATURE_COPY);
  });

  it("keeps real zero with degree suffix", () => {
    expect(formatVitalsTemperature(0)).toBe("0°");
  });

  it("formats a posted temperature", () => {
    expect(formatVitalsTemperature(98.6)).toBe("98.6°");
  });
});

describe("formatVitalsWeight", () => {
  it("names missing weight", () => {
    expect(formatVitalsWeight(undefined)).toBe(VITALS_NO_WEIGHT_COPY);
  });

  it("keeps real zero with lbs suffix", () => {
    expect(formatVitalsWeight(0)).toBe("0 lbs");
  });

  it("formats a posted weight", () => {
    expect(formatVitalsWeight(150)).toBe("150 lbs");
  });
});
