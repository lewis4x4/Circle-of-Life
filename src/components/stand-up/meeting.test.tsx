import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StandUpWorkspace } from './workspace';
import { useFacilityStore } from '@/hooks/useFacilityStore';
import type { MeetingReport, MeetingWorkspace } from '@/lib/stand-up/meetings';
import { StandUpRequestError } from './transport';

const mocks = vi.hoisted(() => ({ request: vi.fn(), auth: { loading: false, user: { id: 'u' } as { id: string } | null, organizationId: 'org', appRole: 'facility_admin' } }));
vi.mock('@/contexts/haven-auth-context', () => ({ useHavenAuth: () => mocks.auth }));
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

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => {
  mocks.auth.appRole = 'facility_admin';
  mocks.request.mockReset();
  mocks.request.mockImplementation(async (action: string, payload: Record<string, unknown>) => {
    if (action === 'workspace') return payload.meeting_day === 'thursday' ? thursday() : monday;
    throw new Error('Unexpected operation');
  });
  useFacilityStore.setState({ selectedFacilityId: null, availableFacilities: [], facilitiesCacheUserId: 'u' });
  Object.defineProperty(window, 'navigation', { configurable: true, value: new EventTarget() });
});

async function openThursday() {
  render(<StandUpWorkspace />);
  fireEvent.change(await screen.findByLabelText('Meeting'), { target: { value: 'thursday' } });
  await screen.findByRole('heading', { name: 'Thursday Stand Up' });
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
    const [action, payload] = mocks.request.mock.calls.at(-1)!;
    expect(action).toBe('save');
    expect(payload).toMatchObject({ meeting_day: 'thursday', facility_id: 'a', week_start: '2026-09-21', expected_version: 0, status: 'ready',
      values: { current_ar_cents: 11710800, current_total_census: 36, departures_since_monday: 2, hospital_and_rehab_total: 3, hospital_total: 1, rehab_total: 2 } });
    expect(typeof payload.request_id).toBe('string');
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
    expect(screen.getByText('You can read these figures. The facility administrator enters them.')).toBeInTheDocument();
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
