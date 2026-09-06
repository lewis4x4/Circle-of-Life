import { addDays, addMonths, getDay, getDaysInMonth, setDate, setMonth, setHours, setMilliseconds, setMinutes, setSeconds } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { z } from "zod";
import type { ScheduleFrequency } from "@/lib/reports/pack-ui-metadata";

const scheduleRuleSchema=z.object({
  frequency:z.enum(["daily","weekly","monthly","quarterly"]),weekday:z.number().int().min(0).max(6),
  monthDay:z.number().int().min(1).max(31),timeLocal:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
}).strict();
export type ScheduleRule=z.infer<typeof scheduleRuleSchema>;
export function encodeScheduleRule(rule:ScheduleRule):string { return JSON.stringify(scheduleRuleSchema.parse(rule)); }
export function decodeScheduleRule(rule:string):ScheduleRule {
  // Legacy bare rules need explicit timing review; never invent a weekly fallback.
  return scheduleRuleSchema.parse(JSON.parse(rule));
}

/** Calendar recurrence in the facility timezone. Missing DST times move forward by the gap. */
export function computeNextRunUtc(params: {
  frequency:ScheduleFrequency;weekday:number;monthDay?:number;timeLocal:string;timezone:string;now?:Date;
}):Date {
  const now=params.now??new Date();
  new Intl.DateTimeFormat("en-US",{timeZone:params.timezone}).format(now);
  const zNow=toZonedTime(now,params.timezone);
  const rule=scheduleRuleSchema.parse({frequency:params.frequency,weekday:params.weekday,timeLocal:params.timeLocal,monthDay:params.monthDay??zNow.getDate()});
  const [hour,minute]=rule.timeLocal.split(":").map(Number);
  let candidate=setMilliseconds(setSeconds(setMinutes(setHours(zNow,hour),minute),0),0);
  if(rule.frequency==="daily") {
    if(candidate<=zNow) candidate=addDays(candidate,1);
  } else if(rule.frequency==="weekly") {
    let days=(rule.weekday-getDay(candidate)+7)%7;
    if(days===0 && candidate<=zNow) days=7;
    candidate=addDays(candidate,days);
  } else {
    if(rule.frequency==="quarterly") candidate=setMonth(setDate(candidate,1),Math.floor(candidate.getMonth()/3)*3);
    candidate=setDate(candidate,Math.min(rule.monthDay,getDaysInMonth(candidate)));
    if(candidate<=zNow) {
      candidate=addMonths(setDate(candidate,1),rule.frequency==="monthly"?1:3);
      candidate=setDate(candidate,Math.min(rule.monthDay,getDaysInMonth(candidate)));
    }
  }
  let instant=fromZonedTime(candidate,params.timezone);
  const roundTrip=toZonedTime(instant,params.timezone);
  if(roundTrip<candidate) instant=new Date(instant.getTime()+candidate.getTime()-roundTrip.getTime());
  return instant;
}

export function recurrenceRuleForFrequency(frequency:ScheduleFrequency):string {
  return encodeScheduleRule({frequency,weekday:1,monthDay:1,timeLocal:"08:00"});
}
export function estimatePdfPages(reportCount:number):number { return Math.max(1,Math.round(reportCount*3)); }
