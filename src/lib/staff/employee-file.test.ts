import { describe, expect, it } from 'vitest';
import { employeeAuditExport, type EmployeeFileData, assessDutyReadiness, assessEmployeeFile, latestRequirements, type DutyEvent, type EmployeeFileRecord, type EmployeeRequirement, type EmployeeSummary } from './employee-file';

const staff: EmployeeSummary = { id: 'staff-a', first_name: 'Test', last_name: 'Employee', staff_role: 'caregiver', hire_date: '2026-01-01', employment_status: 'active', facility_id: 'facility-a', user_id: null };
const requirement = (overrides: Partial<EmployeeRequirement> = {}): EmployeeRequirement => ({
  id: 'req-v1', code: 'ORIENTATION', title: 'Orientation', version: 1, category: 'orientation',
  source_file: 'SECTION 4-5.pdf', source_page: 7, source_excerpt: 'Orientation checklist', content: 'Reviewed content',
  review_status: 'approved', review_note: 'Approved by policy owner', due_days: 3,
  recurrence_months: null, recurrence_status: 'one_time', duty: 'resident_interaction',
  required_signers: ['employee', 'supervisor'], applies_to_staff_roles: ['caregiver'], ...overrides,
});
const evidence = (overrides: Partial<EmployeeFileRecord> = {}): EmployeeFileRecord => ({
  id: 'record-a', requirement_id: 'req-v1', staff_id: staff.id, status: 'verified', completed_on: '2026-01-03',
  expires_on: null, notes: null, evidence_reference: 'Verified evidence reference', storage_path: null,
  created_at: '2026-01-03T12:00:00Z', reviewed_by: 'reviewer-a', ...overrides,
});
const assess = (requirements: EmployeeRequirement[], records: EmployeeFileRecord[] = []) => assessEmployeeFile(requirements, records, staff, '2026-09-08');

describe('employee file requirements and duty readiness', () => {
  it('retains the approved version under newer drafts but never resurrects it after retirement', () => {
    const approved = requirement();
    expect(latestRequirements([approved, requirement({ id: 'req-v2', version: 2, review_status: 'draft' }), requirement({ id: 'req-v3', version: 3, review_status: 'retired' })])).toEqual([]);
    expect(assess([approved, requirement({ id: 'req-v2', version: 2, review_status: 'draft' })], [evidence()])[0].state).toBe('verified');
  });

  it('does not apply evidence signed against an outdated approved version to its replacement', () => {
    const rows = assess([requirement(), requirement({ id: 'req-v2', version: 2 })], [evidence()]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ requirement: { id: 'req-v2' }, state: 'missing', record: null });
  });

  it('fails closed when renewal frequency is unknown, even with verified unexpired evidence', () => {
    const rows = assess([requirement({ recurrence_status: 'unknown' })], [evidence({ expires_on: '2027-01-01' })]);
    expect(rows[0].state).toBe('renewal_unknown');
    expect(assessDutyReadiness(rows, 'resident_interaction', 'active').status).toBe('blocked');
  });

  it('requires an expiry for a recurring requirement and includes the expiration date itself', () => {
    const recurring = requirement({ recurrence_status: 'recurring', recurrence_months: 12 });
    expect(assess([recurring], [evidence()])[0].state).toBe('renewal_unknown');
    expect(assess([recurring], [evidence({ expires_on: '2026-09-08' })])[0].state).toBe('verified');
    expect(assess([recurring], [evidence({ expires_on: '2026-09-07' })])[0].state).toBe('expired');
  });

  it('does not mark an unconfigured duty ready and excludes requirements for unrelated roles', () => {
    const rows = assess([requirement(), requirement({ id: 'admin-only', code: 'ADMIN', applies_to_staff_roles: ['administrator'], duty: 'medication' })], [evidence()]);
    expect(rows.map((row) => row.requirement.id)).toEqual(['req-v1']);
    expect(assessDutyReadiness(rows, 'medication', 'active').status).toBe('not_configured');
    expect(assessDutyReadiness(assess([requirement({ review_status: 'draft' })]), 'resident_interaction', 'active').status).toBe('not_configured');
  });

  it('blocks medication duty on missing prerequisite evidence and inactive employment', () => {
    const requirements = [requirement(), requirement({ id: 'care', code: 'CARE', duty: 'personal_care' }), requirement({ id: 'med', code: 'MED', duty: 'medication' })];
    const rows = assess(requirements, [evidence({ requirement_id: 'med' })]);
    expect(assessDutyReadiness(rows, 'medication', 'active').status).toBe('blocked');
    expect(assessDutyReadiness(assess([requirement()], [evidence()]), 'resident_interaction', 'terminated').status).toBe('blocked');
  });

  it('does not allow another employee evidence to satisfy this employee requirement', () => {
    expect(assess([requirement()], [evidence({ staff_id: 'staff-b' })])[0].state).toBe('missing');
  });

  it('preserves actual duty activity and evidence history while reporting unmet eligibility', () => {
    const dutyEvents: DutyEvent[] = [{ id: 'actual-event', duty: 'medication', occurred_at: '2026-01-02T12:00:00Z', note: 'Historical activity before clearance' }];
    const requirements = [requirement()];
    const records = [evidence({ id: 'new', created_at: '2026-04-01T12:00:00Z' }), evidence({ id: 'old' })];
    const before = JSON.stringify({ dutyEvents, requirements, records });
    const rows = assess(requirements, records);
    expect(assessDutyReadiness(rows, 'medication', 'active').status).toBe('not_configured');
    expect(JSON.stringify({ dutyEvents, requirements, records })).toBe(before);
    expect(dutyEvents[0].occurred_at).toBe('2026-01-02T12:00:00Z');
  });

  it('keeps a prior current verified record when a newer submission is still awaiting review', () => {
    const rows = assess([requirement()], [evidence(), evidence({ id: 'pending', status: 'submitted', created_at: '2026-09-08T12:00:00Z' })]);
    expect(rows[0]).toMatchObject({ state: 'verified', record: { id: 'record-a' } });
  });
});

