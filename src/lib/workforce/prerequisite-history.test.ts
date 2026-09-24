import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Main now owns these floor migrations. Preserve its reviewed source while
// recording further changes in forward migrations.
describe("recorded Workforce prerequisite history", () => {
  it.each([
    ["494_floor_tablet_kiosk.sql", "2be4d36710ed70c0235f1874ad08e79b19f1ec7a0fceba1de9d6a40dca0376b1"],
    ["495_rounding_owner_from_punches.sql", "4377bbd62d71604a9aaf4d743318bc8859760307211be45dd34ae0fa489a5f2e"],
  ])("preserves the recorded %s source", (file, expected) => {
    const actual = createHash("sha256").update(readFileSync(`supabase/migrations/${file}`)).digest("hex");
    expect(actual, "Keep this installed identity unchanged; put later fixes in a forward migration, as 498 does.").toBe(expected);
  });
});
