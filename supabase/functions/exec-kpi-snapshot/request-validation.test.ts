import { assertEquals } from "jsr:@std/assert";

import { parseSnapshotDate, parseSnapshotRequestBody } from "./request-validation.ts";

Deno.test("parseSnapshotDate accepts valid UTC calendar dates", () => {
  assertEquals(parseSnapshotDate("2026-05-18"), "2026-05-18");
  assertEquals(parseSnapshotDate("2024-02-29"), "2024-02-29");
});

Deno.test("parseSnapshotDate rejects invalid format or non-round-tripping dates", () => {
  assertEquals(parseSnapshotDate("2026-5-18"), null);
  assertEquals(parseSnapshotDate("2026-02-29"), null);
  assertEquals(parseSnapshotDate("2026-13-01"), null);
  assertEquals(parseSnapshotDate("2026-04-31"), null);
});

Deno.test("parseSnapshotRequestBody rejects non-object JSON shapes", () => {
  assertEquals(parseSnapshotRequestBody(null), { ok: false, error: "Invalid JSON body" });
  assertEquals(parseSnapshotRequestBody(123), { ok: false, error: "Invalid JSON body" });
  assertEquals(parseSnapshotRequestBody([]), { ok: false, error: "Invalid JSON body" });
});

Deno.test("parseSnapshotRequestBody rejects non-string request fields", () => {
  assertEquals(parseSnapshotRequestBody({ organization_id: 123 }), {
    ok: false,
    error: "organization_id (uuid) is required",
  });
  assertEquals(parseSnapshotRequestBody({ organization_id: "org-1", snapshot_date: 123 }), {
    ok: false,
    error: "snapshot_date must be YYYY-MM-DD",
  });
});

Deno.test("parseSnapshotRequestBody trims valid string fields", () => {
  assertEquals(parseSnapshotRequestBody({
    organization_id: " org-1 ",
    snapshot_date: " 2026-05-18 ",
  }), {
    ok: true,
    body: { organizationId: "org-1", snapshotDate: "2026-05-18" },
  });
});
