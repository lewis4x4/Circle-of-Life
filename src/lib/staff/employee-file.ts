import { addDays, formatISO, parseISO } from "date-fns";

export const FILE_CATEGORIES = ["policy", "application", "payroll", "benefit", "consent", "job_description", "orientation", "training", "screening", "medical"] as const;
export const SIGNER_PURPOSES = ["employee", "supervisor", "witness", "trainer", "administrator", "provider"] as const;
export const DUTIES = ["resident_interaction", "personal_care", "medication"] as const;
export type Duty = typeof DUTIES[number];
export type FileCategory = typeof FILE_CATEGORIES[number];
export type SignerPurpose = typeof SIGNER_PURPOSES[number];
export type EmployeeRequirement = {
  id: string; code: string; title: string; version: number; category: FileCategory;
  source_file: string; source_page: number; source_excerpt: string; content: string;
  review_status: "draft" | "approved" | "retired"; review_note: string | null;
  due_days: number | null; recurrence_months: number | null;
  recurrence_status: "unknown" | "one_time" | "recurring";
  duty: Duty | null; required_signers: SignerPurpose[]; applies_to_staff_roles: string[];
  minimum_completions?: number | null; minimum_distinct_days?: number | null;
};
export type EmployeeFileRecord = {
  id: string; requirement_id: string; staff_id: string; status: "submitted" | "verified" | "rejected";
  completed_on: string | null; expires_on: string | null; notes: string | null;
  evidence_reference: string | null; storage_path: string | null; created_at: string;
  reviewed_by: string | null; review_note?: string | null;
};
export type EmployeeSignature = { id: string; record_id: string; functional_role: SignerPurpose; signature_name: string; signed_at: string; user_id: string };
export type EmployeeSummary = { id: string; first_name: string; last_name: string; staff_role: string; hire_date: string; employment_status: string; facility_id: string; user_id: string | null; facility_name?: string | null };
export type DutyEvent = { id: string; duty: Duty; occurred_at: string; note?: string | null; readiness_snapshot?: { status: "ready" | "blocked" | "not_configured"; requires_review: boolean; assessed_at: string; basis: string } };
export type AttendanceEvent = { id: string; event_type: string; occurred_at: string; review_status: "pending" | "counted" | "excluded"; review_reason: string | null; minutes_deviation: number | null; reason: string | null };
export type CorrectiveAction = { id: string; action: string; effective_date: string; notes: string | null; retracted_at: string | null };
export type EmployeeFileData = {
  staff: EmployeeSummary; requirements: EmployeeRequirement[]; records: EmployeeFileRecord[];
  signatures: EmployeeSignature[]; dutyEvents: DutyEvent[]; attendance: AttendanceEvent[];
  correctiveActions: CorrectiveAction[]; canManage: boolean; canMedical: boolean; actorId: string; actorRole?: string;
};

export function latestRequirements(requirements: EmployeeRequirement[]): EmployeeRequirement[] {
  const byCode = new Map<string, EmployeeRequirement>();
  for (const requirement of requirements) {
    // A newer draft must not replace the currently approved version.
    if (requirement.review_status === "draft") continue;
    const previous = byCode.get(requirement.code);
    if (!previous || requirement.version > previous.version) byCode.set(requirement.code, requirement);
  }
  // Retirement of the newest effective version must not resurrect an older one.
  return [...byCode.values()].filter((requirement) => requirement.review_status === "approved");
}

export function appliesToStaff(requirement: EmployeeRequirement, staffRole: string): boolean {
  return requirement.applies_to_staff_roles.includes("*") || requirement.applies_to_staff_roles.includes(staffRole);
}

