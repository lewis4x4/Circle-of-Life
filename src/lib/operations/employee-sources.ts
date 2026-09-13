import { z } from "zod";
import { databaseUuidSchema } from "./database-uuid";
import { assessEmployeeFile, type EmployeeRequirement, type EmployeeFileRecord, type EmployeeSummary } from "@/lib/staff/employee-file";

export type EmployeeSourceRecord = { record_id: string; requirement_id: string; requirement_version: number; status: string; completed_on: string | null; expires_on: string | null };
export type EmployeeSourceField = { source_id: string; component_key: string; label: string; kind: string; state: string; requirement_codes: string[]; records: EmployeeSourceRecord[]; value: string | null; reason: string };
export type EmployeeSourcesReply = {
  task_id: string; employee_id: string | null; activity_key: string; as_of: string;
  availability: "available" | "unavailable"; reason: string | null;
  can_open_employee_file: boolean; can_medical: boolean; source_version: string | null;
  fields: EmployeeSourceField[]; assessment_scope: "visible_records_only" | "unavailable";
  history: { id: string; observed_at: string; source_version: string; changed: boolean }[];
  complete: boolean;
};
export const employeeSourceReconcileSchema = z.object({ task_id: databaseUuidSchema, request_key: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/) }).strict();
export type EmployeeSourceInput = {
 task_id: string; employee_id: string | null; activity_key: string; as_of: string; availability: "available" | "unavailable"; reason: string | null;
 can_medical: boolean; can_open_employee_file: boolean; source_version: string | null; staff: EmployeeSummary | null;
 requirements: EmployeeRequirement[]; records: EmployeeFileRecord[]; history: EmployeeSourcesReply["history"]; complete: boolean;
};
export type EmployeeSourceMapping = { sourceId: string; key: string; label: string; kind: string; codes: string[]; medical: boolean; gap: string | null };
/** Reuse native readiness classification; this view never grants duty clearance. */
export function composeEmployeeSources(input: EmployeeSourceInput, mapping: readonly EmployeeSourceMapping[]): EmployeeSourcesReply {
  const sensitiveCodes = new Set(["TRN-25", "TRN-26", "DOC-037", "DOC-038", "DOC-039", "DOC-040"]);
  const requirements = input.requirements.filter(row => input.can_medical || (row.category !== "medical" && !sensitiveCodes.has(row.code)));
  const ids = new Set(requirements.map(row => row.id));
  const records = input.records.filter(row => ids.has(row.requirement_id));
  const safeRequirements = input.staff?.hire_date ? requirements : requirements.map(row => ({ ...row, due_days: null }));
  const assessments = input.staff ? assessEmployeeFile(safeRequirements, records, input.staff, input.as_of) : [];
  const fields = mapping.map((map): EmployeeSourceField => {
    const unavailable = input.availability !== "available" || (map.medical && !input.can_medical);
    if (unavailable) return { source_id: map.sourceId, component_key: map.key, label: map.label, kind: map.kind, state: "unavailable", requirement_codes: map.codes, records: [], value: null, reason: "Current native employee and medical access is required where applicable." };
    const selected = assessments.filter(row => map.codes.includes(row.requirement.code));
    const records = selected.flatMap(row => row.record ? [{ record_id: row.record.id, requirement_id: row.requirement.id, requirement_version: row.requirement.version,
      status: row.record.status, completed_on: row.record.completed_on, expires_on: row.record.expires_on }] : []);
    if (map.sourceId === "AL-E01") return { source_id: map.sourceId, component_key: map.key, label: map.label, kind: map.kind, state: input.staff?.hire_date ? "recorded" : "unknown", requirement_codes: [], records: [], value: input.staff?.hire_date ?? null, reason: "Recorded hire date; no probation or employment decision is inferred." };
    const state = map.gap ? "unknown" : selected.length === 0 ? "requirements_unknown" : selected.every(row => row.state === "verified") ? "verified" : selected.some(row => row.state === "expired") ? "expired" : [...selected].filter(row => row.state !== "verified").map(row => row.state).sort()[0];
    return { source_id: map.sourceId, component_key: map.key, label: map.label, kind: map.kind, state, requirement_codes: map.codes, records, value: null,
      reason: map.gap ?? "Native approved requirement assessment only; recording an administrative review and specialized-work authorization remain separate." };
  });
  return { task_id: input.task_id, employee_id: input.employee_id, activity_key: input.activity_key, as_of: input.as_of, availability: input.availability,
    reason: input.reason, can_open_employee_file: input.can_open_employee_file, can_medical: input.can_medical, source_version: input.source_version,
    fields, assessment_scope: input.availability === "available" ? "visible_records_only" : "unavailable", history: input.history, complete: input.complete };
}
