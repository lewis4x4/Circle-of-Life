import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import axe from "axe-core";
import { EmployeeSourcePanel } from "./employee-source-panel";
import { employeeSourceMap } from "@/lib/operations/employee-source-map";
const id = "00000000-0000-0000-0000-000000000001";
const other = "00000000-0000-0000-0000-000000000002";
const props = { taskId: id, actorId: id, activityKey: "hfo-al-e01-01", facilityId: id, subjectId: id };
const reply = (overrides = {}) => ({ task_id: id, employee_id: other, activity_key: props.activityKey, as_of: "2026-09-13", availability: "available", reason: null, can_open_employee_file: true, can_medical: false, source_version: "a".repeat(64), fields: employeeSourceMap.map(row => ({ source_id: row.sourceId, component_key: row.key, label: row.label, kind: row.kind, state: row.medical ? "unavailable" : "unknown", requirement_codes: row.codes, records: [], value: null, reason: row.gap ?? "Native source only" })), assessment_scope: "visible_records_only", history: [], complete: true, ...overrides });
const response = (body: unknown, status=200) => ({ ok: status<400, status, json: async () => body });
const fetchMock=vi.fn();
beforeEach(()=>{ fetchMock.mockReset();vi.stubGlobal("fetch",fetchMock); });
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
async function open(){await userEvent.click(screen.getByText("Employee File source context"));}
it("maps20items22components14employee fields without substituting gaps",()=>{
 expect(employeeSourceMap).toHaveLength(22);expect(new Set(employeeSourceMap.map(row=>row.sourceId)).size).toBe(20);expect(employeeSourceMap.filter(row=>row.sourceId.startsWith("AL-E"))).toHaveLength(14);
 expect(employeeSourceMap.find(row=>row.sourceId==="AL-E09")?.codes).toEqual([]);expect(employeeSourceMap.find(row=>row.sourceId==="AL-E04")?.medical).toBe(true);expect(employeeSourceMap.find(row=>row.sourceId==="AL-E05")?.codes).toContain("DOC-040");
});
it("uses existing Employee File link and never offers performance or employment commands",async()=>{
 fetchMock.mockResolvedValue(response(reply()));const {container}=render(<EmployeeSourcePanel {...props}/>);await open();expect(await screen.findByRole("link",{name:"Open existing Employee File"})).toHaveAttribute("href",`/admin/staff/${other}/employee-file`);
 expect(screen.queryByRole("button",{name:/complete|approve|discipline/i})).toBeNull();expect((await axe.run(container,{rules:{"color-contrast":{enabled:false}}})).violations).toEqual([]);
});
it("shields medical values and dates even when a malformed private field is returned",async()=>{
 const value=reply();const field=value.fields.find(row=>row.source_id==="AL-E04")!;Object.assign(field,{state:"verified",value:"private-medical-value",records:[{record_id:id,requirement_id:id,requirement_version:1,status:"verified",completed_on:"1999-12-25",expires_on:"2099-12-25"}]});
 fetchMock.mockResolvedValue(response(value));render(<EmployeeSourcePanel {...props}/>);await open();await screen.findByRole("link");expect(screen.queryByText(/private-medical-value|1999-12-25|2099-12-25/)).toBeNull();
});
it("reconciles with exact retry while unknown and never creates a performance payload",async()=>{
 fetchMock.mockResolvedValueOnce(response(reply())).mockRejectedValueOnce(new Error("lost")).mockResolvedValueOnce(response(reply()));render(<EmployeeSourcePanel {...props}/>);await open();await userEvent.click(await screen.findByRole("button",{name:"Refresh and record source changes"}));await screen.findByText(/Refresh result unknown/);
 expect(screen.queryByRole("link")).toBeNull();await userEvent.click(screen.getByRole("button",{name:"Retry same employee source refresh"}));await screen.findByRole("link");expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[2][1].body);expect(Object.keys(JSON.parse(fetchMock.mock.calls[1][1].body)).sort()).toEqual(["request_key","task_id"]);
});
it("clears private data and links after a failed current read",async()=>{
 fetchMock.mockResolvedValueOnce(response(reply())).mockRejectedValueOnce(new Error("revoked"));render(<EmployeeSourcePanel {...props}/>);await open();await screen.findByRole("link");await userEvent.click(screen.getByRole("button",{name:"Reload employee sources"}));await screen.findByText(/Employee source details unavailable/);expect(screen.queryByRole("link")).toBeNull();
});
it("rejects incomplete and wrong-scope snapshots without partial success",async()=>{
 fetchMock.mockResolvedValue(response(reply({fields:[],task_id:other})));render(<EmployeeSourcePanel {...props}/>);await open();await screen.findByText(/Employee source details unavailable/);expect(screen.queryByRole("link")).toBeNull();
});
it("aborts old actor reads and clears state without command replay",async()=>{
 fetchMock.mockImplementation(()=>new Promise(()=>{}));const {rerender}=render(<EmployeeSourcePanel {...props}/>);await open();await waitFor(()=>expect(fetchMock).toHaveBeenCalledOnce());const signal=fetchMock.mock.calls[0][1].signal;rerender(<EmployeeSourcePanel {...props} actorId={other}/>);expect(signal.aborted).toBe(true);expect(screen.queryByText(/Earlier results/)).toBeNull();expect(fetchMock).toHaveBeenCalledOnce();
});
