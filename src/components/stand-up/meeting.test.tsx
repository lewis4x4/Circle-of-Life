import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StandUpWorkspace } from './workspace';
import { useFacilityStore } from '@/hooks/useFacilityStore';
import type { MeetingReport, MeetingWorkspace } from '@/lib/stand-up/meetings';
import { StandUpRequestError } from './transport';

const mocks = vi.hoisted(() => ({ request: vi.fn(), auth: { loading: false, user: { id: 'u' } as { id: string } | null, organizationId: 'org', appRole: 'facility_admin' }, disagreements: [] as unknown[] }));
vi.mock('@/contexts/haven-auth-context', () => ({ useHavenAuth: () => mocks.auth }));
// Census chips and notices read through the browser client; nothing is open in these fixtures.
// COL-555: the facility's census reasons are a setting, read through haven_operating_rule.
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc: async (name: string, args: Record<string, unknown> = {}) =>
  name === 'haven_operating_rule' && args.p_rule_key === 'stand_up.census_reason_options'
    ? { data: [{ value: [{ key: 'roster_not_current', label: 'Roster not updated yet' }, { key: 'change_not_entered', label: 'Admission or discharge not entered in Haven' }, { key: 'other', label: 'Other' }], rule_id: 'r', effective_from: '2026-09-25', facility_id: null }], error: null }
    : name === 'stand_up_census_disagreements' ? { data: mocks.disagreements, error: null }
    : { data: [], error: null }, from: () => { const q: Record<string, unknown> = {}; for (const m of ['select', 'eq', 'in', 'is', 'order', 'limit']) q[m] = () => q; q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve); return q } }) }));
vi.mock('./transport', async importOriginal => ({ ...(await importOriginal<typeof import('./transport')>()), standUpRequest: mocks.request }));

const monday = { facilities: [{ id: 'a', name: 'Homewood' }], reports: [], current_week: '2026-09-21', can_import: false, server_now: '2026-09-24T12:30:00Z' };
const meetingWindow = { week_start: '2026-09-21', meeting_date: '2026-09-24', entry_opens_at: '2026-09-21T13:15:00Z', entry_due_at: '2026-09-24T12:45:00Z', call_at: '2026-09-24T13:15:00Z' };
const baseline = { revision_id: 'm1', submitted_at: '2026-09-21T12:40:00Z', values: { current_ar_cents: 11000000, current_total_census: 38, hospital_and_rehab_total: 1 } };
const schedule = [
  { meeting_day: 'monday', weekday: 1, entry_due_local: '08:45', call_local: '09:15', time_zone: 'America/New_York', facility_override: false },
  { meeting_day: 'thursday', weekday: 4, entry_due_local: '08:45', call_local: '09:15', time_zone: 'America/New_York', facility_override: false },
];
function thursday(patch: Partial<MeetingWorkspace> = {}): MeetingWorkspace {
  return {
    meeting_day: 'thursday', scheduled: true, current_week: '2026-09-21', window: meetingWindow, schedule: schedule as MeetingWorkspace['schedule'],
    keys: ['current_ar_cents', 'current_total_census', 'departures_since_monday', 'hospital_and_rehab_total', 'hospital_total', 'rehab_total'],
    facilities: [{ id: 'a', name: 'Homewood', open_week: '2026-09-21', window: meetingWindow }], reports: [],
    monday_baselines: [{ facility_id: 'a', week_start: '2026-09-21', monday_submitted: baseline }],
    can_edit: true, can_edit_submitted: true, server_now: '2026-09-24T12:30:00Z', actor_role: 'facility_admin', ...patch,
  };
}
const saved = (patch: Partial<MeetingReport> = {}): MeetingReport => ({
  id: 't1', facility_id: 'a', week_start: '2026-09-21', meeting_day: 'thursday', version: 1, revision_id: 'tr1',
  values: { current_ar_cents: 11710800, current_total_census: 36, departures_since_monday: 2, hospital_and_rehab_total: 3, hospital_total: 1, rehab_total: 2 },
  status: 'ready', source_as_of: '2026-09-24T12:31:00Z', updated_at: '2026-09-24T12:31:00Z', updated_by_name: 'Charlene',
  last_submitted_at: '2026-09-24T12:31:00Z', monday_submitted: baseline, ...patch,
});

