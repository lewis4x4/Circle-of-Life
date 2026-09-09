import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
const mock = vi.hoisted(() => ({ require: vi.fn(), revalidate: vi.fn(), load: vi.fn(), html: vi.fn(), launch: vi.fn(), newPage: vi.fn(), setContent: vi.fn(), emulateMedia: vi.fn(), pdf: vi.fn(), close: vi.fn(), upload: vi.fn(), storagePath: vi.fn() }));
vi.mock('@/lib/auth/current-api-actor', () => ({ requireCurrentApiActor: mock.require, revalidateCurrentApiActor: mock.revalidate }));
vi.mock('@/lib/executive/load-league-data', () => ({ loadExecutiveLeagueData: mock.load }));
vi.mock('@/lib/executive/league-print', () => ({ buildExecutiveLeaguePrintHtml: mock.html }));
vi.mock('@/lib/observability/logger', () => ({ logError: vi.fn() }));
vi.mock('@/lib/reports/export-storage', () => ({ REPORT_EXPORT_BUCKET: 'report-exports', executiveLeaguePdfStoragePath: mock.storagePath }));
vi.mock('playwright', () => ({ chromium: { launch: mock.launch } }));
import { GET } from './route';
const actor = { id: 'owner', organizationId: 'current-org', appRole: 'owner', admin: { storage: { from: () => ({ upload: mock.upload }) } } };
const bytes = new TextEncoder().encode('%PDF-fixture');
beforeEach(() => {
  vi.clearAllMocks();
  mock.require.mockResolvedValue({ actor });
  mock.revalidate.mockResolvedValue({ actor });
  mock.load.mockResolvedValue({ facilities: [], insurance: 'private fixture' });
  mock.html.mockReturnValue('<html>Private portfolio fixture</html>');
  mock.launch.mockResolvedValue({ newPage: mock.newPage, close: mock.close });
  mock.newPage.mockResolvedValue({ setContent: mock.setContent, emulateMedia: mock.emulateMedia, pdf: mock.pdf });
  mock.pdf.mockResolvedValue(bytes);
  mock.upload.mockResolvedValue({ error: null });
  mock.storagePath.mockReturnValue('current-org/league.pdf');
});
describe('portfolio PDF authorization', () => {
  it.each([401, 403])('denies unavailable or insufficient access before service-role reads (%s)', async status => {
    mock.require.mockResolvedValue({ response: NextResponse.json({ error: 'Denied' }, { status }) });
    const response = await GET();
    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(mock.require).toHaveBeenCalledWith({ allowedRoles: ['owner', 'org_admin'], scope: 'executive.league.pdf' });
    expect(mock.load).not.toHaveBeenCalled();
    expect(mock.launch).not.toHaveBeenCalled();
  });
  it('preserves the authorized portfolio PDF and storage workflow with two live access checks', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(mock.load).toHaveBeenCalledWith(actor.admin, actor.organizationId);
    expect(mock.upload).toHaveBeenCalledWith('current-org/league.pdf', bytes, { contentType: 'application/pdf', upsert: true });
    expect(mock.revalidate).toHaveBeenNthCalledWith(1, actor, { allowedRoles: ['owner', 'org_admin'], scope: 'executive.league.pdf.storage-revalidate' });
    expect(mock.revalidate).toHaveBeenNthCalledWith(2, actor, { allowedRoles: ['owner', 'org_admin'], scope: 'executive.league.pdf.return-revalidate' });
    expect(mock.close).toHaveBeenCalledOnce();
  });
  it('does not upload or return private PDF bytes after access is revoked during rendering', async () => {
    mock.revalidate.mockResolvedValue({ response: NextResponse.json({ error: 'Session changed' }, { status: 401 }) });
    const response = await GET();
    expect(response.status).toBe(401);
    expect(mock.upload).not.toHaveBeenCalled();
    expect(mock.close).toHaveBeenCalledOnce();
  });
  it('does not upload another organization’s rendered data after an organization switch', async () => {
    mock.revalidate.mockResolvedValue({ actor: { ...actor, organizationId: 'different-org' } });
    expect((await GET()).status).toBe(404);
    expect(mock.upload).not.toHaveBeenCalled();
  });
  it('does not return PDF bytes after access changes during storage upload', async () => {
    mock.revalidate.mockResolvedValueOnce({ actor }).mockResolvedValueOnce({ response: NextResponse.json({ error: 'Denied' }, { status: 403 }) });
    const response = await GET();
    expect(response.status).toBe(403);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(mock.upload).toHaveBeenCalledOnce();
    expect(mock.close).toHaveBeenCalledOnce();
  });
  it('retains download behavior when optional storage persistence fails', async () => {
    mock.upload.mockResolvedValue({ error: { message: 'Storage unavailable' } });
    expect((await GET()).status).toBe(200);
    expect(mock.revalidate).toHaveBeenCalledTimes(2);
  });
  it('returns a private generic error if loading fails', async () => {
    mock.load.mockRejectedValue(new Error('Sensitive database detail'));
    const response = await GET();
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('Sensitive database detail');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(mock.launch).not.toHaveBeenCalled();
  });
});
