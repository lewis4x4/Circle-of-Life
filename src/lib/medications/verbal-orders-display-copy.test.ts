import { describe, expect, it } from "vitest";

import {
  VERBAL_ORDERS_NO_RESIDENT_COPY,
  formatVerbalOrderResidentName,
} from "./verbal-orders-display-copy";

const EM_DASH = "—";

describe("formatVerbalOrderResidentName", () => {
  it("names the gap when the resident join is missing", () => {
    expect(formatVerbalOrderResidentName(null)).toBe(VERBAL_ORDERS_NO_RESIDENT_COPY);
    expect(formatVerbalOrderResidentName(null)).not.toBe(EM_DASH);
  });

  it("names the gap when both resident names are blank", () => {
    expect(formatVerbalOrderResidentName({ first_name: null, last_name: null })).toBe(
      VERBAL_ORDERS_NO_RESIDENT_COPY,
    );
    expect(formatVerbalOrderResidentName({ first_name: "", last_name: "" })).toBe(
      VERBAL_ORDERS_NO_RESIDENT_COPY,
    );
  });

  it("keeps posted first and last names joined with a space", () => {
    expect(
      formatVerbalOrderResidentName({
        first_name: "Posted First",
        last_name: "Posted Last",
      }),
    ).toBe("Posted First Posted Last");
    expect(
      formatVerbalOrderResidentName({
        first_name: "Posted First",
        last_name: null,
      }),
    ).toBe("Posted First");
    expect(
      formatVerbalOrderResidentName({
        first_name: null,
        last_name: "Posted Last",
      }),
    ).toBe("Posted Last");
  });
});
