import { describe, expect, it } from "vitest";
import { helpHandoverCommandSchema, projectLocalDuties, helpHandoverError, type HelpHandoverEvent } from "./help-handover";
const proposal = (id:string,owner:string,time:string):HelpHandoverEvent => ({id,command:"propose",duty_scope:"Mail delivery",payload:{owner_user_id:owner,effective_at:time},actor_id:"manager",created_at:time,previous_id:null});
const accept = (id:string,p:string,actor:string,time:string,role="owner"):HelpHandoverEvent => ({id,command:"accept",duty_scope:"Mail delivery",payload:{proposal_id:p,duty_role:role},actor_id:actor,created_at:time,previous_id:p});
describe("local duty handover",()=>{
 it("retains accepted ownership while replacement is pending or future effective",()=>{
  const events=[proposal("p1","a","2026-01-01T00:00:00Z"),accept("a1","p1","a","2026-01-02T00:00:00Z"),proposal("p2","b","2026-02-01T00:00:00Z")];
  expect(projectLocalDuties(events,Date.parse("2026-01-10" )).map(p=>p.active)).toEqual([true,false]);
  events.push(accept("a2","p2","b","2026-01-11T00:00:00Z"));
  expect(projectLocalDuties(events,Date.parse("2026-01-20")).map(p=>p.active)).toEqual([true,false]);
  expect(projectLocalDuties(events,Date.parse("2026-02-02")).map(p=>p.active)).toEqual([false,true]);
 });
 it("never accepts for another actor or infers backup coverage",()=>{
  const rows=projectLocalDuties([proposal("p1","a","2026-01-01T00:00:00Z"),accept("a1","p1","manager","2026-01-02T00:00:00Z")]);
  expect(rows[0].active).toBe(false); expect(rows[0].backup_accepted_at).toBeNull();
 });
 it("separates independent local duties",()=>{
  const other={...proposal("p2","b","2026-01-01T00:00:00Z"),duty_scope:"Mail check"};
  expect(projectLocalDuties([proposal("p1","a","2026-01-01T00:00:00Z"),accept("a1","p1","a","2026-01-02T00:00:00Z"),other,{...accept("a2","p2","b","2026-01-02T00:00:00Z"),duty_scope:"Mail check"}]).every(p=>p.active)).toBe(true);
 });
 it("rejects actor injection and schedule rules",()=>{
  expect(helpHandoverCommandSchema.safeParse({activity_id:"a",command:"propose",actor_id:"someone",payload:{schedule_rule:{}}}).success).toBe(false);
 });
 it("maps errors without exposing provider text",()=>{expect(helpHandoverError({code:"42501"})).toEqual({status:403,error:"Operation unavailable"});expect(helpHandoverError({code:"P0001"}).status).toBe(409);expect(helpHandoverError({}).status).toBe(503);});
});