export type RequirementAssessment = { requirement: EmployeeRequirement; state: "verified" | "missing" | "pending" | "expired" | "renewal_unknown" | "requirements_unknown" | "in_progress"; dueOn: string | null; overdue: boolean; record: EmployeeFileRecord | null; completedCount: number; completedDays: number; requiredCount: number | null; requiredDays: number | null };
export function assessEmployeeFile(requirements: EmployeeRequirement[], records: EmployeeFileRecord[], staff: EmployeeSummary, today: string): RequirementAssessment[] {
  return latestRequirements(requirements).filter((r) => appliesToStaff(r, staff.staff_role)).map((requirement) => {
    const relevant = records.filter((r) => r.requirement_id === requirement.id && r.staff_id === staff.id);
    const current = relevant.filter((r) => r.status === "verified" && r.completed_on && r.completed_on <= today && (!r.expires_on || r.expires_on >= today));
    const verified = current.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    const requiredCount = requirement.minimum_completions === undefined ? 1 : requirement.minimum_completions;
    const requiredDays = requirement.minimum_distinct_days === undefined ? 1 : requirement.minimum_distinct_days;
    const completedDays = new Set(current.map((r) => r.completed_on)).size;
    const record = verified ?? relevant.slice().sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
    let state: RequirementAssessment["state"] = "missing";
    if (verified) {
      state = requirement.recurrence_status === "unknown" || (requirement.recurrence_status === "recurring" && !verified.expires_on) ? "renewal_unknown" : "verified";
      if (requiredCount === null || requiredDays === null) state = "requirements_unknown";
      else if (current.length < requiredCount || completedDays < requiredDays) state = "in_progress";
    } else if (record?.status === "submitted") state = "pending";
    else if (record?.status === "verified" && record.expires_on && record.expires_on < today) state = "expired";
    const dueOn = requirement.due_days === null ? null : formatISO(addDays(parseISO(staff.hire_date), requirement.due_days), { representation: "date" });
    return { requirement, state, record, dueOn, overdue: !!dueOn && dueOn < today && state !== "verified", completedCount: current.length, completedDays, requiredCount, requiredDays };
  });
}

export function assessDutyReadiness(assessments: RequirementAssessment[], duty: Duty, employmentStatus: string, hireDate?: string, today?: string): { status: "not_configured" | "blocked" | "ready"; reasons: string[] } {
  if (hireDate && today && hireDate > today) return { status: "blocked", reasons: ["Employment has not started."] };
  if (employmentStatus !== "active") return { status: "blocked", reasons: ["Employment is not active."] };
  const relevant = assessments.filter((a) => a.requirement.duty === duty || (duty !== "resident_interaction" && a.requirement.duty === "resident_interaction") || (duty === "medication" && a.requirement.duty === "personal_care"));
  const needed: Duty[] = duty === "medication" ? ["resident_interaction", "personal_care", "medication"] : duty === "personal_care" ? ["resident_interaction", "personal_care"] : ["resident_interaction"];
  if (needed.some((d) => !assessments.some((a) => a.requirement.duty === d))) return { status: "not_configured", reasons: ["Applicable requirements for this duty and its prerequisites have not been approved."] };
  const missing = relevant.filter((a) => a.state !== "verified");
  return missing.length ? { status: "blocked", reasons: missing.map((a) => `${a.requirement.title}: ${a.state.replaceAll("_", " ")}`) } : { status: "ready", reasons: [] };
}

export function displayDuty(duty: string) { return duty.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase()); }

/** A personnel audit export intentionally excludes confidential medical records and free-text notes. */
export function employeeAuditExport(data: EmployeeFileData, today: string) {
  const requirements = data.requirements.filter((r) => r.category !== "medical");
  const requirementIds = new Set(requirements.map((r) => r.id));
  const records = data.records.filter((r) => r.staff_id === data.staff.id && requirementIds.has(r.requirement_id));
  const recordIds = new Set(records.map((r) => r.id));
  return {
    generated_on: today,
    scope: "Personnel checklist and signature evidence. Confidential medical records and free-text notes excluded.",
    employee: { id: data.staff.id, name: `${data.staff.first_name} ${data.staff.last_name}`, facility_id: data.staff.facility_id, role: data.staff.staff_role },
    checklist: assessEmployeeFile(requirements, records, data.staff, today).map((a) => ({ code: a.requirement.code, title: a.requirement.title, version: a.requirement.version, state: a.state, due_on: a.dueOn, completed_count: a.completedCount, required_count: a.requiredCount, distinct_days: a.completedDays, required_days: a.requiredDays, source_file: a.requirement.source_file, source_page: a.requirement.source_page })),
    evidence: records.map((r) => ({ id: r.id, requirement_id: r.requirement_id, status: r.status, completed_on: r.completed_on, expires_on: r.expires_on, reviewed_by: r.reviewed_by })),
    signatures: data.signatures.filter((s) => recordIds.has(s.record_id)).map((s) => ({ record_id: s.record_id, capacity: s.functional_role, signer: s.signature_name, signed_at: s.signed_at })),
  };
}
