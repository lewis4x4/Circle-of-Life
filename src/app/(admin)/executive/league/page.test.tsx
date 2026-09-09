import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
const mock = vi.hoisted(() => ({ role: vi.fn(), load: vi.fn(), client: vi.fn(), view: vi.fn() }));
vi.mock('@/lib/finance/load-finance-context.server', () => ({ loadFinanceRoleContextServer: mock.role }));
vi.mock('@/lib/executive/load-league-data', () => ({ loadExecutiveLeagueData: mock.load }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mock.client }));
vi.mock('@/components/executive/ExecutiveLeaguePageClient', () => ({ default: (props: unknown) => { mock.view(props); return <div>Portfolio report content</div>; } }));
import ExecutiveLeaguePage from './page';
beforeEach(() => { cleanup(); vi.clearAllMocks(); mock.client.mockResolvedValue('session-client'); mock.load.mockResolvedValue({ fixtures: 'manager report' }); });
describe('portfolio league page access', () => {
  it.each(['facility_admin', 'nurse', 'caregiver'])('shows a restricted state instead of scoring inaccessible data for %s', async appRole => {
    mock.role.mockResolvedValue({ ok: true, ctx: { organizationId: 'org', appRole } });
    render(await ExecutiveLeaguePage());
    expect(screen.getByRole('heading', { name: 'Portfolio report restricted' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View approved insurance summaries' })).toHaveAttribute('href', '/admin/insurance/policies');
    expect(mock.client).not.toHaveBeenCalled();
    expect(mock.load).not.toHaveBeenCalled();
    expect(mock.view).not.toHaveBeenCalled();
  });
  it.each(['owner', 'org_admin'])('preserves the existing report for %s', async appRole => {
    mock.role.mockResolvedValue({ ok: true, ctx: { organizationId: 'org', appRole } });
    render(await ExecutiveLeaguePage());
    expect(screen.getByText('Portfolio report content')).toBeInTheDocument();
    expect(mock.load).toHaveBeenCalledWith('session-client', 'org');
    expect(mock.view).toHaveBeenCalledWith({ initialData: { fixtures: 'manager report' }, initialError: null });
  });
});
