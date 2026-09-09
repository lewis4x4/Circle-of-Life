import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EmployeeFileClient from './EmployeeFileClient';
import type { EmployeeFileData, EmployeeFileRecord, EmployeeRequirement } from '@/lib/staff/employee-file';

vi.mock('@/lib/facility-wall-clock', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/facility-wall-clock')>(),
  todayFacilityDateIso: () => '2026-09-08',
  formatFacilityDateIso: (date: Date) => date.toISOString().slice(0, 10),
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));

const req = (extra: Partial<EmployeeRequirement> = {}): EmployeeRequirement => ({
  id: 'req-1', code: 'ORI-01', title: 'Orientation evidence', version: 1, category: 'orientation',
  source_file: 'SECTION 4-5.pdf', source_page: 7, source_excerpt: 'Orientation checklist', content: 'Approved orientation requirement',
  review_status: 'approved', review_note: 'Owner approval', due_days: null, recurrence_months: null,
  recurrence_status: 'one_time', duty: 'resident_interaction', required_signers: ['employee', 'supervisor'], applies_to_staff_roles: ['caregiver'], ...extra,
});
const record = (extra: Partial<EmployeeFileRecord> = {}): EmployeeFileRecord => ({
  id: 'record-1', requirement_id: 'req-1', staff_id: 'staff-1', status: 'submitted', completed_on: '2026-09-01', expires_on: null,
  notes: null, evidence_reference: 'Paper binder item 1', storage_path: null, created_at: '2026-09-01T12:00:00Z', reviewed_by: null, ...extra,
});
function fixture(extra: Partial<EmployeeFileData> = {}): EmployeeFileData {
  return { staff: { id: 'staff-1', first_name: 'Casey', last_name: 'Example', staff_role: 'caregiver', hire_date: '2026-01-01', employment_status: 'active', facility_id: 'facility-1', user_id: 'employee-1' },
    requirements: [], records: [], signatures: [], dutyEvents: [], attendance: [], correctiveActions: [], canManage: true, canMedical: false, actorId: 'manager-1', ...extra };
}
const fetchMock = vi.fn();
const sourceTemplates = [{ code: 'ORI-01', title: 'New hire packet', category: 'orientation',
  source_file: 'SECTION 4-5.pdf', source_page: 7, source_excerpt: 'New hire packet',
  content: 'Draft source requiring applicability review', required_signers: ['employee', 'trainer'],
  recurrence_status: 'unknown', recurrence_months: null, due_days: null, duty: null }];
let currentData: EmployeeFileData;
let mutationError: string | null;
function mutations() {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').map(([url, init]) => ({ url: String(url), ...JSON.parse(init.body) as { action: string; payload: Record<string, unknown> } }));
}
async function open(data: EmployeeFileData = fixture()) {
  currentData = data;
  render(<EmployeeFileClient staffId="staff-1" />);
  await screen.findByRole('heading', { name: 'Casey Example · Employee file' });
  return userEvent.setup();
}
function section(title: string) {
  const element = screen.getByRole('heading', { name: title }).closest('section');
  if (!element) throw new Error(`Missing section ${title}`);
  return within(element);
}