// COL-754: the facility's Thursday report as the server returns it.
const facilityReport = {
  facility_id: 'a', facility_name: 'Homewood', week_start: '2026-09-21', since: '2026-09-21T13:15:00Z',
  figures: {
    current_ar_cents: { value: 11710800, source: 'Invoices in Haven: sent with a balance, plus drafts not yet sent' },
    current_total_census: { value: 36, source: 'Resident roster: in house, at hospital or rehab, and on leave' },
    departures_since_monday: { value: 2, source: 'Discharges and deaths dated since Monday’s call' },
    hospital_and_rehab_total: { value: 3, source: 'Resident roster: bed-hold stays at a hospital or in rehab' },
    hospital_total: { value: 1, source: 'Resident roster: stays recorded as hospital', note: '1 stay(s) have no hospital or rehab recorded and are in the total only' },
    rehab_total: { value: 1, source: 'Resident roster: stays recorded as rehab' },
  },
  departures: [{ resident: 'Test Resident C', kind: 'discharged', at: '2026-09-22T15:00:00Z', recorded_at: '2026-09-22T15:05:00Z', new: true }],
  hospital: { out_now: [{ resident: 'Test Resident B', stay_type: 'rehab', since: '2026-09-22T14:00:00Z' }], went_out: [], came_back: [] },
  names_shown: true, admission_notes_shown: true,
  potential_residents: [{
    lead_id: 'l1', name: 'Avery Prospect', stage: 'tour_scheduled', work_state: 'assigned', owner_name: 'Robin Recruiter',
    next_action: 'Call back to book the tour', next_action_at: '2026-09-26T13:00:00Z', created_at: '2026-09-15T12:00:00Z', new: false,
    tours: [{ scheduled_for: '2026-09-25T15:00:00Z', outcome: 'scheduled', completed_at: null, owner_name: 'Robin Recruiter', new: true }],
    admission: { status: 'pending_clearance', target_move_in_date: '2026-10-05', financial_clearance_at: null, physician_orders_received_at: null, medicaid_pipeline_stage: 'prospect', bed_label: null, form_1823_status: 'pending' },
    notes_withheld: false,
    timeline: [
      { at: '2026-09-15T12:00:00Z', recorded_at: '2026-09-15T12:00:00Z', new: false, kind: 'lead_note', by: null, method: null, with: null, text: 'Prefers a private room.', status: null },
      { at: '2026-09-22T14:30:00Z', recorded_at: '2026-09-22T14:31:00Z', new: true, kind: 'contact', by: 'Robin Recruiter', method: 'phone_call', with: 'Jordan Prospect (Daughter)', text: 'Daughter wants a tour next week.', status: null },
    ],
  }],
  recruiters: [{ user_id: 'r1', name: 'Robin Recruiter', contacts: 1, tours: 1, outreach: 0, items: [{ at: '2026-09-22T14:31:00Z', kind: 'contact', lead_name: 'Avery Prospect', method: 'phone_call', text: 'Daughter wants a tour next week.', status: null }] }],
};
const thursdayReport = { meeting_day: 'thursday', generated_at: '2026-09-24T12:30:00Z', actor_role: 'facility_admin', facilities: [facilityReport] };

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => {
  mocks.auth.appRole = 'facility_admin';
  mocks.disagreements = [];
  mocks.request.mockReset();
  mocks.request.mockImplementation(async (action: string, payload: Record<string, unknown>) => {
    if (action === 'workspace') return payload.meeting_day === 'thursday' ? thursday() : monday;
    if (action === 'report' && payload.meeting_day === 'thursday') return thursdayReport;
    throw new Error('Unexpected operation');
  });
  useFacilityStore.setState({ selectedFacilityId: null, availableFacilities: [], facilitiesCacheUserId: 'u' });
  Object.defineProperty(window, 'navigation', { configurable: true, value: new EventTarget() });
});

async function openThursday() {
  render(<StandUpWorkspace />);
  fireEvent.change(await screen.findByLabelText('Meeting'), { target: { value: 'thursday' } });
  await screen.findByRole('heading', { name: 'Thursday Stand Up' });
  // The heading shows while the workspace loads; wait until it has.
  await waitFor(() => expect(screen.queryByText('Loading your permitted facilities and reports…')).not.toBeInTheDocument());
}

