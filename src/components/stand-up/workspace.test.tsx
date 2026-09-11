import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StandUpWorkspace } from './workspace';
import { emptyValues } from '@/lib/stand-up/model';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/contexts/haven-auth-context', () => ({ useHavenAuth: () => ({ loading: false, user: { id: 'u' }, organizationId: 'org' }) }));
vi.mock('./transport', async importOriginal => ({ ...(await importOriginal<typeof import('./transport')>()), standUpRequest: mocks.request }));
const workspace = { facilities: [{ id: 'a', name: 'Homewood' }, { id: 'b', name: 'Oakridge' }], reports: [], current_week: '2026-09-14', can_import: false };
afterEach(cleanup);
beforeEach(() => { mocks.request.mockReset(); mocks.request.mockResolvedValue(workspace); });
describe('Stand Up entry', () => {
  it('retains draft after a failed save, preserves zero/null and converts dollars to cents', async () => {
    render(<StandUpWorkspace />);
    await screen.findByLabelText('Monthly rent roll ($)');
    fireEvent.change(screen.getByLabelText('Monthly rent roll ($)'), { target: { value: '1234.56' } });
    fireEvent.change(screen.getByLabelText('Current census'), { target: { value: '0' } });
    mocks.request.mockRejectedValueOnce(new Error('Request timed out; retry'));
    fireEvent.submit(screen.getByText('Save draft').closest('form')!);
    await screen.findByText('Request timed out; retry');
    expect(screen.getByLabelText('Monthly rent roll ($)')).toHaveValue(1234.56);
    expect(mocks.request).toHaveBeenLastCalledWith('save', expect.objectContaining({ facility_id: 'a', expected_version: 0, values: { ...emptyValues(), monthly_rent_roll_cents: 123456, current_total_census: 0 } }));
    const first = mocks.request.mock.calls.at(-1)?.[1].request_id;
    mocks.request.mockRejectedValueOnce(new Error('Still unavailable'));
    fireEvent.submit(screen.getByText('Save draft').closest('form')!);
    await screen.findByText('Still unavailable');
    expect(mocks.request.mock.calls.at(-1)?.[1].request_id).toBe(first);
  });
  it('prevents writing a dirty facility draft to a different facility', async () => {
    render(<StandUpWorkspace />); await screen.findByLabelText('Current census');
    fireEvent.change(screen.getByLabelText('Current census'), { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText('Facility'), { target: { value: 'b' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Save your draft');
    expect(screen.getByLabelText('Facility')).toHaveValue('a');
    fireEvent.click(screen.getByText('Discard unsaved changes'));
    fireEvent.change(screen.getByLabelText('Facility'), { target: { value: 'b' } });
    await waitFor(() => expect(screen.getByLabelText('Current census')).toHaveValue(null));
    expect(screen.getByLabelText('Facility')).toHaveValue('b');
  });
  it('shows missing coverage and last Monday through Sunday without zero totals', async () => {
    render(<StandUpWorkspace />); await screen.findByLabelText('Current census');
    expect(screen.getByText('0 of 2 accessible facilities ready.')).toBeInTheDocument();
    expect(screen.getByText('2026-09-07 through 2026-09-13')).toBeInTheDocument();
    expect(screen.getByText(/Average rent: Not available/)).toBeInTheDocument();
    expect(screen.getByText('Ready for Stand Up')).toBeDisabled();
  });
  it('requires explicit conflict resolution and clear confirmation before recovery', async () => {
    const values = { ...emptyValues(), current_total_census: 20 };
    mocks.request.mockResolvedValueOnce({ ...workspace, reports: [{ id: 'r', facility_id: 'a', week_start: '2026-09-14', version: 2, revision_id: 'rev', values, status: 'draft', updated_at: '2026-09-14T10:00:00Z' }] });
    render(<StandUpWorkspace />); await screen.findByLabelText('Current census');
    mocks.request.mockResolvedValueOnce({ facility_id: 'a', week_start: '2026-09-14', preview_id: 'p', expected_version: 2, merged: values, conflicts: ['current_total_census'], clears: ['monthly_rent_roll_cents'] });
    const file = new File([''], 'fallback.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => JSON.stringify({ baseline_id: 'baseline', facility_id: 'a', week_start: '2026-09-14', version: 1, values }) });
    fireEvent.change(screen.getByLabelText('Upload edited fallback (JSON or CSV)'), { target: { files: [file] } });
    await screen.findByText('Recovery preview — current version 2');
    const apply = screen.getByText('Apply reviewed recovery'); expect(apply).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Resolve Current census'), { target: { value: '21' } });
    fireEvent.change(screen.getByLabelText('Resolve Monthly rent roll'), { target: { value: 'CLEAR' } });
    expect(apply).toBeDisabled();
    fireEvent.click(screen.getByLabelText('I confirm any intentional clearing of values.'));
    mocks.request.mockResolvedValueOnce({ id: 'r', facility_id: 'a', week_start: '2026-09-14', version: 3, revision_id: 'rev3', values: { ...values, current_total_census: 21 }, status: 'draft', updated_at: '2026-09-14T10:10:00Z' });
    fireEvent.click(apply);
    await screen.findByText(/Saved receipt: revision rev3/);
    expect(mocks.request).toHaveBeenCalledWith('commit_recovery', expect.objectContaining({ preview_id: 'p', expected_version: 2, resolutions: { current_total_census: 21, monthly_rent_roll_cents: null }, confirm_clears: true }));
  });

  it.each([{ facility_id: 'b', week_start: '2026-09-14' }, { facility_id: 'a', week_start: '2026-09-07' }])('rejects a returned recovery preview for another scope: %j', async scope => {
    render(<StandUpWorkspace />); await screen.findByLabelText('Current census');
    const values = emptyValues();
    mocks.request.mockResolvedValueOnce({ ...scope, preview_id: 'wrong', expected_version: 2, merged: values, conflicts: [], clears: [] });
    const file = new File([''], 'fallback.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => JSON.stringify({ baseline_id: 'misbound-baseline', facility_id: 'a', week_start: '2026-09-14', version: 1, values }) });
    fireEvent.change(screen.getByLabelText('Upload edited fallback (JSON or CSV)'), { target: { files: [file] } });
    await screen.findByText('Recovery preview does not match the selected facility and week. No changes applied.');
    expect(screen.queryByText('Apply reviewed recovery')).not.toBeInTheDocument();
    expect(mocks.request).toHaveBeenLastCalledWith('preview_recovery', { baseline_id: 'misbound-baseline', facility_id: 'a', week_start: '2026-09-14', values });
    expect(mocks.request.mock.calls.some(([action]) => action === 'commit_recovery')).toBe(false);
  });

  it('loads detected file changes without upload and removes a reviewed Haven decision', async () => {
    const values = { ...emptyValues(), current_total_census: 20, monthly_rent_roll_cents: 100000 };
    const saved = { id: 'r', facility_id: 'a', week_start: '2026-09-14', version: 2, revision_id: 'rev', values, status: 'draft', updated_at: '2026-09-14T10:00:00Z' };
    const recovery = { facility_id: 'a', week_start: '2026-09-14', preview_id: 'pending-1', expected_version: 2, baseline: { ...values, current_total_census: 19 }, current: values, incoming: { ...values, current_total_census: 22, monthly_rent_roll_cents: null }, merged: values, conflicts: ['current_total_census'], clears: ['monthly_rent_roll_cents'] };
    mocks.request.mockResolvedValueOnce({ ...workspace, reports: [saved], pending_recoveries: [recovery, { ...recovery, preview_id: 'other', facility_id: 'b' }] });
    render(<StandUpWorkspace />);
    const review = await screen.findByText('Review recovery pending-1');
    expect(screen.queryByText('Review recovery other')).not.toBeInTheDocument();
    fireEvent.click(review);
    expect(screen.getByText('Baseline: 19 · Haven: 20 · File: 22')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Resolve Current census'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('Resolve Monthly rent roll'), { target: { value: '100000' } });
    mocks.request.mockResolvedValueOnce({ ...saved, version: 3, revision_id: 'rev3' });
    mocks.request.mockResolvedValueOnce({ ...workspace, reports: [{ ...saved, version: 3, revision_id: 'rev3' }], pending_recoveries: [] });
    fireEvent.click(screen.getByText('Apply reviewed recovery'));
    await screen.findByText(/Saved receipt: revision rev3/);
    await waitFor(() => expect(screen.queryByText('Review recovery pending-1')).not.toBeInTheDocument());
    expect(mocks.request).toHaveBeenCalledWith('commit_recovery', expect.objectContaining({ preview_id: 'pending-1', facility_id: 'a', week_start: '2026-09-14', resolutions: { current_total_census: 20, monthly_rent_roll_cents: 100000 }, confirm_clears: false }));
    expect(mocks.request).toHaveBeenLastCalledWith('workspace');
  });

});
