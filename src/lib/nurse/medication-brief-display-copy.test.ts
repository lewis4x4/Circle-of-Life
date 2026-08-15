import { describe, expect, it } from "vitest";

import { NURSE_WATCHLIST_NO_ROOM_COPY } from "./medication-brief-display-copy";

const EM_DASH = "—";

describe("NURSE_WATCHLIST_NO_ROOM_COPY", () => {
  it("names the assurance watchlist room gap instead of a silent dash", () => {
    expect(NURSE_WATCHLIST_NO_ROOM_COPY).toBe("No room posted");
    expect(NURSE_WATCHLIST_NO_ROOM_COPY).not.toBe(EM_DASH);
  });
});