describe('Stand Up meets Monday and Thursday (COL-752)', () => {
  it('offers Monday and Thursday, and Thursday states the schedule the server returned', async () => {
    await openThursday();
    expect(screen.getByText('Opens at Monday’s call · Due Thursday 8:45 a.m. · Call 9:15 a.m. Eastern')).toBeInTheDocument();
    expect(mocks.request).toHaveBeenCalledWith('workspace', { meeting_day: 'thursday' });
  });

  it('shows the four Thursday figures beside what was submitted on Monday, and submits them with the meeting day', async () => {
    await openThursday();
    const table = screen.getByRole('table', { name: /Thursday figures beside Monday/ });
    expect(within(table).getByText('$110,000.00')).toBeInTheDocument();
    expect(within(table).getAllByText('Not on Monday’s report')).toHaveLength(3);
    fireEvent.change(screen.getByLabelText('Current A/R'), { target: { value: '117,108.00' } });
    fireEvent.change(screen.getByLabelText('Current census'), { target: { value: '36' } });
    fireEvent.change(screen.getByLabelText('Departures since Monday'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Residents at hospital or rehab'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('At a hospital'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('In rehab'), { target: { value: '2' } });
    expect(within(table).getByText('+$7,108.00')).toBeInTheDocument();
    expect(within(table).getByText('−2')).toBeInTheDocument();
    mocks.request.mockImplementationOnce(async () => saved());
    fireEvent.click(screen.getByRole('button', { name: 'Submit Thursday figures' }));
    await screen.findByText(/^Submitted September 24/);
    // The roster is read again after a save; the save is the last 'save' call.
    const [action, payload] = mocks.request.mock.calls.filter(call => call[0] === 'save').at(-1)!;
    expect(action).toBe('save');
    expect(payload).toMatchObject({ meeting_day: 'thursday', facility_id: 'a', week_start: '2026-09-21', expected_version: 0, status: 'ready',
      values: { current_ar_cents: 11710800, current_total_census: 36, departures_since_monday: 2, hospital_and_rehab_total: 3, hospital_total: 1, rehab_total: 2 } });
    expect(typeof payload.request_id).toBe('string');
  });

  it('asks why Thursday census differs from the roster, refuses to submit without it, and records it (COL-555)', async () => {
    mocks.request.mockImplementation(async (action: string, payload: Record<string, unknown>) => {
      if (action === 'workspace') return payload.meeting_day === 'thursday' ? thursday() : monday;
      if (action === 'report' && payload.meeting_day === 'thursday') return thursdayReport;
      if (action === 'roster') return { facility_id: 'a', in_house_count: 34, hospital_hold_count: 3, loa_count: 1, roster_census_count: 38, resident_count_in_haven: 40, roster_as_of: '2026-09-23T12:00:00Z' };
      if (action === 'save') return saved({ values: payload.values as MeetingReport['values'] });
      throw new Error('Unexpected operation');
    });
    await openThursday();
    fireEvent.change(screen.getByLabelText('Current A/R'), { target: { value: '117,108.00' } });
    fireEvent.change(screen.getByLabelText('Current census'), { target: { value: '36' } });
    fireEvent.change(screen.getByLabelText('Departures since Monday'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Residents at hospital or rehab'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('At a hospital'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('In rehab'), { target: { value: '2' } });
    const reason = await screen.findByLabelText('Why is this different from the roster (38)?');
    expect(screen.queryByLabelText(/Why is this different from the roster \(3\)/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Submit Thursday figures' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Current census differs from the roster (38). Choose why it is different, or use the roster figure.');
    expect(mocks.request.mock.calls.some(call => call[0] === 'save')).toBe(false);
    await waitFor(() => expect(within(reason).getByRole('option', { name: 'Admission or discharge not entered in Haven' })).toBeInTheDocument());
    fireEvent.change(reason, { target: { value: 'change_not_entered' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Thursday figures' }));
    await screen.findByText(/^Submitted September 24/);
    const [, payload] = mocks.request.mock.calls.filter(call => call[0] === 'save').at(-1)!;
    expect(payload.roster).toEqual({ current_total_census: { override_reason: 'change_not_entered' } });
  });

  it('says Monday was not submitted rather than showing a change of zero', async () => {
    mocks.request.mockImplementation(async (action: string, payload: Record<string, unknown>) => payload.meeting_day === 'thursday' ? thursday({ monday_baselines: [] }) : monday);
    await openThursday();
    expect(screen.getByText(/Monday’s report for this week was not submitted/)).toBeInTheDocument();
    expect(screen.getAllByText('Monday not submitted').length).toBeGreaterThan(0);
    expect(screen.queryByText('No change')).not.toBeInTheDocument();
  });

  it('keeps unsaved Thursday figures when switching back to Monday', async () => {
    await openThursday();
    fireEvent.change(screen.getByLabelText('Current census'), { target: { value: '36' } });
    fireEvent.change(screen.getByLabelText('Meeting'), { target: { value: 'monday' } });
    expect(screen.getByRole('heading', { name: 'Thursday Stand Up' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Save or discard');
  });

  it('opens Thursday for a recruiter read-only, without a Monday choice or a save', async () => {
    mocks.auth.appRole = 'recruiter';
    mocks.request.mockImplementation(async (action: string, payload: Record<string, unknown>) => {
      if (payload.meeting_day !== 'thursday') throw new StandUpRequestError('Stand Up access denied', 403);
      return thursday({ can_edit: false, can_edit_submitted: false, actor_role: 'recruiter', reports: [saved()] });
    });
    render(<StandUpWorkspace />);
    await screen.findByRole('heading', { name: 'Thursday Stand Up' });
    expect(screen.queryByLabelText('Meeting')).not.toBeInTheDocument();
    // The heading shows while the workspace loads; wait for the report itself.
    expect(await screen.findByText('You can read these figures. The facility administrator enters them.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Submit|Save draft/ })).not.toBeInTheDocument();
    expect(screen.getByText('$117,108.00')).toBeInTheDocument();
    await waitFor(() => expect(mocks.request.mock.calls.every(([, payload]) => (payload as Record<string, unknown>).meeting_day === 'thursday')).toBe(true));
  });

  it('says so when the organization has no Thursday meeting on its schedule', async () => {
    mocks.request.mockImplementation(async (action: string, payload: Record<string, unknown>) => payload.meeting_day === 'thursday' ? thursday({ scheduled: false, schedule: [schedule[0]] as MeetingWorkspace['schedule'], facilities: [] }) : monday);
    await openThursday();
    expect(screen.getByText('No Thursday meeting is scheduled')).toBeInTheDocument();
  });
});

describe('The Thursday report (COL-754)', () => {
  it('opens an unstarted report with Haven’s figures, beside Monday’s, with each source', async () => {
    await openThursday();
    await waitFor(() => expect(screen.getByLabelText('Current census')).toHaveValue('36'));
    expect(screen.getByLabelText('Current A/R')).toHaveValue('117108.00');
    expect(screen.getByLabelText('In rehab')).toHaveValue('1');
    expect(screen.getByText('Haven: 36 · Resident roster: in house, at hospital or rehab, and on leave')).toBeInTheDocument();
    expect(screen.getByText(/Haven: 1 · Resident roster: stays recorded as hospital \(1 stay\(s\) have no hospital or rehab recorded/)).toBeInTheDocument();
    // Nothing is saved until the administrator submits.
    expect(mocks.request.mock.calls.some(([action]) => action === 'save')).toBe(false);
  });

  it('lists every potential resident with tours, admission stage, next step and all notes in time order, new since Monday marked', async () => {
    await openThursday();
    const lead = await screen.findByRole('article', { name: 'Avery Prospect' });
    expect(lead).toHaveTextContent('Tour scheduled · Owner: Robin Recruiter');
    expect(lead).toHaveTextContent('Next: Call back to book the tour');
    expect(lead).toHaveTextContent('Case: Pending clearance');
    expect(lead).toHaveTextContent('Form 1823: Pending');
    const notes = within(lead).getAllByRole('listitem').filter(item => /Lead notes|Contact/.test(item.textContent ?? ''));
    expect(notes[0]).toHaveTextContent('Prefers a private room.');
    expect(notes[1]).toHaveTextContent('Phone call with Jordan Prospect (Daughter) · Daughter wants a tour next week.');
    expect(notes[1]).toHaveTextContent('New since Monday');
    expect(screen.getByText(/Robin Recruiter · 1 contact · 1 tour · 0 outreach activities/)).toBeInTheDocument();
    expect(screen.getByText(/Test Resident C · Discharged/)).toBeInTheDocument();
    expect(screen.getByText(/Test Resident B · Bed Hold — Rehab/)).toBeInTheDocument();
    expect(mocks.request).toHaveBeenCalledWith('report', { meeting_day: 'thursday', facility_id: 'a', week_start: '2026-09-21' });
  });

  it('offers the printable report', async () => {
    await openThursday();
    expect(screen.getByRole('link', { name: 'Print the report' })).toHaveAttribute('href', '/print/stand-up/thursday?facility=a&week=2026-09-21');
  });

  it('shows a recruiter counts, not resident names, and the figures read-only', async () => {
    mocks.auth.appRole = 'recruiter';
    const hidden = { ...facilityReport, names_shown: false, admission_notes_shown: false,
      departures: [{ ...facilityReport.departures[0], resident: null }], hospital: { ...facilityReport.hospital, out_now: [{ ...facilityReport.hospital.out_now[0], resident: null }] } };
    mocks.request.mockImplementation(async (action: string, payload: Record<string, unknown>) => {
      if (payload.meeting_day !== 'thursday') throw new StandUpRequestError('Stand Up access denied', 403);
      if (action === 'report') return { ...thursdayReport, actor_role: 'recruiter', facilities: [hidden] };
      return thursday({ can_edit: false, can_edit_submitted: false, actor_role: 'recruiter' });
    });
    render(<StandUpWorkspace />);
    await screen.findByRole('article', { name: 'Avery Prospect' });
    expect(screen.getByText(/Names are shown to administrators; you see how many\./)).toBeInTheDocument();
    expect(screen.getByText(/A resident · Discharged/)).toBeInTheDocument();
    expect(screen.queryByText(/Test Resident/)).not.toBeInTheDocument();
    expect(screen.getByText('Admission notes are shown to administrators.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});

// COL-749 ruling 3: the census bridge heads the building's Thursday section.
const bridge = (patch: Record<string, unknown> = {}) => ({
  state: 'matches', monday_census: 34, monday_at: '2026-09-21T12:40:00Z', arrivals: 3, departures: 1, hospital_out: 1, returns: 0,
  hospital_in_census: true, expected: 36, actual: 36, gap: 0, tolerance: 0, through: '2026-09-24T12:31:00Z', ...patch,
});

describe('The Thursday census bridge (COL-749)', () => {
  it('heads the entry form with the bridge: Monday, the movements, expected beside actual, green with a check', async () => {
    mocks.request.mockImplementation(async (action: string, payload: Record<string, unknown>) => {
      if (action === 'workspace') return payload.meeting_day === 'thursday' ? thursday() : monday;
      if (action === 'report') return { ...thursdayReport, facilities: [{ ...facilityReport, bridge: bridge() }] };
      throw new Error('Unexpected operation');
    });
    await openThursday();
    const section = await screen.findByRole('region', { name: 'Census bridge from Monday' });
    expect(section).toHaveAttribute('data-bridge-state', 'matches');
    expect(section.className).toMatch(/border-success/);
    expect(within(section).getByRole('status')).toHaveTextContent(
      'Census bridge matches: Monday 34, plus 3 arrivals, minus 1 departure, expected 36. Thursday 36, exactly as expected. Hospital or rehab: 1 hospital or rehab out and 0 returns, still counted in census.');
    expect(section).toHaveTextContent('Matches');
    // It sits above the figures table.
    const table = screen.getByRole('table', { name: /Thursday figures beside Monday/ });
    expect(section.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(section).queryByRole('button', { name: 'Reconcile the census' })).not.toBeInTheDocument();
  });

  it('shows a gap in red with its number and opens the same Reconcile dialog, fix first', async () => {
    mocks.request.mockImplementation(async (action: string, payload: Record<string, unknown>) => {
      if (action === 'workspace') return payload.meeting_day === 'thursday' ? thursday() : monday;
      if (action === 'report') return { ...thursdayReport, facilities: [{ ...facilityReport, bridge: bridge({ state: 'differs', actual: 37, gap: 1 }) }] };
      throw new Error('Unexpected operation');
    });
    mocks.disagreements = [{ facility_id: 'a', facility_name: 'Homewood', meeting_day: 'thursday', week_start: '2026-09-21', entry_due_at: meetingWindow.entry_due_at, call_at: meetingWindow.call_at,
      state: 'open', unreconciled: false, roster_as_of: null, reason_window_days: 7, compares_with_monday: true, reason_options: [{ key: 'other', label: 'Other' }],
      figures: [{ key: 'current_total_census', against: 'monday', label: 'Census against Monday', stand_up: 37, roster: 36, monday: 34, roster_change_since_monday: 2, state: 'open',
        bridge: { monday: 34, expected: 36, arrivals: 3, departures: 1, hospital_out: 1, returns: 0, hospital_in_census: true, tolerance: 0 },
        reason: null, reason_at: null, reason_until: null, roster_changed_since_reason: false }] }];
    await openThursday();
    const section = await screen.findByRole('region', { name: 'Census bridge from Monday' });
    expect(section.className).toMatch(/border-destructive/);
    expect(section).toHaveTextContent('Off by 1');
    expect(within(section).getByRole('status')).toHaveTextContent('Census bridge is off by 1: Monday 34, plus 3 arrivals, minus 1 departure, expected 36. Thursday 37, 1 resident more than expected.');
    fireEvent.click(within(section).getByRole('button', { name: 'Reconcile the census' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reconcile census · Homewood' });
    expect([...dialog.querySelectorAll('[data-reconcile-step]')].map(node => node.getAttribute('data-reconcile-step'))).toEqual(['fix', 'use-roster', 'reason']);
    expect(within(dialog).getByRole('button', { name: 'Use the expected census from Monday: 36' })).toBeInTheDocument();
  });

  it('shows a recruiter the bridge and the admission steps, and says the admission’s own notes are for administrators', async () => {
    mocks.auth.appRole = 'recruiter';
    const lead = facilityReport.potential_residents[0];
    const recruiterView = { ...facilityReport, names_shown: false, admission_notes_shown: false, admission_workflow_shown: true, bridge: bridge(),
      potential_residents: [{ ...lead, timeline: [...lead.timeline,
        { at: '2026-09-23T14:00:00Z', recorded_at: '2026-09-23T14:00:00Z', new: true, kind: 'admission_step', by: 'Charlene', method: 'admission_status_changed', with: 'pending_clearance', text: null, status: 'bed_reserved' },
        { at: '2026-09-23T15:00:00Z', recorded_at: '2026-09-23T15:00:00Z', new: true, kind: 'admission_step', by: null, method: 'admission_move_in_blocked', with: null, text: 'quoted rate terms, Form 1823', status: null },
        { at: '2026-09-23T16:00:00Z', recorded_at: '2026-09-23T16:00:00Z', new: true, kind: 'rate_note', by: null, method: null, with: null, text: 'Family asked about a second-floor room.', status: 'private' },
        { at: '2026-09-23T17:00:00Z', recorded_at: '2026-09-23T17:00:00Z', new: true, kind: 'checklist_note', by: null, method: 'waived', with: null, text: 'Waived: Private pay; no card.', status: 'insurance_financial_cards' },
      ] }] };
    mocks.request.mockImplementation(async (action: string, payload: Record<string, unknown>) => {
      if (payload.meeting_day !== 'thursday') throw new StandUpRequestError('Stand Up access denied', 403);
      if (action === 'report') return { ...thursdayReport, actor_role: 'recruiter', facilities: [recruiterView] };
      return thursday({ can_edit: false, can_edit_submitted: false, actor_role: 'recruiter' });
    });
    render(<StandUpWorkspace />);
    const article = await screen.findByRole('article', { name: 'Avery Prospect' });
    expect(screen.getByRole('region', { name: 'Census bridge from Monday' })).toBeInTheDocument();
    expect(article).toHaveTextContent('Admission moved from pending clearance to bed reserved');
    expect(article).toHaveTextContent('Move-in blocked: quoted rate terms, Form 1823');
    expect(article).toHaveTextContent('Quoted private room · Family asked about a second-floor room.');
    expect(article).toHaveTextContent('Insurance financial cards, waived · Waived: Private pay; no card.');
    expect(screen.getByText(/The admission’s own notes and anything clinical are shown to administrators\./)).toBeInTheDocument();
  });
});
