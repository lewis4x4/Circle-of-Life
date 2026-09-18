import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { decideCensusRun, facilityWallClock } from "./operating-day.ts";

Deno.test("exactly one of the twin UTC schedules is the midnight census hour", () => {
  // 04:30 UTC is 00:30 in America/New_York while daylight time is in effect;
  // 05:30 UTC is 00:30 once it ends. Both DST switch days are included.
  const days = [
    ["2026-07-15T04:30:00Z", "2026-07-15T05:30:00Z"],
    ["2026-01-15T04:30:00Z", "2026-01-15T05:30:00Z"],
    ["2026-03-08T04:30:00Z", "2026-03-08T05:30:00Z"],
    ["2026-11-01T04:30:00Z", "2026-11-01T05:30:00Z"],
  ];
  for (const pair of days) {
    const ran = pair.filter((iso) => decideCensusRun({ now: new Date(iso) }).run);
    assertEquals(ran.length, 1, `expected one run on ${pair[0]}, got ${ran.length}`);
  }
});

Deno.test("an explicit day or a forced run proceeds outside the midnight hour", () => {
  const noon = new Date("2026-07-15T16:00:00Z");
  assertEquals(decideCensusRun({ now: noon }).run, false);
  assertEquals(decideCensusRun({ now: noon, requestedLogDate: "2026-07-14" }), {
    run: true,
    logDate: "2026-07-14",
    reason: "explicit_request",
  });
  assertEquals(decideCensusRun({ now: noon, force: true }), {
    run: true,
    logDate: null,
    reason: "explicit_request",
  });
});

Deno.test("the wall clock is read where the facilities are", () => {
  // Late evening in New York is already the next day in UTC.
  assertEquals(facilityWallClock(new Date("2026-09-16T01:00:00Z")), {
    date: "2026-09-15",
    hour: 21,
  });
});