it('requires approved upstream duty definitions before medication or personal-care readiness', () => {
  const medOnly = requirement({ id: 'med', code: 'MED', duty: 'medication' });
  const careOnly = requirement({ id: 'care', code: 'CARE', duty: 'personal_care' });
  expect(assessDutyReadiness(assess([medOnly], [evidence({ requirement_id: 'med' })]), 'medication', 'active').status).toBe('not_configured');
  expect(assessDutyReadiness(assess([careOnly], [evidence({ requirement_id: 'care' })]), 'personal_care', 'active').status).toBe('not_configured');
  expect(assessDutyReadiness(assess([requirement(), medOnly], [evidence(), evidence({ requirement_id: 'med' })]), 'medication', 'active').status).toBe('not_configured');
});

describe('required session and distinct-day evidence', () => {
  const countedRequirement = () => requirement({ minimum_completions: 3, minimum_distinct_days: 2 });
  const sessions = (dates: string[]) => dates.map((completed_on, index) => evidence({
    id: `session-${index}`, completed_on, created_at: `${completed_on}T12:0${index}:00Z`,
  }));

  it('requires three verified sessions over two distinct dates, not simply any verified record', () => {
    const one = assess([countedRequirement()], sessions(['2026-09-01']));
    expect(one[0]).toMatchObject({ state: 'in_progress', completedCount: 1, completedDays: 1, requiredCount: 3, requiredDays: 2 });
    expect(assessDutyReadiness(one, 'resident_interaction', 'active').status).toBe('blocked');
    const sameDay = assess([countedRequirement()], sessions(['2026-09-01', '2026-09-01', '2026-09-01']));
    expect(sameDay[0]).toMatchObject({ state: 'in_progress', completedCount: 3, completedDays: 1 });
    expect(assessDutyReadiness(sameDay, 'resident_interaction', 'active').status).toBe('blocked');
    const complete = assess([countedRequirement()], sessions(['2026-09-01', '2026-09-01', '2026-09-02']));
    expect(complete[0]).toMatchObject({ state: 'verified', completedCount: 3, completedDays: 2 });
    expect(assessDutyReadiness(complete, 'resident_interaction', 'active').status).toBe('ready');
  });

  it.each([
    { minimum_completions: null, minimum_distinct_days: 2 },
    { minimum_completions: 3, minimum_distinct_days: null },
    { minimum_completions: null, minimum_distinct_days: null },
  ])('blocks unresolved explicit count requirements: %j', (counts) => {
    const rows = assess([requirement(counts)], sessions(['2026-09-01', '2026-09-01', '2026-09-02']));
    expect(rows[0].state).toBe('requirements_unknown');
    expect(assessDutyReadiness(rows, 'resident_interaction', 'active').status).toBe('blocked');
  });

  it('keeps unknown recurrence blocked after both evidence counts are met', () => {
    const rows = assess([requirement({ minimum_completions: 3, minimum_distinct_days: 2, recurrence_status: 'unknown' })],
      sessions(['2026-09-01', '2026-09-01', '2026-09-02']));
    expect(rows[0]).toMatchObject({ state: 'renewal_unknown', completedCount: 3, completedDays: 2 });
    expect(assessDutyReadiness(rows, 'resident_interaction', 'active').status).toBe('blocked');
  });

  it('excludes expired sessions from both completion and distinct-day totals', () => {
    const records = sessions(['2026-09-01', '2026-09-01', '2026-09-02']);
    records[2].expires_on = '2026-09-07';
    const rows = assess([countedRequirement()], records);
    expect(rows[0]).toMatchObject({ state: 'in_progress', completedCount: 2, completedDays: 1 });
    expect(assessDutyReadiness(rows, 'resident_interaction', 'active').status).toBe('blocked');
  });

  it('keeps legacy undefined counts compatible with one completion on one day', () => {
    const rows = assess([requirement()], [evidence()]);
    expect(rows[0]).toMatchObject({ state: 'verified', requiredCount: 1, requiredDays: 1, completedCount: 1, completedDays: 1 });
  });
});


