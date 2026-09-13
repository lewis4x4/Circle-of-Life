import { describe, expect, it } from "vitest";
import { composeEmployeeSources, type EmployeeSourceInput } from "./employee-sources";
import { employeeSourceMap } from "./employee-source-map";
import type { EmployeeRequirement, EmployeeFileRecord } from "@/lib/staff/employee-file";
const q = { id: "req", code: "TRN-24", title: "CPR", version: 1, category: "training", review_status: "approved", recurrence_status: "one_time", applies_to_staff_roles: ["resident_aide"], due_days: null, minimum_completions: 1, minimum_distinct_days: 1 } as EmployeeRequirement;
const record = { id: "record", requirement_id: "req", staff_id: "staff", status: "verified", completed_on: "2026-09-01", expires_on: "2026-09-13", created_at: "2026-09-01T12:00:00Z" } as EmployeeFileRecord;
function input(): EmployeeSourceInput { return { task_id: "task", employee_id: "staff", activity_key: "hfo-al-w06-01", as_of: "2026-09-13", availability: "available", reason: null, can_medical: false, can_open_employee_file: true, source_version: "hash", staff: { id: "staff", first_name: "", last_name: "", staff_role: "resident_aide", hire_date: "2026-01-01", employment_status: "active", facility_id: "site", user_id: null }, requirements: [q], records: [record], history: [], complete: true }; }
describe("native employee source composition", () => {
 it("maps every20source/22component and14EmployeeFilefields without duty clearance", () => {
  const reply=composeEmployeeSources(input(),employeeSourceMap);
  expect(reply.fields).toHaveLength(22);expect(new Set(reply.fields.map(f=>f.source_id)).size).toBe(20);
  expect(reply.fields.filter(f=>f.source_id.startsWith("AL-E"))).toHaveLength(14);
  expect(reply).not.toHaveProperty("readiness");expect(reply.assessment_scope).toBe("visible_records_only");
 });
 it("uses native verified/expired states across date transition", () => {
  expect(composeEmployeeSources(input(),employeeSourceMap).fields.find(f=>f.source_id==="AL-E06")?.state).toBe("verified");
  expect(composeEmployeeSources({...input(),as_of:"2026-09-14"},employeeSourceMap).fields.find(f=>f.source_id==="AL-E06")?.state).toBe("expired");
 });
 it("does not resurrect olderapprovedversion afterlatestretirement", () => {
  const r=composeEmployeeSources({...input(),requirements:[q,{...q,id:"new",version:2,review_status:"retired"}]},employeeSourceMap);
  expect(r.fields.find(f=>f.source_id==="AL-E06")?.state).toBe("requirements_unknown");
 });
 it("strips sensitiveTRNtraining records beforeaggregates andindividualfields", () => {
  const r=composeEmployeeSources({...input(),requirements:[q,{...q,id:"med",code:"TRN-26",category:"training"}],records:[record,{...record,id:"SECRET",requirement_id:"med",expires_on:"2099-01-01"}]},employeeSourceMap);
  expect(JSON.stringify(r)).not.toContain("SECRET");expect(JSON.stringify(r)).not.toContain("2099-01-01");
  expect(r.fields.find(f=>f.source_id==="AL-E05")).toMatchObject({state:"unavailable",records:[],value:null});
 });
 it("keeps ambiguousfields/manualsubmission unresolved evenwithsupportingrecords", () => {
  const r=composeEmployeeSources({...input(),can_medical:true},employeeSourceMap);
  for(const id of ["AL-E03","AL-E04","AL-E05","AL-E07","AL-E09","AL-E13","AL-E14"])expect(r.fields.find(f=>f.source_id===id)?.state).toBe("unknown");
 });
 it("keeps absent hire date unknown without inventing a due date", () => {
  const value=input();
  const reply=composeEmployeeSources({...value,staff:{...value.staff!,hire_date:null} as unknown as NonNullable<EmployeeSourceInput["staff"]>,requirements:[{...q,due_days:90}]},employeeSourceMap);
  expect(reply.fields.find(f=>f.source_id==="AL-E01")).toMatchObject({state:"unknown",value:null});
 });
 it("never lets a verified first requirement hide a missing requirement", () => {
  const mapping=[{sourceId:"synthetic",key:"synthetic",label:"Mixed",kind:"data_field",codes:["TRN-24","TRN-12"],medical:false,gap:null}];
  const requirements=[q,{...q,id:"missing",code:"TRN-12"}];
  for(const rows of [requirements,[...requirements].reverse()]) {
   expect(composeEmployeeSources({...input(),requirements:rows},mapping).fields[0].state).toBe("missing");
  }
 });

});
