import { describe, expect, it } from "vitest";

import {
  OVERRIDE_BED_UNASSIGNED,
  OVERRIDE_FORM_PICK,
  validateOverrideAdmission,
} from "./override-admission-validate";

const base = {
  firstName: "Jane",
  lastName: "Doe",
  preferredName: "",
  dob: "1950-01-15",
  gender: "female",
  status: "active",
  acuity: "level_1",
  admissionDate: "2020-05-01",
  isActive: true,
  bedId: "bed-1",
  overrideReason: "a".repeat(50),
};

describe("validateOverrideAdmission", () => {
  it("passes when all required fields are valid for active resident", () => {
    expect(validateOverrideAdmission(base)).toEqual({});
  });

  it("blocks minors by DOB", () => {
    const y = new Date().getFullYear();
    const minorDob = `${y - 10}-06-01`;
    const e = validateOverrideAdmission({ ...base, dob: minorDob });
    expect(e.dob).toMatch(/18 or older/);
  });

  it("requires explicit gender, status, acuity selections", () => {
    expect(validateOverrideAdmission({ ...base, gender: OVERRIDE_FORM_PICK }).gender).toBeDefined();
    expect(validateOverrideAdmission({ ...base, status: OVERRIDE_FORM_PICK }).status).toBeDefined();
    expect(validateOverrideAdmission({ ...base, acuity: OVERRIDE_FORM_PICK }).acuity).toBeDefined();
  });

  it("requires a bed when active", () => {
    const e = validateOverrideAdmission({
      ...base,
      bedId: OVERRIDE_BED_UNASSIGNED,
    });
    expect(e.bedId).toBeDefined();
  });

  it("enforces override reason length 50–500", () => {
    expect(
      validateOverrideAdmission({
        ...base,
        overrideReason: "a".repeat(49),
      }).overrideReason,
    ).toBeDefined();
    expect(
      validateOverrideAdmission({
        ...base,
        overrideReason: "a".repeat(501),
      }).overrideReason,
    ).toBeDefined();
  });
});
