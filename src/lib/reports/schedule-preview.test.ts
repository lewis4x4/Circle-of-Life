import { expect,it,vi,afterEach } from "vitest";
import { computeNextRunUtc, decodeScheduleRule, encodeScheduleRule } from "./schedule-preview";
afterEach(()=>vi.useRealTimers());
it("keeps 8am Eastern across DST",()=>{
 vi.useFakeTimers().setSystemTime(new Date("2026-03-07T14:00:00Z"));
 expect(computeNextRunUtc({frequency:"daily",weekday:0,timeLocal:"08:00",timezone:"America/New_York"}).toISOString()).toBe("2026-03-08T12:00:00.000Z");
});
it("uses the requested month day and clamps short months",()=>{
 vi.useFakeTimers().setSystemTime(new Date("2026-01-31T15:00:00Z"));
 expect(computeNextRunUtc({frequency:"monthly",weekday:0,monthDay:31,timeLocal:"08:00",timezone:"America/New_York"}).toISOString()).toBe("2026-02-28T13:00:00.000Z");
});
it("rejects unsupported recurrence instead of silently using weekly",()=>{
 expect(()=>decodeScheduleRule("whenever")).toThrow();
 expect(()=>computeNextRunUtc({frequency:"daily",weekday:0,timeLocal:"28:99",timezone:"America/New_York"})).toThrow();
});
it("round trips the full recurrence contract",()=>{
 const plan={frequency:"weekly" as const,weekday:2,monthDay:1,timeLocal:"09:30"};
 expect(decodeScheduleRule(encodeScheduleRule(plan))).toEqual(plan);
});

it("anchors quarterly reports to calendar quarters",()=>{
 vi.useFakeTimers().setSystemTime(new Date("2026-09-06T14:00:00Z"));
 expect(computeNextRunUtc({frequency:"quarterly",weekday:0,monthDay:1,timeLocal:"08:00",timezone:"America/New_York"}).toISOString()).toBe("2026-10-01T12:00:00.000Z");
});
