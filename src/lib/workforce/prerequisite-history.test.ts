import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// These identities were already installed in staging before Workforce shipped.
// The subsequently installed hardening is recorded forward in migration 498.
// Keep later floor work from silently rewriting that shared migration history.
describe("recorded Workforce prerequisite history", () => {
  it.each([
    ["494_floor_tablet_kiosk.sql", "254305d9fa531c9204cd0d802bbfed45b309050dc2314869230297a22100c183"],
    ["495_rounding_owner_from_punches.sql", "7bc5de50de38690f43c45a5db4e265ea3b29498751e5e4b33db59f329a777b06"],
  ])("preserves the recorded %s source", (file, expected) => {
    const actual = createHash("sha256").update(readFileSync(`supabase/migrations/${file}`)).digest("hex");
    expect(actual, "Keep this installed identity unchanged; put later fixes in a forward migration, as 498 does.").toBe(expected);
  });
});