beforeEach(() => {
  mutationError = null;
  fetchMock.mockReset().mockImplementation(async (_url: string, init?: RequestInit) => {
    if (_url.endsWith('/catalog')) return { ok: true, json: async () => sourceTemplates };
    if (_url.endsWith('/training')) return { ok: true, json: async () => ({ completions: [], certificates: [], demonstrations: [] }) };
    if (init?.method === 'POST') return { ok: !mutationError, json: async () => mutationError ? { error: mutationError } : { result: 'saved-id' } };
    return { ok: true, json: async () => currentData };
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('employee file rendered workflows', () => {
  it('loads packet sources only when requested and supports retry after catalog failure', async () => {
    const user = await open();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/catalog'))).toBe(false);
    let resolveCatalog!: (value: unknown) => void;
    const catalogUrl = '/api/admin/staff/staff-1/employee-file/catalog';
    const defaultFetch = fetchMock.getMockImplementation()!;
    const catalogResponse = new Promise((resolve) => { resolveCatalog = resolve; });
    let firstCatalogRequest = true;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === catalogUrl && firstCatalogRequest) {
        firstCatalogRequest = false;
        return catalogResponse;
      }
      return defaultFetch(url, init);
    });
    // The training effect may start after open() resolves. Its request must not
    // consume the deferred catalog response, regardless of effect scheduling.
    const lateTraining = fetch('/api/admin/staff/staff-1/employee-file/training', { cache: 'no-store' });
    await user.click(screen.getByRole('button', { name: 'Requirements' }));
    expect(screen.getByRole('status')).toHaveTextContent('Loading packet sources');
    await expect(lateTraining).resolves.toMatchObject({ ok: true });
    expect(screen.queryByRole('button', { name: 'Save draft version' })).not.toBeInTheDocument();
    resolveCatalog({ ok: false, json: async () => ({ error: 'Catalog is temporarily unavailable.' }) });
    expect(await screen.findByRole('alert')).toHaveTextContent('Catalog is temporarily unavailable.');
    await user.click(screen.getByRole('button', { name: 'Retry catalog' }));
    await screen.findByRole('heading', { name: 'Create a requirement version' });
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/staff/staff-1/employee-file/catalog', { cache: 'no-store' });
    expect(mutations()).toEqual([]);
  });

  it('keeps source drafts out of the checklist and never implies duty readiness', async () => {
    const user = await open(fixture({ requirements: [req({ review_status: 'draft' })] }));
    expect(screen.getByText('No applicable requirements have been approved for this employee yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit for review' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Duty readiness' }));
    expect(screen.getAllByText('Not configured')).toHaveLength(3);
    expect(screen.queryByText('Ready', { exact: true })).not.toBeInTheDocument();
    expect(mutations()).toEqual([]);
  });

  it('does not expose confidential medical content or downloads to a general manager', async () => {
    await open(fixture({ requirements: [req({ category: 'medical', title: 'Restricted employee health form', content: 'Restricted provider findings' })],
      records: [record({ notes: 'Restricted medical note', storage_path: 'private-path' })] }));
    expect(screen.queryByText(/Restricted employee health form/)).not.toBeInTheDocument();
    expect(screen.queryByText('Restricted medical note')).not.toBeInTheDocument();
    expect(screen.queryByText('Restricted provider findings')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download evidence' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save review' })).not.toBeInTheDocument();
  });

  it('submits completion evidence for review without asserting verification or signatures', async () => {
    const user = await open(fixture({ requirements: [req()] }));
    fireEvent.change(screen.getByLabelText('Completion date'), { target: { value: '2026-09-07' } });
    await user.type(screen.getByLabelText('Signed paper or external record reference, if applicable'), 'Personnel binder section 4');
    await user.click(screen.getByRole('button', { name: 'Submit for review' }));
    await screen.findByText('Saved.');
    expect(mutations()).toEqual([{ url: '/api/admin/staff/staff-1/employee-file', action: 'submit_record', payload: {
      id: expect.any(String), requirement_id: 'req-1', completed_on: '2026-09-07', expires_on: null,
      notes: '', evidence_reference: 'Personnel binder section 4',
    } }]);
  });

  it('records a signature in the selected capacity and saves a separate review decision', async () => {
    const user = await open(fixture({ requirements: [req()], records: [record()] }));
    await user.selectOptions(screen.getByLabelText('Signing capacity'), 'supervisor');
    await user.type(screen.getByLabelText('Your full name'), 'Taylor Supervisor');
    await user.click(screen.getByLabelText('I reviewed the requirement and evidence and am signing in my own capacity.'));
    await user.click(screen.getByRole('button', { name: 'Sign' }));
    await screen.findByText('Saved.');
    expect(mutations()[0]).toMatchObject({ action: 'sign_record', payload: { id: 'record-1', functional_role: 'supervisor', signature_name: 'Taylor Supervisor' } });
    await user.type(screen.getByLabelText('Review findings, including paper signatures checked'), 'Checked the signed employee and supervisor originals');
    await user.click(screen.getByRole('button', { name: 'Save review' }));
    await waitFor(() => expect(mutations()).toHaveLength(2));
    expect(mutations()[1]).toMatchObject({ action: 'review_record', payload: { id: 'record-1', status: 'verified', review_note: 'Checked the signed employee and supervisor originals' } });
  });

  it('starts applicability empty and sends explicitly entered roles as a draft, never approval', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Requirements' }));
    await screen.findByRole('heading', { name: 'Create a requirement version' });
    const form = section('Create a requirement version');
    const roles = form.getByLabelText('Applicable staff roles');
    expect(roles).toHaveValue([]);
    expect(form.getByLabelText('Due days after hire, only if established')).toHaveValue(null);
    expect(form.getByLabelText('Recurrence')).toHaveValue('unknown');
    // happy-dom 20 serializes a multiple SELECT as only .value; mirror native
    // FormData's selected-option entries so this test can verify the real payload.
    const NativeFormData = globalThis.FormData;
    vi.stubGlobal('FormData', class extends NativeFormData {
      constructor(element?: HTMLFormElement, submitter?: HTMLElement | null) {
        super(element, submitter);
        for (const select of element?.querySelectorAll<HTMLSelectElement>('select[multiple][name]') ?? []) {
          this.delete(select.name);
          if (!select.disabled) for (const option of select.selectedOptions) {
            if (!option.disabled) this.append(select.name, option.value);
          }
        }
      }
    });
    await user.selectOptions(roles, ['caregiver', 'medication_tech']);
    expect(roles).toHaveValue(['caregiver', 'medication_tech']);
    await user.type(form.getByLabelText('Applicability decision and source'), 'Assigned orientation duties reviewed by owner');
    await user.click(form.getByRole('button', { name: 'Save draft version' }));
    await screen.findByText('Saved.');
    expect(mutations()).toHaveLength(1);
    expect(mutations()[0]).toMatchObject({ url: '/api/admin/staff/staff-1/employee-file/requirements', action: 'create', payload: {
      applies_to_staff_roles: expect.arrayContaining(['caregiver', 'medication_tech']), applicability_note: 'Assigned orientation duties reviewed by owner', recurrence_status: 'unknown', due_days: null,
    } });
    expect(mutations()[0].payload.applies_to_staff_roles).toHaveLength(2);
    expect(mutations()[0].payload.review_status).not.toBe('approved');
  });

  it('surfaces save rejection and preserves the entered evidence for correction', async () => {
    const user = await open(fixture({ requirements: [req()] }));
    mutationError = 'Evidence reference could not be validated.';
    fireEvent.change(screen.getByLabelText('Completion date'), { target: { value: '2026-09-07' } });
    await user.type(screen.getByLabelText('Signed paper or external record reference, if applicable'), 'Binder reference');
    await user.click(screen.getByRole('button', { name: 'Submit for review' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Evidence reference could not be validated.');
    expect(screen.queryByText('Saved.')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Signed paper or external record reference, if applicable')).toHaveValue('Binder reference');
  });

  it('records a human decision only after selecting a reviewed event and does not post on threshold display', async () => {
    const user = await open(fixture({ attendance: Array.from({ length: 6 }, (_, index) => ({ id: `event-${index}`, event_type: 'callout', occurred_at: `2026-09-0${index + 1}T12:00:00Z`, review_status: 'counted', review_reason: 'Reviewed circumstance', minutes_deviation: null, reason: 'Reported absence' })) }));
    await user.click(screen.getByRole('button', { name: 'Attendance review' }));
    expect(screen.getByText(/6-absence threshold in the draft source reached/)).toBeInTheDocument();
    expect(mutations()).toEqual([]);
    const form = section('Record a human corrective-action decision');
    expect(form.getByLabelText('Reviewed triggering event')).toHaveValue('');
    await user.selectOptions(form.getByLabelText('Reviewed triggering event'), 'event-5');
    await user.selectOptions(form.getByLabelText('Authorized decision'), 'written_warning');
    fireEvent.change(form.getByLabelText('Effective date'), { target: { value: '2026-09-08' } });
    await user.type(form.getByLabelText('Decision rationale and coaching document reference'), 'Authorized coaching record');
    await user.click(form.getByRole('button', { name: 'Record authorized decision' }));
    await screen.findByText('Saved.');
    expect(mutations()).toEqual([{ url: '/api/admin/staff/staff-1/employee-file', action: 'record_corrective_action', payload: {
      action: 'written_warning', attendance_event_id: 'event-5', notes: 'Authorized coaching record', effective_date: '2026-09-08', absence_count_at_action: 6, tardy_count_at_action: 0, copy_given_to_employee_at: null,
    } }]);
  });

  it('withholds management sections from an employee self-service viewer', async () => {
    await open(fixture({ canManage: false, canMedical: true, actorId: 'employee-1' }));
    expect(screen.queryByRole('button', { name: 'Requirements' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Attendance review' })).not.toBeInTheDocument();
  });
});

it('shows future employment without attendance actions or premature duty clearance', async () => {
  const data = fixture({ requirements: [req()], records: [record({ status: 'verified', reviewed_by: 'reviewer-1' })] });
  data.staff.hire_date = '2026-10-01';
  const user = await open(data);
  await user.click(screen.getByRole('button', { name: 'Attendance review' }));
  expect(screen.getByText('Employment starts on 2026-10-01. Attendance review becomes available on that date.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Record for review' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Record authorized decision' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Duty readiness' }));
  expect(screen.getAllByText('Blocked')).toHaveLength(3);
  expect(screen.queryByText('Ready', { exact: true })).not.toBeInTheDocument();
  expect(mutations()).toEqual([]);
});
