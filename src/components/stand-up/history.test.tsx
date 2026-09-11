import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { emptyValues, type StandUpReport } from '@/lib/stand-up/model';
import { StandUpHistory } from './history';
afterEach(cleanup);
function report(id: string, week: string, values: Partial<StandUpReport['values']>, facility = 'a'): StandUpReport {
  return { id, week_start: week, facility_id: facility, version: 1, revision_id: id, values: { ...emptyValues(), ...values }, status: 'draft', source_as_of: null, updated_at: '2026-09-14T13:00:00Z' };
}
describe('facility history analytics', () => {
  it('compares previous available reports, labels gaps, and excludes other facilities', () => {
    render(<StandUpHistory facilityId="a" facilityName="Homewood" reports={[
      report('old', '2026-08-31', { monthly_rent_roll_cents: 100000, current_total_census: 10 }),
      report('other', '2026-09-07', { monthly_rent_roll_cents: 999999 }, 'b'),
      report('new', '2026-09-14', { monthly_rent_roll_cents: 120000, current_total_census: 12 }),
    ]} />);
    const rows = screen.getAllByRole('row');
    expect(within(rows[1]).getByRole('rowheader')).toHaveTextContent('2026-09-14');
    expect(within(rows[1]).getByText('Compared with 2026-08-31 — gap in weekly reports')).toBeInTheDocument();
    expect(within(rows[1]).getByText('+$200.00')).toBeInTheDocument();
    expect(within(rows[1]).getByText('+2')).toBeInTheDocument();
    expect(within(rows[1]).getByText('$100.00')).toBeInTheDocument();
    expect(screen.queryByText('$9999.99')).not.toBeInTheDocument();
  });
  it('preserves known zero and unknown source time without inventing a change or average', () => {
    render(<StandUpHistory facilityId="a" facilityName="Homewood" reports={[
      report('old', '2026-09-07', {}),
      report('new', '2026-09-14', { current_total_census: 0, callouts_last_week: 0, overtime_reported: 0 }),
    ]} />);
    const latest = within(screen.getAllByRole('row')[1]);
    expect(latest.getAllByText('Change unavailable')).toHaveLength(2);
    expect(latest.getByText('Not calculable')).toBeInTheDocument();
    expect(latest.getByText('Unknown')).toBeInTheDocument();
    expect(latest.getAllByText('0')).toHaveLength(3);
    expect(latest.getByText('Compared with 2026-09-07')).toBeInTheDocument();
  });
});
