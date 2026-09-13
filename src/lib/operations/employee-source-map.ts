import catalog from "./activity-catalog.json";
import requirements from "../../../docs/employee-lifecycle/requirements.json";
import type { EmployeeSourceMapping } from "./employee-sources";
const ids = "AL-D13 AL-D15 AL-W02 AL-W06 AL-A10 AL-A11 AL-E01 AL-E02 AL-E03 AL-E04 AL-E05 AL-E06 AL-E07 AL-E08 AL-E09 AL-E10 AL-E11 AL-E12 AL-E13 AL-E14".split(" ");
const training = requirements.filter(row => ["training", "orientation"].includes(row.category)).map(row => row.code);
const codes: Record<string, string[]> = {
  "AL-E04": ["DOC-039", "TRN-25"], "AL-E05": ["DOC-038", "DOC-040", "TRN-26"],
  "AL-E06": ["TRN-24"], "AL-E07": ["DOC-026", "DOC-027", "DOC-028", "DOC-029", "DOC-030"],
  "AL-E08": ["TRN-12"], "AL-E10": ["TRN-21"], "AL-E11": ["TRN-07"], "AL-E12": training,
};
const gaps: Record<string, string> = {
  "AL-D13": "The staff screening log and its applicability are unconfirmed; a certificate is not a daily screening log.",
  "AL-D15": "Attendance calendar subject and counting rules are unconfirmed. No employment action is authorized.",
  "AL-W02": "AHCA roster integration is unavailable. Manual submission evidence does not prove external acceptance.",
  "AL-A10": "Attendance calendar scope is unconfirmed. A human review is separate from attendance records.",
  "AL-E02": "Training evidence is available in Employee File; an assignment workflow has not been verified.",
  "AL-E03": "No exact 90-day review requirement or approved date rule has been established.",
  "AL-E04": "Medical classification must be approved. Draft TRN-25 training classification does not establish medical access or completeness.",
  "AL-E05": "A referral is not a test result. Draft TRN-26 classification and annual recurrence do not establish medical access or currency.",
  "AL-E07": "Screening packet notices and attestations are not final screening clearance or an approved expiry rule.",
  "AL-E09": "No exact two-hour annual medication technician update requirement has been established.",
  "AL-E12": "The complete applicable new-hire program set, cart-training counts and LMH applicability remain unconfirmed.",
  "AL-E13": "AHCA roster integration is unavailable. Manual submission evidence does not prove external acceptance.",
  "AL-E14": "The manager twelve-hour update and biannual cadence require confirmation.",
};
/** Canonical source mapping, not requirement approval or clinical/employment authority. */
export const employeeSourceMap: EmployeeSourceMapping[] = catalog.entries.filter(entry => ids.includes(entry.sourceId)).flatMap(entry => entry.components.map(component => {
  const aggregate = ["hfo-al-w06-01", "hfo-al-a11-01"].includes(component.key);
  const roster = component.key === "hfo-al-a11-02";
  return { sourceId: entry.sourceId, key: component.key, label: component.label, kind: component.kind,
    codes: aggregate ? requirements.map(row => row.code) : component.key === "hfo-al-w06-02" ? training : codes[entry.sourceId] ?? [],
    medical: ["AL-D13", "AL-E04", "AL-E05"].includes(entry.sourceId),
    gap: roster ? "AHCA roster integration is unavailable; file readiness does not verify an external roster." : gaps[entry.sourceId] ?? (aggregate || component.key === "hfo-al-w06-02" ? "Visible approved records only; full file/inservice coverage and explicit human audit remain separate." : null),
  };
}));
