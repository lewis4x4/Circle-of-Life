// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
const mocks = vi.hoisted(() => ({ command: vi.fn() }));
vi.mock('@/lib/stand-up/server', () => ({ standUpCommand: mocks.command }));
beforeEach(() => { mocks.command.mockReset(); });
afterEach(() => vi.unstubAllEnvs());
function request(body: unknown, origin = 'https://haven.test') { const result = new Request('https://haven.test/api/stand-up', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); Object.defineProperty(result, 'headers', { value: new Headers({ origin, 'Content-Type': 'application/json' }) }); return result; }
describe('Stand Up caller API', () => {
  it('accepts the public Haven origin when the production request URL is internal', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    mocks.command.mockResolvedValue({ reports: [] });
    const proxied = new Request('http://localhost:3000/api/stand-up', { method: 'POST', headers: { origin: 'https://circleoflifealf.com' }, body: JSON.stringify({ action: 'workspace', payload: {} }) });
    expect((await POST(proxied)).status).toBe(200);
    expect(mocks.command).toHaveBeenCalledWith('workspace', {});
  });
  it('trusts only the exact configured deployment origin for previews', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DEPLOY_PRIME_URL', 'https://deploy-preview-123--circleoflifealf.netlify.app');
    mocks.command.mockResolvedValue({ reports: [] });
    expect((await POST(request({ action: 'workspace', payload: {} }, 'https://deploy-preview-123--circleoflifealf.netlify.app'))).status).toBe(200);
    expect((await POST(request({ action: 'save', payload: {} }, 'https://deploy-preview-124--circleoflifealf.netlify.app'))).status).toBe(403);
  });
  it('does not authorize forged production request URLs or forwarded headers', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const forged = new Request('https://other.test/api/stand-up', { method: 'POST', headers: { origin: 'https://other.test', host: 'other.test', 'x-forwarded-host': 'other.test', 'x-forwarded-proto': 'https' }, body: JSON.stringify({ action: 'save', payload: {} }) });
    expect((await POST(forged)).status).toBe(403);
    expect(mocks.command).not.toHaveBeenCalled();
  });
  it('still requires authentication for a trusted public origin', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    mocks.command.mockRejectedValue(new Error('Authentication required'));
    expect((await POST(request({ action: 'workspace', payload: {} }, 'https://circleoflifealf.com'))).status).toBe(401);
    expect((await POST(request({ action: 'workspace', payload: {} }, 'null'))).status).toBe(403);
  });
  it('denies cross-origin mutations before invoking the database', async () => {
    expect((await POST(request({ action: 'save', payload: {} }, 'https://other.test'))).status).toBe(403);
    expect(mocks.command).not.toHaveBeenCalled();
  });
  it('rejects unrecognized commands and returns authentication failures', async () => {
    expect((await POST(request({ action: 'raw_sql', payload: {} }))).status).toBe(400);
    mocks.command.mockRejectedValueOnce(new Error('Authentication required'));
    expect((await POST(request({ action: 'workspace', payload: {} }))).status).toBe(401);
  });
  it('passes the roster suggestion command through and maps a facility grant denial to 403 (COL-351)', async () => {
    mocks.command.mockResolvedValueOnce({ facility_id: 'f', roster_census_count: 34, in_house_count: 32, hospital_hold_count: 1, loa_count: 1, resident_count_in_haven: 40, roster_as_of: null });
    const roster = await POST(request({ action: 'roster', payload: { facility_id: 'f' } }));
    expect(roster.status).toBe(200); expect(mocks.command).toHaveBeenCalledWith('roster', { facility_id: 'f' });
    expect(JSON.stringify(await roster.json())).not.toMatch(/name|resident_id|room/);
    mocks.command.mockRejectedValueOnce(Object.assign(new Error('Stand Up access denied'), { code: '42501' }));
    expect((await POST(request({ action: 'save', payload: { facility_id: 'other', roster: {} } }))).status).toBe(403);
    mocks.command.mockRejectedValueOnce(Object.assign(new Error('Current census differs from the Haven roster (34). Choose why it is different or use the roster figure.'), { code: '22023' }));
    const differs = await POST(request({ action: 'save', payload: { facility_id: 'f', roster: {} } }));
    expect(differs.status).toBe(400); expect((await differs.json()).error).toMatch(/differs from the Haven roster/);
  });
  it('returns a no-store receipt and exposes version conflicts for review', async () => {
    mocks.command.mockResolvedValueOnce({ revision_id: 'r' });
    const saved = await POST(request({ action: 'save', payload: { expected_version: 1 } }));
    expect(await saved.json()).toEqual({ revision_id: 'r' });
    expect(saved.headers.get('cache-control')).toContain('no-store');
    mocks.command.mockRejectedValueOnce(new Error('Report version changed'));
    expect((await POST(request({ action: 'save', payload: {} }))).status).toBe(409);
  });
  it('refuses a save before the entry window opens with its own code, not a version conflict', async () => {
    mocks.command.mockRejectedValueOnce(Object.assign(new Error('This report opens Sunday, September 20 at 12:00 AM Eastern'), { code: 'P0409', hint: 'stand_up_entry_not_open' }));
    const refused = await POST(request({ action: 'save', payload: { week_start: '2026-09-28' } }));
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: 'This report opens Sunday, September 20 at 12:00 AM Eastern', code: 'stand_up_entry_not_open' });
    // A denial is still a denial; the window never softens authorization.
    mocks.command.mockRejectedValueOnce(Object.assign(new Error('Stand Up access denied'), { code: '42501' }));
    expect((await POST(request({ action: 'save', payload: {} }))).status).toBe(403);
  });
  it('allows the entry window setting as a named command and nothing else new', async () => {
    mocks.command.mockResolvedValueOnce({ facility_id: 'f', entry_open_lead_minutes: 3405 });
    expect((await POST(request({ action: 'set_entry_window', payload: { facility_id: 'f', entry_open_lead_minutes: 3405 } }))).status).toBe(200);
    expect(mocks.command).toHaveBeenCalledWith('set_entry_window', { facility_id: 'f', entry_open_lead_minutes: 3405 });
    expect((await POST(request({ action: 'set_entry_defaults', payload: {} }))).status).toBe(400);
  });
});
