import { describe, expect, it } from "vitest";
import { uiV2 } from "./flags";

describe("UI-V2 flag", () => {
  it("defaults ON; only `NEXT_PUBLIC_UI_V2=false` turns it off", () => {
    expect(uiV2({})).toBe(true);
    expect(uiV2({ NEXT_PUBLIC_UI_V2: "true" })).toBe(true);
    expect(uiV2({ NEXT_PUBLIC_UI_V2: "anything-else" })).toBe(true);
    expect(uiV2({ NEXT_PUBLIC_UI_V2: "false" })).toBe(false);
  });
});
