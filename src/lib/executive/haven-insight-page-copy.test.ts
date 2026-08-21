import { describe, expect, it } from "vitest";

import {
  EXECUTIVE_HAVEN_INSIGHT_EMPTY_STATE_HELPER,
  EXECUTIVE_HAVEN_INSIGHT_ROUTE_LOADING_MESSAGE,
} from "./haven-insight-page-copy";

describe("haven insight page copy", () => {
  it("uses calm Quiet Operator loading and empty-state messages", () => {
    expect(EXECUTIVE_HAVEN_INSIGHT_ROUTE_LOADING_MESSAGE).toBe("Loading Haven Insight…");
    expect(EXECUTIVE_HAVEN_INSIGHT_EMPTY_STATE_HELPER).toMatch(/Ask a facility or portfolio question/);
    expect(EXECUTIVE_HAVEN_INSIGHT_EMPTY_STATE_HELPER).toMatch(/does not invent census/);
  });
});
