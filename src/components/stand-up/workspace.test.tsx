import { act, fireEvent, render, screen, waitFor, cleanup, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StandUpWorkspace } from './workspace';
import { emptyValues, type StandUpReport } from '@/lib/stand-up/model';
import { useFacilityStore } from '@/hooks/useFacilityStore';
import { allowRouteLeave } from '@/components/layout/navigation-pending';
import { StandUpRequestError } from './transport';
const mocks = vi.hoisted(() => ({ request: vi.fn(), outOfHouse: vi.fn(), auth: { loading: false, user: { id: 'u' } as { id: string } | null, organizationId: 'org', appRole: 'org_admin' } }));
vi.mock('@/contexts/haven-auth-context', () => ({ useHavenAuth: () => mocks.auth }));
// Census chips and notices read through the browser client; nothing is open in these fixtures.
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc: async () => ({ data: [], error: null }) }) }));
vi.mock('./transport', async importOriginal => ({ ...(await importOriginal<typeof import('./transport')>()), standUpRequest: mocks.request }));
vi.mock('@/lib/residents/out-of-house', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/residents/out-of-house')>()), fetchOutOfHouse: mocks.outOfHouse }));
const workspace = { facilities: [{ id: 'a', name: 'Homewood' }, { id: 'b', name: 'Oakridge' }], reports: [] as StandUpReport[], current_week: '2026-09-14', can_import: false, server_now: '2026-09-14T12:30:00Z' };
const report = (patch: Partial<StandUpReport> = {}): StandUpReport => ({ id: 'r', facility_id: 'a', week_start: '2026-09-14', version: 1, revision_id: 'rev1', values: emptyValues(), status: 'draft', updated_at: '2026-09-14T12:31:00Z', ...patch });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (value: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function start() { const view = render(<StandUpWorkspace />); await screen.findByRole('heading', { name: 'All facilities' }); return view; }
async function choose(id = 'a') { fireEvent.change(screen.getByLabelText('Reporting facility'), { target: { value: id } }); await screen.findByLabelText('Current census'); }
function changeCensus(value: string) { fireEvent.change(screen.getByLabelText('Current census'), { target: { value } }); }
function save() { fireEvent.click(screen.getByRole('button', { name: /^(Save draft|Retry save)$/ })); }
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
beforeEach(() => {
  mocks.auth.user = { id: 'u' }; mocks.auth.loading = false; mocks.auth.appRole = 'org_admin';
  mocks.request.mockReset(); mocks.request.mockImplementation(async action => { if (action === 'workspace') return workspace; throw new Error('Unexpected operation'); });
  mocks.outOfHouse.mockReset(); mocks.outOfHouse.mockResolvedValue([]);
  useFacilityStore.setState({ selectedFacilityId: null, availableFacilities: workspace.facilities, facilitiesCacheUserId: 'u' });
  Object.defineProperty(window, 'navigation', { configurable: true, value: new EventTarget() });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});
describe('Stand Up facility identity', () => {
  it('opens a management overview without silently selecting the first ALF', async () => {
    await start(); expect(screen.queryByLabelText('Current census')).not.toBeInTheDocument();
    expect(screen.getByText('0 of 2 submitted · Monday target: 8:45 a.m.')).toBeInTheDocument();
    await choose('b'); expect(screen.getByRole('heading', { name: 'Oakridge' })).toBeInTheDocument();
    expect(useFacilityStore.getState().selectedFacilityId).toBe('b');
  });
  it('fixes a single authorized ALF and blocks entry when no facilities are assigned', async () => {
    mocks.request.mockResolvedValueOnce({ ...workspace, facilities: [workspace.facilities[1]] });
    const view = render(<StandUpWorkspace />); await screen.findByLabelText('Current census');
    expect(screen.queryByLabelText('Reporting facility')).not.toBeInTheDocument();
    expect(useFacilityStore.getState().selectedFacilityId).toBe('b'); view.unmount();
    mocks.request.mockResolvedValueOnce({ ...workspace, facilities: [] }); render(<StandUpWorkspace />);
    await screen.findByText('No facility assignment'); expect(screen.queryByLabelText('Current census')).not.toBeInTheDocument();
  });
  it('rejects another actor cached facility, but honors a validated explicit selection from the open period', async () => {
    useFacilityStore.setState({ selectedFacilityId: 'b', facilitiesCacheUserId: 'different', selectedReportingPeriod: '2026-09-14' });
    const view = await start(); expect(useFacilityStore.getState().selectedFacilityId).toBeNull(); view.unmount();
    useFacilityStore.setState({ selectedFacilityId: 'b', facilitiesCacheUserId: 'u', selectedReportingPeriod: '2026-09-14' }); render(<StandUpWorkspace />);
    await screen.findByLabelText('Current census'); expect(screen.getByRole('heading', { name: 'Oakridge' })).toBeInTheDocument();
  });
  it('lands a multi-grant account on All facilities when the reporting period has changed since the choice', async () => {
    useFacilityStore.setState({ selectedFacilityId: 'b', facilitiesCacheUserId: 'u', selectedReportingPeriod: '2026-09-07' });
    const view = await start(); expect(screen.queryByLabelText('Current census')).not.toBeInTheDocument();
    expect(useFacilityStore.getState().selectedFacilityId).toBeNull(); expect(screen.getByLabelText('Reporting facility')).toHaveValue(''); view.unmount();
    useFacilityStore.setState({ selectedFacilityId: 'b', facilitiesCacheUserId: 'u', selectedReportingPeriod: null }); render(<StandUpWorkspace />);
    await screen.findByRole('heading', { name: 'All facilities' }); expect(useFacilityStore.getState().selectedFacilityId).toBeNull();
  });
  it('stamps the open period when an ALF is chosen so the same period keeps the choice', async () => {
    await start(); await choose('b');
    expect(useFacilityStore.getState()).toMatchObject({ selectedFacilityId: 'b', selectedReportingPeriod: '2026-09-14' });
  });
  it('keeps a single-grant account on its facility whatever period was stored', async () => {
    useFacilityStore.setState({ selectedFacilityId: 'b', facilitiesCacheUserId: 'u', selectedReportingPeriod: '2026-08-31' });
    mocks.request.mockResolvedValueOnce({ ...workspace, facilities: [workspace.facilities[1]] });
    render(<StandUpWorkspace />); await screen.findByLabelText('Current census');
    expect(screen.getByRole('heading', { name: 'Oakridge' })).toBeInTheDocument(); expect(useFacilityStore.getState().selectedFacilityId).toBe('b');
  });
  it('rejects a save for an ALF outside the grant and removes the editable surface', async () => {
    await start(); await choose(); changeCensus('9');
    mocks.request.mockRejectedValueOnce(new StandUpRequestError('Stand Up access denied', 403)); save();
    await screen.findByText(/Your access changed/); expect(screen.queryByLabelText('Current census')).not.toBeInTheDocument();
    expect(mocks.request.mock.calls.at(-1)?.[0]).toBe('save');
  });
  it('vetoes dirty shell and meeting changes before moving the context', async () => {
    await start(); await choose(); changeCensus('25');
    act(() => { expect(allowRouteLeave('/admin/executive')).toBe(false); });
    act(() => { expect(useFacilityStore.getState().setSelectedFacility('b')).toBe(false); });
    expect(screen.getByRole('alert')).toHaveTextContent('Save or discard Homewood'); expect(useFacilityStore.getState().selectedFacilityId).toBe('a');
    fireEvent.click(screen.getByRole('button', { name: 'Discard unsaved changes' })); await choose('b');
    expect(screen.getByLabelText('Current census')).toHaveValue(null);
  });
  it('clears the form on a forced security reset and ignores an old A–B–A response', async () => {
    await start(); await choose(); changeCensus('11'); const slow = deferred<StandUpReport>(); mocks.request.mockReturnValueOnce(slow.promise); save();
    act(() => useFacilityStore.getState().resetSelectedFacility()); expect(screen.queryByLabelText('Current census')).not.toBeInTheDocument();
    await choose('b'); await choose('a');
    await act(async () => slow.resolve(report({ values: { ...emptyValues(), current_total_census: 11 } })));
    expect(screen.getByLabelText('Current census')).toHaveValue(null); expect(screen.getByText('No saved report yet')).toBeInTheDocument();
  });
  it('does not expose a delayed response after logout', async () => {
    const slow = deferred<typeof workspace>(); mocks.request.mockReturnValueOnce(slow.promise); const view = render(<StandUpWorkspace />);
    mocks.auth.user = null; view.rerender(<StandUpWorkspace />); await act(async () => slow.resolve(workspace));
    expect(screen.getByRole('alert')).toHaveTextContent('Sign in'); expect(screen.queryByLabelText('Current census')).not.toBeInTheDocument();
  });
});
describe('Stand Up capture, autosave and review', () => {
  it('retains failed entries and retries the exact request while preserving zero/null and cents', async () => {
    await start(); await choose(); fireEvent.change(screen.getByLabelText('Monthly rent roll ($)'), { target: { value: '1234.56' } }); changeCensus('0');
    mocks.request.mockRejectedValueOnce(new Error('Request timed out; retry')); save(); await screen.findByText('Request timed out; retry');
    expect(screen.getByLabelText('Monthly rent roll ($)')).toHaveValue(1234.56);
    const first = mocks.request.mock.calls.at(-1)?.[1]; expect(first).toMatchObject({ facility_id: 'a', expected_version: 0, values: { ...emptyValues(), monthly_rent_roll_cents: 123456, current_total_census: 0 } });
    mocks.request.mockResolvedValueOnce(report({ values: first.values })); save(); await screen.findByText(/Saved Sep 14/);
    expect(mocks.request.mock.calls.at(-1)?.[1]).toEqual(first);
  });
  it('debounces online changes into one draft save and keeps later edits through its receipt', async () => {
    await start(); await choose(); vi.useFakeTimers();
    const slow = deferred<StandUpReport>(); mocks.request.mockReturnValueOnce(slow.promise);
    changeCensus('20'); await act(async () => { vi.advanceTimersByTime(600); }); changeCensus('21');
    await act(async () => { vi.advanceTimersByTime(1199); }); expect(mocks.request.mock.calls.filter(call => call[0] === 'save')).toHaveLength(0);
    await act(async () => { vi.advanceTimersByTime(1); }); expect(mocks.request.mock.calls.filter(call => call[0] === 'save')).toHaveLength(1);
    expect(mocks.request.mock.calls.at(-1)?.[1]).toMatchObject({ status: 'draft', values: { ...emptyValues(), current_total_census: 21 } });
    changeCensus('22'); await act(async () => slow.resolve(report({ values: { ...emptyValues(), current_total_census: 21 } })));
    expect(screen.getByLabelText('Current census')).toHaveValue(22); expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    mocks.request.mockResolvedValueOnce(report({ version: 2, revision_id: 'rev2', values: { ...emptyValues(), current_total_census: 22 } }));
    await act(async () => { vi.advanceTimersByTime(1200); });
    expect(mocks.request.mock.calls.at(-1)?.[1]).toMatchObject({ expected_version: 1, values: { ...emptyValues(), current_total_census: 22 } });
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
  });
  it('captures hours and minutes, rejects invalid minutes, and preserves a true zero duration', async () => {
    await start(); await choose(); fireEvent.change(screen.getByLabelText('Overtime hours'), { target: { value: '17' } }); fireEvent.change(screen.getByLabelText('Overtime minutes'), { target: { value: '60' } }); save();
    await screen.findByRole('alert'); expect(mocks.request.mock.calls.some(call => call[0] === 'save')).toBe(false);
    fireEvent.change(screen.getByLabelText('Overtime minutes'), { target: { value: '15' } }); mocks.request.mockResolvedValueOnce(report({ values: { ...emptyValues(), overtime_reported: 17.15 } })); save(); await screen.findByText(/Saved Sep 14/);
    expect(mocks.request.mock.calls.at(-1)?.[1].values.overtime_reported).toBe(17.15);
    fireEvent.change(screen.getByLabelText('Overtime hours'), { target: { value: '0' } }); fireEvent.change(screen.getByLabelText('Overtime minutes'), { target: { value: '0' } });
    mocks.request.mockResolvedValueOnce(report({ version: 2, values: { ...emptyValues(), overtime_reported: 0 } })); save(); await waitFor(() => expect(mocks.request.mock.calls.at(-1)?.[1].values.overtime_reported).toBe(0));
  });
  it('labels imported complete data as unreviewed and requires explicit named submission', async () => {
    const values = Object.fromEntries(Object.keys(emptyValues()).map(key => [key, 0])) as StandUpReport['values']; values.overtime_reported = 17.15;
    mocks.request.mockResolvedValueOnce({ ...workspace, reports: [report({ values, entry_origin: 'imported' })] });
    await start(); await choose(); expect(screen.getByText('Imported, awaiting review')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review and submit' }));
    expect(within(screen.getByLabelText('Review report')).getByText('17h 15m')).toBeInTheDocument();
    expect(mocks.request.mock.calls.some(call => call[0] === 'save')).toBe(false);
    mocks.request.mockResolvedValueOnce(report({ values, status: 'ready', last_submitted_at: '2026-09-14T12:40:00Z' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Homewood for September 14, 2026' })); await screen.findByText('Submitted');
    expect(mocks.request.mock.calls.at(-1)?.[1]).toMatchObject({ facility_id: 'a', week_start: '2026-09-14', status: 'ready' });
  });
  it('shows the deadline after 8:45 without locking entry and blocks Sunday submission', async () => {
    mocks.request.mockResolvedValueOnce({ ...workspace, server_now: '2026-09-14T12:45:00Z', reports: [report({ entry_origin: 'manual' })] }); const view = await start(); await choose();
    expect(screen.getByText(/The 8:45 a.m. Haven submission target has passed/)).toBeInTheDocument(); expect(screen.getByLabelText('Current census')).toBeEnabled(); view.unmount();
    mocks.request.mockResolvedValueOnce({ ...workspace, server_now: '2026-09-13T12:00:00Z' }); useFacilityStore.setState({ selectedFacilityId: null }); await start(); await choose();
    fireEvent.click(screen.getByRole('button', { name: 'Review and submit' })); expect(screen.getByRole('button', { name: /Submit Homewood for/ })).toBeDisabled();
    expect(screen.getByText(/Sunday preparation stays a draft/)).toBeInTheDocument();
  });
  it('does not autosave offline and removes entry on a server revocation response', async () => {
    await start(); await choose(); act(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }); window.dispatchEvent(new Event('offline')); });
    changeCensus('12'); expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
    act(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, value: true }); window.dispatchEvent(new Event('online')); });
    mocks.request.mockRejectedValueOnce(new StandUpRequestError('No longer authorized', 403)); save();
    await screen.findByText(/Your access changed/); expect(screen.queryByLabelText('Current census')).not.toBeInTheDocument();
  });
  it('preserves a conflict from another tab and loads its newer saved version only on explicit discard', async () => {
    await start(); await choose(); changeCensus('21');
    mocks.request.mockRejectedValueOnce(new StandUpRequestError('Report version changed', 409));
    mocks.request.mockResolvedValueOnce({ ...workspace, reports: [report({ version: 3, values: { ...emptyValues(), current_total_census: 30 } })] }); save();
    await screen.findByText('This report changed elsewhere. Your entries are retained. Review the saved report before continuing.');
    expect(screen.getByLabelText('Current census')).toHaveValue(21);
    fireEvent.click(screen.getByRole('button', { name: 'Discard my edits and load saved figures' }));
    expect(screen.getByLabelText('Current census')).toHaveValue(30);
    changeCensus('31'); mocks.request.mockResolvedValueOnce(report({ version: 4, values: { ...emptyValues(), current_total_census: 31 } })); save();
    await waitFor(() => expect(mocks.request.mock.calls.at(-1)?.[1].expected_version).toBe(3));
  });
  it('keeps retrying the unknown payload before autosaving edits made after the timeout', async () => {
    await start(); await choose(); changeCensus('11'); mocks.request.mockRejectedValueOnce(new Error('Unknown save result')); save();
    await screen.findByText('Unknown save result'); const original = mocks.request.mock.calls.at(-1)?.[1];
    changeCensus('12'); expect(screen.getByRole('button', { name: 'Discard unsaved changes' })).toBeDisabled();
    mocks.request.mockResolvedValueOnce(report({ values: { ...emptyValues(), current_total_census: 11 } })); save();
    await screen.findByText('Unsaved changes'); expect(mocks.request.mock.calls.at(-1)?.[1]).toEqual(original);
    expect(screen.getByLabelText('Current census')).toHaveValue(12);
  });
  it('ignores an old save failure and finally handler after a new facility save starts', async () => {
    await start(); await choose(); const first = deferred<StandUpReport>(); mocks.request.mockReturnValueOnce(first.promise); changeCensus('10'); save();
    act(() => useFacilityStore.getState().resetSelectedFacility()); await choose('b');
    const second = deferred<StandUpReport>(); mocks.request.mockReturnValueOnce(second.promise); changeCensus('20'); save();
    await act(async () => first.reject(new Error('Old Homewood failure')));
    expect(screen.queryByText('Old Homewood failure')).not.toBeInTheDocument(); expect(screen.getByText('Saving…')).toBeInTheDocument();
    await act(async () => second.resolve(report({ facility_id: 'b', values: { ...emptyValues(), current_total_census: 20 } })));
    expect(screen.getByLabelText('Current census')).toHaveValue(20); expect(screen.queryByText('Saving…')).not.toBeInTheDocument();
  });
  it('does not let a refresh started before a save replace its newer receipt', async () => {
    await start(); await choose(); const refresh = deferred<typeof workspace>(); mocks.request.mockReturnValueOnce(refresh.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh reports' })); changeCensus('40');
    mocks.request.mockResolvedValueOnce(report({ values: { ...emptyValues(), current_total_census: 40 } })); save(); await screen.findByText(/Saved Sep 14/);
    await act(async () => refresh.resolve(workspace));
    expect(screen.getByLabelText('Current census')).toHaveValue(40); await choose('b'); await choose('a');
    expect(screen.getByLabelText('Current census')).toHaveValue(40);
  });
  it('retains unsaved entries when refreshing the workspace fails without an authorization failure', async () => {
    await start(); await choose(); mocks.request.mockRejectedValueOnce(new Error('Connection unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh reports' })); await screen.findByText('Connection unavailable Your current entries are retained.');
    expect(screen.getByLabelText('Current census')).toBeInTheDocument();
  });
  it('retains an uncertain submission receipt for an unchanged saved report across every scope and refresh guard', async () => {
    const values = Object.fromEntries(Object.keys(emptyValues()).map(key => [key, 0])) as StandUpReport['values'];
    mocks.request.mockResolvedValueOnce({ ...workspace, reports: [report({ values }), report({ id: 'old', week_start: '2026-09-07', values })] });
    await start(); await choose(); fireEvent.click(screen.getByRole('button', { name: 'Review and submit' }));
    mocks.request.mockRejectedValueOnce(new Error('Unknown submission result'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Homewood for September 14, 2026' })); await screen.findByText('Unknown submission result');
    const original = mocks.request.mock.calls.at(-1)?.[1]; expect(original.status).toBe('ready');
    act(() => { expect(allowRouteLeave('/admin/executive')).toBe(false); });
    act(() => { expect(useFacilityStore.getState().setSelectedFacility('b')).toBe(false); });
    fireEvent.change(screen.getByLabelText('Meeting date'), { target: { value: '2026-09-07' } }); expect(screen.getByLabelText('Meeting date')).toHaveValue('2026-09-14');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh reports' })); expect(mocks.request.mock.calls.at(-1)?.[1]).toEqual(original);
    expect(screen.getByRole('button', { name: 'Spreadsheet recovery and backup' })).toBeDisabled();
    const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
    mocks.request.mockResolvedValueOnce(report({ values, version: 2, status: 'ready', last_submitted_at: '2026-09-14T12:40:00Z' })); save(); await screen.findByText('Submitted');
    expect(mocks.request.mock.calls.at(-1)?.[1]).toEqual(original); expect(screen.getByRole('button', { name: 'Spreadsheet recovery and backup' })).toBeEnabled();
  });
  it('shows the raw invalid duration and refuses unrelated autosave until explicitly corrected', async () => {
    mocks.request.mockResolvedValueOnce({ ...workspace, reports: [report({ values: { ...emptyValues(), overtime_reported: 15.65 } })] });
    await start(); await choose(); expect(screen.getByRole('alert')).toHaveTextContent(/saved overtime notation 15.65 needs review/);
    changeCensus('20'); save(); await screen.findByText('Correct the saved overtime with explicit hours and minutes before saving.');
    expect(mocks.request.mock.calls.some(call => call[0] === 'save')).toBe(false);
  });
  it('attaches the overtime review error to both inputs and says plainly that saving is blocked', async () => {
    mocks.request.mockResolvedValueOnce({ ...workspace, reports: [report({ values: { ...emptyValues(), overtime_reported: 15.65 } })] });
    await start(); await choose();
    for (const name of ['Overtime hours', 'Overtime minutes']) {
      const input = screen.getByLabelText(name);
      expect(input).toHaveAttribute('aria-invalid', 'true'); expect(input).toHaveAttribute('aria-describedby', 'overtime-review');
    }
    const message = document.getElementById('overtime-review'); expect(message).not.toBeNull();
    expect(message).toHaveTextContent('The saved overtime notation 15.65 needs review. Enter hours and minutes. Until then this report cannot be saved, including autosave of other figures, or submitted.');
    fireEvent.change(screen.getByLabelText('Overtime hours'), { target: { value: '16' } }); fireEvent.change(screen.getByLabelText('Overtime minutes'), { target: { value: '5' } });
    mocks.request.mockResolvedValueOnce(report({ version: 2, values: { ...emptyValues(), overtime_reported: 16.05 } })); save(); await screen.findByText(/Saved Sep 14/);
    expect(screen.getByLabelText('Overtime hours')).not.toHaveAttribute('aria-invalid');
  });
  it('counts a held raw notation as not provided in the overview, the sticky bar and the review', async () => {
    const values = Object.fromEntries(Object.keys(emptyValues()).map(key => [key, 1])) as StandUpReport['values']; values.overtime_reported = 15.65;
    mocks.request.mockResolvedValueOnce({ ...workspace, reports: [report({ values })] });
    await start();
    const row = screen.getByRole('row', { name: /Homewood/ }); expect(row).toHaveTextContent('15/16 provided'); expect(row).toHaveTextContent('Needs duration review'); expect(row).toHaveTextContent('Draft');
    await choose(); expect(screen.getByText('15/16 provided · not yet reviewed')).toBeInTheDocument();
    expect(screen.getByText('Total open beds: 4')).toBeInTheDocument();
    expect(screen.getByText('Monthly rent roll per census resident: $0.01')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Overtime hours'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review and submit' }));
    expect(screen.getByText('Still needed: Overtime last week.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Submit Homewood for/ })).toBeDisabled();
  });
  it('names why a reference figure is absent instead of calling a held import not provided', async () => {
    const prior = report({ id: 'prior', week_start: '2026-09-07', values: { ...emptyValues(), current_total_census: 34, monthly_rent_roll_cents: 9645385 }, entry_origin: 'imported', field_dispositions: { overtime_reported: 'historical_unit_unconfirmed' } });
    mocks.request.mockResolvedValueOnce({ ...workspace, reports: [prior] });
    await start(); await choose();
    expect(screen.getByText('Previous report: Held: unit unconfirmed')).toBeInTheDocument();
    expect(screen.getByText('Previous report: $96,453.85')).toBeInTheDocument();
    expect(screen.getAllByText('Previous report: Not provided').length).toBeGreaterThan(0);
    // A forecast field cites last week's forecast, never an actual result.
    expect(screen.getAllByText('Previous forecast: Not provided').length).toBe(5);
    expect(screen.getByText(/Previous figures come from the report for September 7, 2026, and are not copied into this one\./)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Reporting facility'), { target: { value: '' } }); await screen.findByRole('heading', { name: 'All facilities' });
    fireEvent.change(screen.getByLabelText('Meeting date'), { target: { value: '2026-09-07' } });
    const row = screen.getByRole('row', { name: /Homewood/ }); expect(row).toHaveTextContent('Held: unit unconfirmed'); expect(row).toHaveTextContent('Imported, awaiting review');
    expect(screen.getByRole('row', { name: /Oakridge/ })).toHaveTextContent('No report');
  });
  it('links the shared workbook from recovery with the internet-outage line and labels the management inputs', async () => {
    mocks.auth.appRole = 'owner';
    mocks.request.mockResolvedValueOnce({ ...workspace, can_import: true, reports: [report()] });
    await start(); await choose();
    fireEvent.click(screen.getByRole('button', { name: 'Spreadsheet recovery and backup' }));
    const link = screen.getByRole('link', { name: 'Open the shared Stand Up workbook' });
    expect(link).toHaveAttribute('href', 'https://docs.google.com/spreadsheets/d/1rUozaY9YLhD77lS_jjdRbUW2LsdvgS1r/edit');
    expect(screen.getByText(/No internet: use the JSON or CSV backup you downloaded last week\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download JSON backup' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Management tools' }));
    expect(screen.getByLabelText('Import batch ID')).toHaveAttribute('id', 'import-batch-id');
    expect(screen.getByLabelText('Reason for reversal')).toHaveAttribute('id', 'import-reversal-reason');
    expect(screen.getByLabelText('Prepared historical import file')).toBeInTheDocument();
  });
  it('reloads a legacy SPA entry before enabling edits, but permits a verified document entry', async () => {
    Object.defineProperty(window, 'navigation', { configurable: true, value: undefined });
    const href = window.location.href; window.history.replaceState(null, '', '/admin/stand-up');
    const timing = vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ name: new URL('/admin/executive', window.location.origin).href } as PerformanceEntry]);
    const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {});
    const view = await start(); await choose(); expect(replace).toHaveBeenCalledWith(window.location.href); expect(screen.getByLabelText('Current census')).toBeDisabled();
    view.unmount(); useFacilityStore.setState({ selectedFacilityId: null }); timing.mockReturnValue([{ name: window.location.href } as PerformanceEntry]);
    await start(); await choose(); expect(screen.getByLabelText('Current census')).toBeEnabled();
    window.history.replaceState(null, '', href);
  });
  it('never infers lateness for imported current reports or historical manual records', async () => {
    mocks.request.mockResolvedValueOnce({ ...workspace, server_now: '2026-09-14T13:00:00Z', facilities: [workspace.facilities[0]], reports: [report({ values: { ...emptyValues(), current_total_census: 40 }, entry_origin: 'imported' }), report({ id: 'old', week_start: '2026-09-07', entry_origin: 'manual' })] });
    render(<StandUpWorkspace />); await screen.findByLabelText('Current census');
    expect(screen.getByText('Original submission time unavailable.')).toBeInTheDocument(); expect(screen.queryByText(/target has passed/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Meeting date'), { target: { value: '2026-09-07' } });
    expect(screen.queryByText(/target has passed|Past target/)).not.toBeInTheDocument();
  });
  it('keeps historical figures readable but read-only until a reasoned correction is opened', async () => {
    mocks.auth.appRole = 'owner';
    mocks.request.mockResolvedValueOnce({ ...workspace, can_import: true, reports: [report({ id: 'old', week_start: '2026-09-07', values: { ...emptyValues(), current_total_census: 41 } })] });
    await start(); await choose();
    fireEvent.change(screen.getByLabelText('Meeting date'), { target: { value: '2026-09-07' } });
    const census = screen.getByLabelText('Current census');
    expect(census).toHaveValue(41); expect(census).toHaveAttribute('readonly'); expect(census).toBeEnabled();
    expect(screen.getByLabelText('Overtime hours')).toHaveAttribute('readonly');
    expect(screen.getByText(/Figures are read-only/)).toBeInTheDocument();
    fireEvent.change(census, { target: { value: '42' } }); expect(screen.getByLabelText('Current census')).toHaveValue(41);
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Review and submit' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Make a correction with a recorded reason'));
    expect(screen.getByLabelText('Current census')).not.toHaveAttribute('readonly');
    fireEvent.change(screen.getByLabelText('Current census'), { target: { value: '42' } }); expect(screen.getByLabelText('Current census')).toHaveValue(42);
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument(); expect(screen.getByLabelText('Correction reason')).toBeInTheDocument();
  });
  it('keeps technical imports out of facility-admin entry', async () => {
    await start(); await choose(); expect(screen.queryByRole('button', { name: 'Management tools' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Import JSON')).not.toBeInTheDocument(); expect(screen.queryByText(/Currency.*cents/)).not.toBeInTheDocument();
  });
});
describe('Stand Up report meaning', () => {
  const full = (patch: Partial<StandUpReport['values']> = {}) => ({ ...Object.fromEntries(Object.keys(emptyValues()).map(key => [key, 1])), overtime_reported: 17.15, ...patch } as StandUpReport['values']);
  it('states provenance and the required action at the top, keeping save, submission and status apart', async () => {
    mocks.request.mockResolvedValueOnce({ ...workspace, reports: [report({ values: full(), updated_by: 'connector', updated_by_name: 'Hosted Stand Up Connector', source_as_of: '2026-09-14T12:31:00Z' })] });
    await start(); await choose();
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('· Administrator review required')).toBeInTheDocument();
    expect(screen.getByText('Last saved by Hosted Stand Up Connector on September 14 at 8:31 a.m. Eastern.')).toBeInTheDocument();
    expect(screen.getByText('Original submission time unavailable.')).toBeInTheDocument();
    // A connector's name is not a claim about which document the figures came from.
    expect(screen.queryByText(/imported from the workbook/i)).not.toBeInTheDocument();
  });
  it('gives each section its period and keeps the current away count out of the forecast fields', async () => {
    mocks.request.mockResolvedValueOnce({ ...workspace, reports: [report({ values: full(), source_as_of: '2026-09-14T12:31:00Z' })] });
    await start(); await choose();
    expect(screen.getAllByText('Monday morning · Figures recorded September 14 at 8:31 a.m. Eastern')).toHaveLength(2);
    expect(screen.getByText('Completed week · September 7–13, 2026')).toBeInTheDocument();
    expect(screen.getAllByText('Forecast week · September 14–20, 2026')).toHaveLength(2);
    const census = document.getElementById('stand-up-section-census')!;
    const admissions = document.getElementById('stand-up-section-admissions')!;
    expect(within(census as HTMLElement).getByLabelText('Residents at hospital or rehab')).toBeInTheDocument();
    expect(within(admissions as HTMLElement).queryByLabelText('Residents at hospital or rehab')).not.toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Report sections' })).getByRole('link', { name: 'Beds' })).toHaveAttribute('href', '#stand-up-section-beds');
  });
  it('names the derived ratio for what it is and keeps its calculation out of the action bar', async () => {
    mocks.request.mockResolvedValueOnce({ ...workspace, reports: [report({ values: { ...full(), monthly_rent_roll_cents: 9645385, current_total_census: 34 } })] });
    await start(); await choose();
    // "Average rent" read as an average of what residents are charged. It is a ratio.
    expect(screen.getByText('Monthly rent roll per census resident: $2,836.88')).toBeInTheDocument();
    expect(screen.queryByText(/^Average rent/)).not.toBeInTheDocument();
    expect(screen.getByText(/Monthly rent roll ÷ current census\. Census counts beds held/)).toBeInTheDocument();
    expect(screen.getByText('Total open beds: 4')).toBeInTheDocument();
    const bar = screen.getByLabelText('Save and submit report');
    // Provided counts populated figures; the bar that stays on screen never implies approval.
    expect(within(bar).getByText('16/16 provided · not yet reviewed')).toBeInTheDocument();
    expect(within(bar).queryByText(/per census resident|Open beds/)).not.toBeInTheDocument();
  });
  it('tells an open unsaved report when its snapshot time will be recorded, and a past report that none was', async () => {
    mocks.request.mockResolvedValueOnce({ ...workspace, reports: [report({ id: 'old', week_start: '2026-09-07', values: full(), source_as_of: null })] });
    await start(); await choose();
    expect(screen.getAllByText('Monday morning · Figures recorded when you save')).toHaveLength(2);
    expect(screen.getByText('Not started')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Meeting date'), { target: { value: '2026-09-07' } });
    expect(screen.getAllByText('Monday morning · No recorded time')).toHaveLength(2);
    expect(screen.getAllByText('Forecast week · September 7–13, 2026')).toHaveLength(2);
    expect(screen.queryByText(/this week ·/)).not.toBeInTheDocument();
  });
  it('names each save state and points both actions at it', async () => {
    await start(); await choose();
    const describedBy = screen.getByRole('button', { name: 'Review and submit' }).getAttribute('aria-describedby');
    expect(describedBy).toBe('stand-up-save-state');
    expect(document.getElementById(describedBy!)).toHaveTextContent('No saved report yet');
    expect(screen.getByText('Not started')).toBeInTheDocument();
    changeCensus('20'); expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    // Live entries make the report a draft immediately, before any save receipt.
    expect(screen.getByText('Draft')).toBeInTheDocument(); expect(screen.queryByText('Not started')).not.toBeInTheDocument();
    const slow = deferred<StandUpReport>(); mocks.request.mockReturnValueOnce(slow.promise); save();
    expect(screen.getByText('Saving…')).toBeInTheDocument();
    await act(async () => slow.resolve(report({ values: { ...emptyValues(), current_total_census: 20 } })));
    expect(screen.getByText(/Saved Sep 14, 8:31 AM Eastern · no unsaved changes/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
    changeCensus('21'); mocks.request.mockRejectedValueOnce(new Error('Save failed')); save();
    await screen.findByText('Not saved — retry required');
  });
  it('reviews by period and names what differs from the previous report', async () => {
    const prior = report({ id: 'prior', week_start: '2026-09-07', values: full({ current_total_census: 34, admissions_expected: 2 }) });
    mocks.request.mockResolvedValueOnce({ ...workspace, reports: [prior, report({ values: full({ current_total_census: 36, admissions_expected: 0 }), source_as_of: '2026-09-14T12:31:00Z' })] });
    await start(); await choose();
    expect(screen.getByText('Previous forecast: 2')).toBeInTheDocument();
    expect(screen.getByText('Previous report: 34')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review and submit' }));
    const panel = within(screen.getByLabelText('Review report'));
    expect(panel.getByText('Completed week · September 7–13, 2026')).toBeInTheDocument();
    expect(panel.getByText('Different from the previous report · September 7, 2026')).toBeInTheDocument();
    expect(panel.getByText('Current census: 34 to 36')).toBeInTheDocument();
    expect(panel.getByText('Expected admissions this week: 2 to 0')).toBeInTheDocument();
    // Last save and submission evidence are two facts on two lines, as at the top of the form.
    expect(panel.getByText('Last saved September 14 at 8:31 a.m. Eastern.')).toBeInTheDocument();
    expect(panel.getByText('Original submission time unavailable.')).toBeInTheDocument();
  });
  it('does not repeat the review qualifier when the state already says the import awaits review', async () => {
    mocks.request.mockResolvedValueOnce({ ...workspace, reports: [report({ values: full(), entry_origin: 'imported' })] });
    await start(); await choose();
    expect(screen.getByText('Imported, awaiting review')).toBeInTheDocument();
    expect(screen.queryByText('· Administrator review required')).not.toBeInTheDocument();
  });
  it('keeps each field to a label, an input and a previous figure, with the meaning one disclosure away', async () => {
    mocks.request.mockResolvedValueOnce({ ...workspace, reports: [report({ id: 'prior', week_start: '2026-09-07', values: full() })] });
    await start(); await choose();
    const staffing = document.getElementById('stand-up-section-staffing') as HTMLElement;
    // Beside the input: the label, Haven's own figure (COL-753) and the previous figure, and nothing else.
    expect(within(staffing).getByLabelText('Callouts last week').closest('div')).toHaveTextContent(/^Callouts last weekHaven’s figures unavailable: Unexpected operationPrevious report: 1$/);
    // The definition is one disclosure away, not under the input.
    expect(within(staffing).getByText('What these figures count · 2 Haven cannot check')).toBeInTheDocument();
    expect(within(staffing).getByText(/^Scheduled shifts missed to a callout/).closest('details')).not.toBeNull();
    // A settled rule reads as an instruction; only what Haven cannot check is qualified.
    expect(within(staffing).getByText(/^Budgeted positions still unfilled Monday morning\./)).toHaveTextContent('Haven does not record how many positions each facility is budgeted for.');
    // A rule shared by the whole section is stated once, above the fields.
    expect(screen.getByText('Total open beds adds these four figures, so count each open bed in one category only.')).toBeInTheDocument();
    // Development notes and unfinished questions never reach ordinary field help.
    expect(screen.queryByText(/carried-over/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/pending|not settled/i)).not.toBeInTheDocument();
  });
  it('states once which figures Haven cannot check, naming each one, and qualifies nothing else', async () => {
    await start(); await choose();
    const notice = screen.getByText('Haven cannot check 2 of the sixteen figures');
    fireEvent.click(notice);
    const panel = notice.parentElement as HTMLElement;
    expect(within(panel).getByText(/no record of its own to check these against/)).toBeInTheDocument();
    expect(within(panel).getByText('Haven does not record how many positions each facility is budgeted for.')).toBeInTheDocument();
    expect(within(panel).getByText('Haven has no approved time source to check the hours against.')).toBeInTheDocument();
    // Everything the owner settled on COL-374 is an instruction now, not a qualification.
    for (const label of ['Current census', 'Callouts last week', 'Private beds open', 'Expected discharges this week']) {
      expect(within(panel).queryByText(label)).not.toBeInTheDocument();
    }
  });
  it('separates populated figures, administrator review, unverified figures and submission at review', async () => {
    mocks.request.mockResolvedValueOnce({ ...workspace, reports: [report({ values: full(), entry_origin: 'imported' })] });
    await start(); await choose();
    fireEvent.click(screen.getByRole('button', { name: 'Review and submit' }));
    const panel = within(screen.getByLabelText('Review report'));
    expect(panel.getByText('Figures provided').nextElementSibling).toHaveTextContent('All 16');
    expect(panel.getByText('Administrator review').nextElementSibling).toHaveTextContent('Not confirmed yet — submitting confirms yours');
    expect(panel.getByText('Unverified figures').nextElementSibling).toHaveTextContent('2 — Haven holds no record to check them against, so they rest on your count');
    expect(panel.getByText('Submission').nextElementSibling).toHaveTextContent('Original submission time unavailable.');
  });
});
/** COL-350: three states of one entry page, and who may move the window. */
describe('Stand Up entry window surfaces', () => {
  const widened = { ...workspace, facilities: [{ ...workspace.facilities[0], entry_open_lead_minutes: 3405, open_week: '2026-09-14' }, workspace.facilities[1]] };
  it('states the open, the target and the call on one line, in the chosen facility own window', async () => {
    await start();
    expect(screen.getByText('Opens Sunday 12:00 a.m. · Due Monday 8:45 a.m. · Call 9:15 a.m. Eastern')).toBeInTheDocument();
    // The 8:45 target and the 9:15 call are never presented as settings.
    expect(screen.queryByText('Monday operations · complete by 8:45 a.m. Eastern')).not.toBeInTheDocument();
    cleanup();
    mocks.request.mockResolvedValueOnce(widened);
    await start(); await choose();
    expect(screen.getByText('Opens Saturday 12:00 a.m. · Due Monday 8:45 a.m. · Call 9:15 a.m. Eastern')).toBeInTheDocument();
  });
  it('shows a meeting that has not opened as read-only with the minute it opens', async () => {
    await start(); await choose();
    fireEvent.change(screen.getByLabelText('Meeting date'), { target: { value: '2026-09-21' } });
    expect(screen.getByText('This report opens Sunday, September 20 at 12:00 a.m. Eastern.')).toBeInTheDocument();
    const census = screen.getByLabelText('Current census');
    expect(census).toHaveAttribute('readonly');
    // Read-only, not disabled: the figures and their meaning stay legible.
    expect(census).toBeEnabled();
    expect(screen.getByLabelText('Overtime hours')).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Review and submit' })).toBeDisabled();
    // Typing changes nothing and starts nothing.
    fireEvent.change(census, { target: { value: '30' } });
    expect(screen.getByLabelText('Current census')).toHaveValue(null);
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    expect(mocks.request.mock.calls.some(call => call[0] === 'save')).toBe(false);
    // The meeting ahead is offered by name, not as a mystery option.
    expect(screen.getByLabelText('Meeting date')).toHaveTextContent('September 21, 2026 · opens Sunday, September 20 at 12:00 a.m. Eastern');
  });
  it('names the payroll week still running on a Sunday, and drops the line once it has closed', async () => {
    mocks.request.mockResolvedValueOnce({ ...workspace, server_now: '2026-09-13T12:00:00Z' });
    await start(); await choose();
    expect(screen.getByText('Staffing and payroll run through Sunday 11:59 p.m. Update overtime and callouts before you submit.')).toBeInTheDocument();
    expect(screen.getByLabelText('Current census')).not.toHaveAttribute('readonly');
    cleanup(); useFacilityStore.setState({ selectedFacilityId: null });
    await start(); await choose();
    expect(screen.queryByText(/Staffing and payroll run through Sunday/)).not.toBeInTheDocument();
  });
  it('offers the entry window to an organization administrator and to nobody else', async () => {
    mocks.auth.appRole = 'owner';
    mocks.request.mockResolvedValueOnce({ ...widened, can_import: true });
    await start();
    fireEvent.click(screen.getByRole('button', { name: 'Management tools' }));
    const control = screen.getByLabelText('Entry opens · Homewood');
    expect(control).toHaveValue('3405');
    expect(screen.getByLabelText('Entry opens · Oakridge')).toHaveValue('');
    expect(within(control as HTMLSelectElement).getByRole('option', { name: 'Haven default · Sunday 12:00 a.m.' })).toBeInTheDocument();
    expect(['Saturday 12:00 a.m.', 'Sunday 12:00 a.m.', 'Sunday 6:00 p.m.', 'Monday 12:00 a.m.'].every(label =>
      within(control as HTMLSelectElement).getAllByRole('option').some(option => option.textContent === label))).toBe(true);
    mocks.request.mockResolvedValueOnce({ facility_id: 'a', entry_open_lead_minutes: 885, open_week: '2026-09-14', entry_opens_at: '2026-09-13T22:00:00Z' });
    mocks.request.mockResolvedValueOnce({ ...widened, can_import: true, facilities: [{ ...widened.facilities[0], entry_open_lead_minutes: 885 }, widened.facilities[1]] });
    fireEvent.change(control, { target: { value: '885' } });
    await screen.findByText('Homewood entry opens Sunday 6:00 p.m. Eastern.');
    expect(mocks.request).toHaveBeenCalledWith('set_entry_window', { facility_id: 'a', entry_open_lead_minutes: 885 });
    // The reload is what the page now believes, not the optimistic click.
    expect(screen.getByLabelText('Entry opens · Homewood')).toHaveValue('885');
    cleanup();
    // A facility administrator never sees the control, because the whole
    // management disclosure stays closed to them.
    mocks.auth.appRole = 'facility_admin';
    await start(); await choose();
    expect(screen.queryByRole('button', { name: 'Management tools' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Entry opens · Homewood')).not.toBeInTheDocument();
  });
  it('reports a refused window change beside the control it belongs to', async () => {
    mocks.auth.appRole = 'owner';
    mocks.request.mockResolvedValueOnce({ ...widened, can_import: true });
    await start();
    fireEvent.click(screen.getByRole('button', { name: 'Management tools' }));
    const control = screen.getByLabelText('Entry opens · Homewood');
    mocks.request.mockRejectedValueOnce(new StandUpRequestError('Entry open lead must be between 60 and 3405 minutes', 400));
    fireEvent.change(control, { target: { value: '525' } });
    const alert = await screen.findByText('Entry open lead must be between 60 and 3405 minutes');
    expect(control).toHaveAttribute('aria-invalid', 'true');
    expect(control).toHaveAttribute('aria-describedby', alert.id);
    expect(alert.id).toBe('entry-window-note-a');
  });
});
/** COL-298 / NAV-008: a week nobody entered anything for is never reserved. */
describe('Stand Up empty draft reserves nothing', () => {
  it('sends no save when the form is opened, read and left', async () => {
    vi.useFakeTimers();
    const view = render(<StandUpWorkspace />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.change(screen.getByLabelText('Reporting facility'), { target: { value: 'a' } });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByLabelText('Current census')).toBeInTheDocument();
    // Long past the autosave debounce, and then away from the page entirely.
    await act(async () => { vi.advanceTimersByTime(10000); });
    act(() => { expect(allowRouteLeave('/admin/executive')).toBe(true); });
    view.unmount();
    expect(mocks.request.mock.calls.some(call => call[0] === 'save')).toBe(false);
  });
  it('holds no report after a save that carried nothing, and starts the next one from version 0', async () => {
    await start(); await choose();
    changeCensus('20'); changeCensus('');
    mocks.request.mockResolvedValueOnce({ ...report({ id: null as unknown as string, version: 0, revision_id: null as unknown as string, updated_at: null as unknown as string }), not_started: true });
    save(); await screen.findByText('No saved report yet');
    expect(mocks.request.mock.calls.at(-1)?.[1]).toMatchObject({ expected_version: 0, values: emptyValues() });
    expect(screen.getByText('Not started')).toBeInTheDocument();
    // The next real figure still opens the report at version 0, not version 1.
    changeCensus('21');
    mocks.request.mockResolvedValueOnce(report({ values: { ...emptyValues(), current_total_census: 21 } }));
    save(); await screen.findByText(/Saved Sep 14/);
    expect(mocks.request.mock.calls.at(-1)?.[1]).toMatchObject({ expected_version: 0 });
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('1/16 provided · not yet reviewed')).toBeInTheDocument();
  });
  it('reads a legacy empty draft row as Not started and lets the next administrator save over it', async () => {
    mocks.request.mockResolvedValueOnce({ ...workspace, reports: [report({ entry_origin: 'initialized' })] });
    await start();
    const row = screen.getByRole('row', { name: /Homewood/ });
    expect(row).toHaveTextContent('Not started');
    expect(row).toHaveTextContent('0/16 provided');
    expect(row).toHaveTextContent('No report');
    await choose();
    expect(screen.getByText('Not started')).toBeInTheDocument();
    expect(screen.getByText('Not submitted in Haven.')).toBeInTheDocument();
    // The row is not a lock: the version it holds is carried into the next save.
    changeCensus('27');
    mocks.request.mockResolvedValueOnce(report({ version: 2, values: { ...emptyValues(), current_total_census: 27 } }));
    save(); await screen.findByText(/Saved Sep 14/);
    expect(mocks.request.mock.calls.at(-1)?.[1]).toMatchObject({ expected_version: 1, values: { ...emptyValues(), current_total_census: 27 } });
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });
});
describe('Friendly spreadsheet recovery', () => {
  it('makes an expired Google workbook credential visible before reports are trusted', async () => {
    mocks.request.mockResolvedValueOnce({
      ...workspace,
      google_connection: {
        state: 'reconnect_required',
        last_success_at: '2026-09-11T12:00:00Z',
        last_checked_at: '2026-09-18T13:30:00Z',
        last_outcome: 'failed',
        last_error_code: 'google_auth_reconnect_required',
      },
    });

    await start();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Google workbook disconnected');
    expect(alert).toHaveTextContent('Drive changes are not reaching Haven');
    expect(alert).toHaveTextContent('Last successful workbook synchronization');
  });

  it('warns when a connected workbook has not completed within five minutes', async () => {
    mocks.request.mockResolvedValueOnce({
      ...workspace,
      server_now: '2026-09-14T12:30:00Z',
      google_connection: {
        state: 'connected',
        last_success_at: '2026-09-14T12:20:00Z',
        last_checked_at: '2026-09-14T12:20:00Z',
        last_outcome: 'synchronized',
        last_error_code: null,
      },
    });

    await start();

    expect(screen.getByRole('alert')).toHaveTextContent('Google workbook synchronization is delayed');
  });

  it('requires a deliberate blank confirmation for spreadsheet clears and sends corrected dollars as cents', async () => {
    const values = { ...emptyValues(), monthly_rent_roll_cents: 100000, current_total_census: 20 };
    const preview = { facility_id: 'a', week_start: '2026-09-14', preview_id: 'p', expected_version: 1, current: values, incoming: { ...values, current_total_census: null }, merged: values, conflicts: ['monthly_rent_roll_cents'], clears: ['current_total_census'] };
    mocks.request.mockResolvedValueOnce({ ...workspace, reports: [report({ values })], pending_recoveries: [preview] });
    await start(); await choose(); fireEvent.click(screen.getByRole('button', { name: '1 spreadsheet change needs review' })); fireEvent.click(screen.getByRole('button', { name: 'Review spreadsheet change 1' }));
    fireEvent.change(screen.getByLabelText('Decision for Monthly rent roll'), { target: { value: 'corrected' } }); fireEvent.change(screen.getByLabelText('Corrected Monthly rent roll ($)'), { target: { value: '1234.56' } });
    fireEvent.change(screen.getByLabelText('Decision for Current census'), { target: { value: 'file' } });
    const apply = screen.getByRole('button', { name: 'Save reviewed choices for Homewood' }); expect(apply).toBeDisabled();
    fireEvent.click(screen.getByLabelText('I intend to leave the selected figures blank.'));
    mocks.request.mockResolvedValueOnce(report({ version: 2, values: { ...values, monthly_rent_roll_cents: 123456, current_total_census: null } }));
    fireEvent.click(apply); await screen.findByText('Reviewed spreadsheet changes saved.');
    expect(mocks.request).toHaveBeenCalledWith('commit_recovery', expect.objectContaining({ resolutions: { monthly_rent_roll_cents: 123456, current_total_census: null }, confirm_clears: true }));
  });
  it('locks corrected values and clear confirmation while reviewed recovery is being saved', async () => {
    const values = { ...emptyValues(), monthly_rent_roll_cents: 100000, current_total_census: 20 };
    const preview = { facility_id: 'a', week_start: '2026-09-14', preview_id: 'p', expected_version: 1, current: values, incoming: { ...values, current_total_census: null }, merged: values, conflicts: ['monthly_rent_roll_cents'], clears: ['current_total_census'] };
    mocks.request.mockResolvedValueOnce({ ...workspace, reports: [report({ values })], pending_recoveries: [preview] });
    await start(); await choose(); fireEvent.click(screen.getByRole('button', { name: '1 spreadsheet change needs review' })); fireEvent.click(screen.getByRole('button', { name: 'Review spreadsheet change 1' }));
    fireEvent.change(screen.getByLabelText('Decision for Monthly rent roll'), { target: { value: 'corrected' } }); fireEvent.change(screen.getByLabelText('Corrected Monthly rent roll ($)'), { target: { value: '1234.56' } });
    fireEvent.change(screen.getByLabelText('Decision for Current census'), { target: { value: 'clear' } }); fireEvent.click(screen.getByLabelText('I intend to leave the selected figures blank.'));
    const slow = deferred<StandUpReport>(); mocks.request.mockReturnValueOnce(slow.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Save reviewed choices for Homewood' }));
    expect(screen.getByLabelText('Corrected Monthly rent roll ($)')).toBeDisabled(); expect(screen.getByLabelText('I intend to leave the selected figures blank.')).toBeDisabled();
    await act(async () => slow.resolve(report({ version: 2, values: { ...values, monthly_rent_roll_cents: 123456, current_total_census: null } })));
  });
  it('keeps Haven values and expresses money in dollars without exposing cents in routine choices', async () => {
    const values = { ...emptyValues(), monthly_rent_roll_cents: 100000, current_total_census: 20 };
    const preview = { facility_id: 'a', week_start: '2026-09-14', preview_id: 'p', expected_version: 1, baseline: values, current: values, incoming: { ...values, monthly_rent_roll_cents: null, current_total_census: 22 }, merged: values, conflicts: ['current_total_census'], clears: ['monthly_rent_roll_cents'] };
    mocks.request.mockResolvedValueOnce({ ...workspace, reports: [report({ values })], pending_recoveries: [preview] });
    await start(); await choose(); fireEvent.click(screen.getByRole('button', { name: '1 spreadsheet change needs review' })); fireEvent.click(screen.getByRole('button', { name: 'Review spreadsheet change 1' }));
    expect(screen.getByText('Previously: $1,000.00 · Haven: $1,000.00 · Spreadsheet: Not provided')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Decision for Monthly rent roll'), { target: { value: 'haven' } }); fireEvent.change(screen.getByLabelText('Decision for Current census'), { target: { value: 'haven' } });
    mocks.request.mockResolvedValueOnce(report({ values, version: 2 })); mocks.request.mockResolvedValueOnce({ ...workspace, reports: [report({ values, version: 2 })], pending_recoveries: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Save reviewed choices for Homewood' })); await screen.findByText('Reviewed spreadsheet changes saved.');
    expect(mocks.request).toHaveBeenCalledWith('commit_recovery', expect.objectContaining({ resolutions: { current_total_census: 20, monthly_rent_roll_cents: 100000 }, confirm_clears: false }));
  });
});

describe('Stand Up census and hospital from the roster (COL-351)', () => {
  const roster = { facility_id: 'a', in_house_count: 32, hospital_hold_count: 1, loa_count: 1, roster_census_count: 34, resident_count_in_haven: 40, roster_as_of: '2026-09-14T11:14:00Z' };
  const noRoster = { facility_id: 'b', in_house_count: 0, hospital_hold_count: 0, loa_count: 0, roster_census_count: 0, resident_count_in_haven: 0, roster_as_of: null };
  const outOfHouse = [
    { id: 'res-c', name: 'Test Resident C', room: '104-A', status: 'hospital' as const, label: 'Bed Hold — Hospital', since: '2026-09-12T09:00:00Z' },
    { id: 'res-b', name: 'Test Resident B', room: '102-B', status: 'loa' as const, label: 'On leave / vacation', since: '2026-09-10T14:00:00Z' },
  ];
  const confirmed = (patch: Record<string, unknown> = {}) => ({ source: 'roster_confirmed' as const, suggested: 34, confirmed: 34, override_reason: null, roster_as_of: roster.roster_as_of, confirmed_at: '2026-09-14T12:00:00Z', ...patch });
  function withRoster(data: Record<string, typeof roster | typeof noRoster> = { a: roster, b: noRoster }, saved?: (payload: Record<string, unknown>) => StandUpReport) {
    mocks.request.mockImplementation(async (action, payload) => {
      if (action === 'workspace') return workspace;
      if (action === 'roster') return data[(payload as { facility_id: string }).facility_id];
      if (action === 'save' && saved) return saved(payload as Record<string, unknown>);
      throw new Error('Unexpected operation');
    });
  }
  it('suggests the census with its components and the roster as-of, and Use roster saves roster_confirmed', async () => {
    withRoster(undefined, payload => report({ values: payload.values as StandUpReport['values'], roster_confirmations: { current_total_census: confirmed() } }));
    await start(); await choose();
    expect(await screen.findByText('Roster: 34 (32 in house, 1 hospital or rehab, 1 leave)')).toBeInTheDocument();
    expect(screen.getByText('Roster: 1 at hospital or rehab')).toBeInTheDocument();
    expect(screen.getAllByText('Roster last changed Sep 14, 7:14 a.m.')).toHaveLength(2);
    expect(screen.getByLabelText('Current census')).toHaveValue(null);
    fireEvent.click(screen.getByRole('button', { name: 'Use roster for Current census' }));
    expect(screen.getByLabelText('Current census')).toHaveValue(34);
    expect(screen.queryByLabelText('Why is this different?')).not.toBeInTheDocument();
    save(); await screen.findByText(/Saved Sep 14/);
    const saved = mocks.request.mock.calls.find(call => call[0] === 'save')?.[1] as { values: StandUpReport['values']; roster: Record<string, unknown> };
    expect(saved.values.current_total_census).toBe(34);
    expect(saved.roster).toEqual({ current_total_census: {}, hospital_and_rehab_total: {} });
    expect(mocks.request.mock.calls.filter(call => call[0] === 'roster').length).toBeGreaterThanOrEqual(2);
  });
  it('blocks a differing figure until a reason is chosen, then saves it as overridden', async () => {
    withRoster(undefined, payload => report({ values: payload.values as StandUpReport['values'], roster_confirmations: { current_total_census: confirmed({ source: 'overridden', confirmed: 35, override_reason: 'roster_not_current' }) } }));
    await start(); await choose(); await screen.findByText('Roster: 34 (32 in house, 1 hospital or rehab, 1 leave)');
    vi.useFakeTimers();
    changeCensus('35');
    const select = screen.getByLabelText('Why is this different?');
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Current census')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Current census')).toHaveAttribute('aria-describedby', 'current_total_census-roster-issue');
    expect(screen.getByText('Current census differs from the roster (34). Choose why it is different, or use the roster figure.')).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(1500); });
    expect(mocks.request.mock.calls.filter(call => call[0] === 'save')).toHaveLength(0);
    save(); await act(async () => { await Promise.resolve(); });
    expect(mocks.request.mock.calls.filter(call => call[0] === 'save')).toHaveLength(0);
    expect(screen.getByRole('alert')).toHaveTextContent('Current census differs from the roster (34)');
    fireEvent.change(select, { target: { value: 'roster_not_current' } });
    expect(select).not.toHaveAttribute('aria-invalid');
    save(); await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const saved = mocks.request.mock.calls.find(call => call[0] === 'save')?.[1] as { roster: Record<string, unknown> };
    expect(saved.roster).toEqual({ current_total_census: { override_reason: 'roster_not_current' }, hospital_and_rehab_total: {} });
  });
  it('shows the no-roster line for a facility without residents and still lets the figure be typed and saved', async () => {
    withRoster(undefined, payload => report({ facility_id: 'b', values: payload.values as StandUpReport['values'], roster_confirmations: { current_total_census: confirmed({ source: 'entered_no_roster', suggested: null, confirmed: 12, roster_as_of: null }) } }));
    await start(); await choose('b');
    expect((await screen.findAllByText('No roster in Haven for this facility')).length).toBe(2);
    expect(screen.queryByRole('button', { name: /Use roster/ })).not.toBeInTheDocument();
    changeCensus('12'); expect(screen.queryByLabelText('Why is this different?')).not.toBeInTheDocument();
    save(); await screen.findByText(/Saved Sep 14/);
    const saved = mocks.request.mock.calls.find(call => call[0] === 'save')?.[1] as { facility_id: string; roster: Record<string, unknown> };
    expect(saved).toMatchObject({ facility_id: 'b', roster: { current_total_census: {}, hospital_and_rehab_total: {} } });
  });
  it('removes the editable surface when the roster read says the grant is gone', async () => {
    mocks.request.mockImplementation(async action => { if (action === 'workspace') return workspace; if (action === 'roster') throw new StandUpRequestError('Stand Up access denied', 403); throw new Error('Unexpected operation'); });
    await start(); await choose();
    await screen.findByText(/Your access changed/); expect(screen.queryByLabelText('Current census')).not.toBeInTheDocument();
  });
  it('keeps the field as it is today when the roster cannot be read', async () => {
    withRoster({ a: roster }, payload => report({ values: payload.values as StandUpReport['values'] }));
    mocks.request.mockImplementation(async (action, payload) => { if (action === 'workspace') return workspace; if (action === 'roster') throw new Error('Roster read timed out'); if (action === 'save') return report({ values: (payload as { values: StandUpReport['values'] }).values }); throw new Error('Unexpected operation'); });
    await start(); await choose();
    expect((await screen.findAllByText('Roster unavailable: Roster read timed out')).length).toBe(2);
    changeCensus('9'); save(); await screen.findByText(/Saved Sep 14/);
    expect(mocks.request.mock.calls.find(call => call[0] === 'save')?.[1]).not.toHaveProperty('roster');
  });
  it('lists who is out of house for the chosen facility only, and never sends a name with the report', async () => {
    mocks.outOfHouse.mockImplementation(async (facilityId: string) => facilityId === 'a' ? outOfHouse : []);
    withRoster(undefined, payload => report({ values: payload.values as StandUpReport['values'] }));
    await start();
    expect(screen.queryByText(/Out of house/)).not.toBeInTheDocument();
    await choose();
    const summary = await screen.findByText('Out of house (2)');
    expect(mocks.outOfHouse).toHaveBeenCalledWith('a');
    fireEvent.click(summary);
    const rows = within(screen.getByRole('table', { name: 'Residents out of house, hospital first' })).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Test Resident C'); expect(rows[0]).toHaveTextContent('104-A'); expect(rows[0]).toHaveTextContent('Bed Hold — Hospital'); expect(rows[0]).toHaveTextContent('Sep 12');
    expect(rows[1]).toHaveTextContent('Test Resident B'); expect(rows[1]).toHaveTextContent('On leave / vacation');
    expect(screen.getByRole('link', { name: 'Open record for Test Resident C' })).toHaveAttribute('href', '/admin/residents/res-c');
    fireEvent.click(screen.getByRole('button', { name: 'Use roster for Current census' })); save(); await screen.findByText(/Saved Sep 14/);
    const wire = JSON.stringify(mocks.request.mock.calls.filter(call => call[0] !== 'workspace').map(call => call[1]));
    expect(wire).not.toMatch(/Test Resident|res-c|res-b|104-A|first_name|last_name/);
    fireEvent.change(screen.getByLabelText('Reporting facility'), { target: { value: 'b' } });
    await screen.findByRole('heading', { name: 'Oakridge' });
    expect(await screen.findByText('Out of house (0)')).toBeInTheDocument();
    expect(screen.queryByText('Test Resident C')).not.toBeInTheDocument();
  });
  it('shows a past report as it was recorded and never asks the roster again for it', async () => {
    mocks.request.mockResolvedValueOnce({ ...workspace, reports: [report({ id: 'old', week_start: '2026-09-07', values: { ...emptyValues(), current_total_census: 35 }, roster_confirmations: { current_total_census: confirmed({ source: 'overridden', confirmed: 35, override_reason: 'roster_not_current' }) } })] });
    withRoster();
    await start(); await choose();
    fireEvent.change(screen.getByLabelText('Meeting date'), { target: { value: '2026-09-07' } });
    expect(screen.getByText('Roster suggested 34 · override: Roster not updated yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Use roster/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Out of house/)).not.toBeInTheDocument();
    expect(mocks.request.mock.calls.filter(call => call[0] === 'roster').every(call => (call[1] as { facility_id: string }).facility_id === 'a')).toBe(true);
    const rosterCalls = mocks.request.mock.calls.filter(call => call[0] === 'roster').length;
    fireEvent.change(screen.getByLabelText('Meeting date'), { target: { value: '2026-09-14' } });
    await screen.findByText('Roster: 34 (32 in house, 1 hospital or rehab, 1 leave)');
    expect(mocks.request.mock.calls.filter(call => call[0] === 'roster').length).toBe(rosterCalls + 1);
  });
  it('marks an override on the all-facilities overview and says nothing for a confirmed figure', async () => {
    mocks.request.mockResolvedValueOnce({ ...workspace, reports: [
      report({ values: { ...emptyValues(), current_total_census: 35 }, roster_confirmations: { current_total_census: confirmed({ source: 'overridden', confirmed: 35, override_reason: 'change_not_entered' }) } }),
      report({ id: 'r2', facility_id: 'b', values: { ...emptyValues(), current_total_census: 12 }, roster_confirmations: { current_total_census: confirmed({ confirmed: 12, suggested: 12 }) } }),
    ] });
    await start();
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('35 · override: Admission or discharge not entered in Haven');
    expect(rows[1]).toHaveTextContent('12'); expect(rows[1]).not.toHaveTextContent('override');
  });
});
describe('Stand Up changes after submission (COL-797)', () => {
  const full = (census = 30) => ({ ...Object.fromEntries(Object.keys(emptyValues()).map(key => [key, 1])), current_total_census: census } as StandUpReport['values']);
  const submitted = (patch: Partial<StandUpReport> = {}) => report({ values: full(), status: 'ready', entry_origin: 'manual', last_submitted_at: '2026-09-14T12:40:00Z', last_submitted_by: 'u', ...patch });
  it('lets the submitter reopen a submitted open-week report and edit it without wiping the other figures', async () => {
    mocks.auth.appRole = 'facility_admin';
    mocks.request.mockResolvedValueOnce({ ...workspace, can_edit_submitted: true, reports: [submitted()] });
    await start(); await choose();
    expect(screen.getByLabelText('Current census')).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'Review and submit' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Edit submitted figures' }));
    expect(screen.getByText(/Reopened for changes/)).toBeInTheDocument();
    expect(screen.getByLabelText('Current census')).not.toHaveAttribute('readonly');
    changeCensus('31');
    fireEvent.change(screen.getByLabelText('Reason for the change (optional)'), { target: { value: 'Discharge after the call' } });
    mocks.request.mockResolvedValueOnce(submitted({ version: 2, status: 'draft', values: full(31) })); save();
    await waitFor(() => expect(mocks.request.mock.calls.some(call => call[0] === 'save')).toBe(true));
    const payload = mocks.request.mock.calls.find(call => call[0] === 'save')?.[1];
    expect(payload).toMatchObject({ facility_id: 'a', week_start: '2026-09-14', expected_version: 1, status: 'draft', reason: 'Discharge after the call' });
    expect(payload.values).toEqual(full(31));
  });
  it('lets a facility administrator correct a submitted past week with a recorded reason', async () => {
    mocks.auth.appRole = 'facility_admin';
    mocks.request.mockResolvedValueOnce({ ...workspace, can_import: false, can_edit_submitted: true, reports: [submitted({ id: 'old', week_start: '2026-09-07', last_submitted_by: 'someone-else' })] });
    await start(); await choose();
    fireEvent.change(screen.getByLabelText('Meeting date'), { target: { value: '2026-09-07' } });
    expect(screen.getByLabelText('Current census')).toHaveAttribute('readonly');
    expect(screen.queryByLabelText('Make a correction with a recorded reason')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit submitted figures' }));
    changeCensus('29'); save();
    await screen.findByText('Enter a reason for this historical correction.');
    expect(mocks.request.mock.calls.some(call => call[0] === 'save')).toBe(false);
    fireEvent.change(screen.getByLabelText('Correction reason'), { target: { value: 'Census miscounted' } });
    mocks.request.mockResolvedValueOnce(submitted({ id: 'old', week_start: '2026-09-07', version: 2, status: 'draft', values: full(29) })); save();
    await waitFor(() => expect(mocks.request.mock.calls.some(call => call[0] === 'save')).toBe(true));
    expect(mocks.request.mock.calls.find(call => call[0] === 'save')?.[1]).toMatchObject({ week_start: '2026-09-07', status: 'draft', reason: 'Census miscounted' });
  });
  it('offers no reopen to a user who neither submitted the report nor administers the facility, and honors a server refusal', async () => {
    mocks.request.mockResolvedValueOnce({ ...workspace, can_edit_submitted: false, reports: [submitted({ last_submitted_by: 'someone-else' })] });
    await start(); await choose();
    expect(screen.queryByRole('button', { name: 'Edit submitted figures' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit history' })).not.toBeInTheDocument();
    expect(screen.getByText(/Only the person who submitted it or a facility administrator can change it/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Current census'), { target: { value: '99' } });
    expect(screen.getByLabelText('Current census')).toHaveValue(30);
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
  });
  it('removes the editable surface when the server refuses a post-submit edit', async () => {
    mocks.request.mockResolvedValueOnce({ ...workspace, can_edit_submitted: true, reports: [submitted()] });
    await start(); await choose();
    fireEvent.click(screen.getByRole('button', { name: 'Edit submitted figures' })); changeCensus('32');
    mocks.request.mockRejectedValueOnce(new StandUpRequestError('Stand Up access denied', 403)); save();
    await screen.findByText(/Your access changed/); expect(screen.queryByLabelText('Current census')).not.toBeInTheDocument();
  });
  it('shows administrators the field-level edit history with actor, time, before and after', async () => {
    mocks.request.mockResolvedValueOnce({ ...workspace, can_edit_submitted: true, reports: [submitted({ version: 3 })] });
    await start(); await choose();
    mocks.request.mockResolvedValueOnce({ facility_id: 'a', week_start: '2026-09-14', changes: [
      { id: 'c1', version: 2, revision_id: 'rev2', field_key: 'current_total_census', before_value: 30, after_value: 31, actor_id: 'u', actor_name: 'Demo Administrator', actor_role: 'facility_admin', reason: 'Discharge after the call', created_at: '2026-09-14T14:05:00Z' },
      { id: 'c2', version: 2, revision_id: 'rev2', field_key: 'status', before_value: 'ready', after_value: 'draft', actor_id: 'u', actor_name: 'Demo Administrator', actor_role: 'facility_admin', reason: 'Discharge after the call', created_at: '2026-09-14T14:05:00Z' },
    ] });
    fireEvent.click(screen.getByRole('button', { name: 'Edit history' }));
    const panel = await screen.findByLabelText('Changes after submission');
    expect(mocks.request.mock.calls.at(-1)).toEqual(['post_submit_changes', { facility_id: 'a', week_start: '2026-09-14' }]);
    await within(panel).findByText(/Current census: 30 to 31 · Discharge after the call/);
    expect(within(panel).getByText(/Status: Submitted to Draft/)).toBeInTheDocument();
    expect(within(panel).getAllByText(/Sep 14, 10:05 AM Eastern · Demo Administrator/)).toHaveLength(2);
  });
});

describe('Monday arrives prefilled from Haven (COL-753)', () => {
  const prefill = {
    facility_id: 'a', week_start: '2026-09-14', computed_at: '2026-09-14T12:00:00Z',
    fields: {
      monthly_rent_roll_cents: { value: 11710816, source: 'Invoices in Haven: sent with a balance, plus drafts not yet sent' },
      current_total_census: { value: 34, source: 'Resident roster' }, hospital_and_rehab_total: { value: 1, source: 'Resident roster' },
      sp_female_beds_open: { value: 1, source: 'Beds in Haven' }, sp_male_beds_open: { value: 0, source: 'Beds in Haven' },
      sp_flexible_beds_open: { value: 2, source: 'Beds in Haven' }, private_beds_open: { value: 3, source: 'Beds in Haven' },
      admissions_expected: { value: 2, source: 'Admission cases' }, expected_discharges: { value: 0, source: 'Residents' },
      callouts_last_week: { value: 4, source: 'Attendance records' }, terminations_last_week: { value: 1, source: 'Staff records' },
      current_open_positions: { value: null, source: null, note: 'Haven does not record how many positions each facility is budgeted for' },
      overtime_reported: { value: null, source: null, note: 'Haven has no approved time source to count overtime from' },
      tours_expected: { value: 5, source: 'Tour records' }, provider_activities_expected: { value: 1, source: 'Outreach calendar' }, outreach_engagements: { value: 2, source: 'Outreach calendar' },
    },
  };
  const roster = { facility_id: 'a', in_house_count: 33, hospital_hold_count: 1, loa_count: 0, roster_census_count: 34, resident_count_in_haven: 40, roster_as_of: '2026-09-13T15:00:00Z', hospital_count: 1, rehab_count: 0, bed_hold_type_not_recorded_count: 0 };
  beforeEach(() => {
    mocks.request.mockImplementation(async (action: string) => {
      if (action === 'workspace') return workspace;
      if (action === 'prefill') return prefill;
      if (action === 'roster') return roster;
      throw new Error('Unexpected operation');
    });
  });

  it('opens an unstarted report with every computable figure, its source, and blanks where Haven has none', async () => {
    await start(); await choose();
    await waitFor(() => expect(screen.getByLabelText('Monthly rent roll ($)')).toHaveValue(117108.16));
    expect(screen.getByLabelText('Current census')).toHaveValue(34);
    expect(screen.getByLabelText('Callouts last week')).toHaveValue(4);
    // Haven cannot count open positions or overtime: blank with the reason, never 0.
    expect(screen.getByLabelText('Open positions last week')).toHaveValue(null);
    expect(screen.getByText('Haven cannot compute this: Haven does not record how many positions each facility is budgeted for')).toBeInTheDocument();
    expect(screen.getByText('Haven: $117,108.16 · Invoices in Haven: sent with a balance, plus drafts not yet sent')).toBeInTheDocument();
    expect(screen.getByText(/Prefilled from Haven\. Check each figure/)).toBeInTheDocument();
    // Nothing is saved until the administrator saves or submits.
    expect(mocks.request.mock.calls.some(call => call[0] === 'save')).toBe(false);
  });

  it('asks why a figure differs from Haven before submitting, and sends only that reason', async () => {
    await start(); await choose();
    await waitFor(() => expect(screen.getByLabelText('Callouts last week')).toHaveValue(4));
    fireEvent.change(screen.getByLabelText('Open positions last week'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Overtime hours'), { target: { value: '3' } }); fireEvent.change(screen.getByLabelText('Overtime minutes'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Callouts last week'), { target: { value: '6' } });
    expect(screen.getByText('Callouts last week differs from Haven (4). Choose why it is different, or use Haven’s figure.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review and submit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Homewood for September 14, 2026' }));
    await screen.findByText(/Callouts last week differs from Haven \(4\)/, { selector: '[role="alert"]' });
    expect(mocks.request.mock.calls.some(call => call[0] === 'save' && call[1].status === 'ready')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Back to figures' }));
    fireEvent.change(screen.getByLabelText('Why is this different?'), { target: { value: 'haven_not_current' } });
    mocks.request.mockImplementationOnce(async () => report({ status: 'ready', last_submitted_at: '2026-09-14T12:40:00Z' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review and submit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Homewood for September 14, 2026' }));
    await waitFor(() => expect(mocks.request.mock.calls.some(call => call[0] === 'save' && call[1].status === 'ready')).toBe(true));
    const payload = mocks.request.mock.calls.find(call => call[0] === 'save' && call[1].status === 'ready')![1];
    expect(payload.prefill).toEqual({ callouts_last_week: { override_reason: 'haven_not_current' } });
    expect(payload.values).toMatchObject({ monthly_rent_roll_cents: 11710816, callouts_last_week: 6, current_open_positions: 2, current_total_census: 34 });
  });

  it('puts Haven’s figure back with one press', async () => {
    await start(); await choose();
    await waitFor(() => expect(screen.getByLabelText('Expected tours this week')).toHaveValue(5));
    fireEvent.change(screen.getByLabelText('Expected tours this week'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use Haven’s figure for Expected tours this week' }));
    expect(screen.getByLabelText('Expected tours this week')).toHaveValue(5);
    expect(screen.queryByText(/Expected tours this week differs from Haven/)).not.toBeInTheDocument();
  });

  it('shows what a saved report recorded instead of recomputing Haven for a past meeting', async () => {
    const past = report({ week_start: '2026-09-07', status: 'ready', last_submitted_at: '2026-09-07T12:40:00Z', values: { ...emptyValues(), callouts_last_week: 6 },
      prefill_confirmations: { callouts_last_week: { source: 'overridden', haven_value: 4, confirmed: 6, override_reason: 'haven_not_current', haven_source: 'Attendance records', computed_at: '2026-09-07T12:00:00Z', confirmed_at: '2026-09-07T12:40:00Z' } } });
    mocks.request.mockImplementation(async (action: string) => { if (action === 'workspace') return { ...workspace, reports: [past] }; if (action === 'roster') return roster; if (action === 'prefill') return prefill; throw new Error('Unexpected operation'); });
    await start(); await choose();
    fireEvent.change(screen.getByLabelText('Meeting date'), { target: { value: '2026-09-07' } });
    expect(await screen.findByText('Haven had 4 · override: Haven is not up to date')).toBeInTheDocument();
  });
});
