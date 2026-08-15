import { describe, expect, it } from "vitest";

import { isRecordDetailEmptyValue } from "./DetailRow";
import { RECORD_DETAIL_NO_VALUE_COPY } from "./record-detail-display-copy";

describe("RECORD_DETAIL_NO_VALUE_COPY", () => {
  it('is "No value posted" and not an em dash', () => {
    expect(RECORD_DETAIL_NO_VALUE_COPY).toBe("No value posted");
    expect(RECORD_DETAIL_NO_VALUE_COPY).not.toBe("—");
  });
});

describe("isRecordDetailEmptyValue", () => {
  it.each([
    null,
    undefined,
    "",
    "   ",
    "—",
    RECORD_DETAIL_NO_VALUE_COPY,
  ])("treats %j as empty", (value) => {
    expect(isRecordDetailEmptyValue(value)).toBe(true);
  });

  it.each(["0", 0, "Posted note"])("treats %j as populated", (value) => {
    expect(isRecordDetailEmptyValue(value)).toBe(false);
  });
});
