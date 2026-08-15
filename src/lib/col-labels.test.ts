import { describe, expect, it } from "vitest";

import { COL_LABEL_NO_VALUE_COPY } from "@/lib/col-labels-display-copy";
import { formatColLabel } from "@/lib/col-labels";

const EM_DASH = "—";

describe("formatColLabel", () => {
  it("names a missing label instead of a silent em dash", () => {
    expect(formatColLabel(null)).toBe(COL_LABEL_NO_VALUE_COPY);
    expect(formatColLabel(undefined)).toBe(COL_LABEL_NO_VALUE_COPY);
    expect(formatColLabel("")).toBe(COL_LABEL_NO_VALUE_COPY);
    expect(formatColLabel(null)).not.toBe(EM_DASH);
  });

  it("keeps posted override labels unchanged", () => {
    expect(formatColLabel("private")).toBe("Private");
    expect(formatColLabel("semi_private")).toBe("Companion");
    expect(formatColLabel("hospital_hold")).toBe("Bed Hold — Hospital");
  });

  it("title-cases posted enum values without overrides", () => {
    expect(formatColLabel("example_status")).toBe("Example Status");
  });
});