describe('personnel audit export confidentiality', () => {
  it('omits medical, free-text and cross-staff evidence even for a medical reviewer', () => {
    const data: EmployeeFileData = {
      staff, canManage: true, canMedical: true, actorId: 'reviewer-a',
      requirements: [requirement(), requirement({ id: 'medical-req', code: 'MEDICAL', category: 'medical', title: 'PRIVATE_MEDICAL_TITLE' }), requirement({ id: 'payroll-req', code: 'PAYROLL', category: 'payroll' })],
      records: [evidence({ notes: 'PRIVATE_NOTE', review_note: 'PRIVATE_REVIEW', evidence_reference: 'PRIVATE_REFERENCE', storage_path: 'PRIVATE_PATH' }), evidence({ id: 'medical-record', requirement_id: 'medical-req', notes: 'PRIVATE_DIAGNOSIS' }), evidence({ id: 'foreign-record', staff_id: 'staff-b', notes: 'PRIVATE_OTHER_EMPLOYEE' }), evidence({ id: 'payroll-record', requirement_id: 'payroll-req', notes: 'PRIVATE_BANK_ACCOUNT' })],
      signatures: [{ id: 'sig-1', record_id: 'record-a', user_id: 'employee', functional_role: 'employee', signature_name: 'Allowed Employee', signed_at: '2026-01-03T12:00:00Z' }, { id: 'sig-2', record_id: 'medical-record', user_id: 'provider', functional_role: 'provider', signature_name: 'PRIVATE_MEDICAL_SIGNER', signed_at: '2026-01-03T12:00:00Z' }, { id: 'sig-3', record_id: 'foreign-record', user_id: 'other', functional_role: 'employee', signature_name: 'PRIVATE_OTHER_SIGNER', signed_at: '2026-01-03T12:00:00Z' }],
      dutyEvents: [], attendance: [], correctiveActions: [],
    };
    const exported = employeeAuditExport(data, '2026-09-08');
    expect(exported.evidence.map((row) => row.id)).toEqual(['record-a', 'payroll-record']);
    expect(exported.signatures).toEqual([{ record_id: 'record-a', capacity: 'employee', signer: 'Allowed Employee', signed_at: '2026-01-03T12:00:00Z' }]);
    expect(exported.checklist.map((row) => row.code)).toEqual(['ORIENTATION', 'PAYROLL']);
    expect(JSON.stringify(exported)).not.toContain('PRIVATE_');
    expect(JSON.stringify(exported)).not.toContain('staff-b');
    for (const row of exported.evidence) {
      expect(row).not.toHaveProperty('notes');
      expect(row).not.toHaveProperty('review_note');
      expect(row).not.toHaveProperty('storage_path');
      expect(row).not.toHaveProperty('evidence_reference');
    }
    expect(data.records).toHaveLength(4);
    expect(data.signatures).toHaveLength(3);
  });
});
