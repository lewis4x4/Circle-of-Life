import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
const mocks = vi.hoisted(() => ({ command: vi.fn() }));
vi.mock('@/lib/stand-up/server', () => ({ standUpCommand: mocks.command }));
beforeEach(() => mocks.command.mockReset());
function request(body: unknown, origin = 'https://haven.test') { const result = new Request('https://haven.test/api/stand-up', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); Object.defineProperty(result, 'headers', { value: new Headers({ origin, 'Content-Type': 'application/json' }) }); return result; }
describe('Stand Up caller API', () => {
  it('denies cross-origin mutations before invoking the database', async () => {
    expect((await POST(request({ action: 'save', payload: {} }, 'https://other.test'))).status).toBe(403);
    expect(mocks.command).not.toHaveBeenCalled();
  });
  it('rejects unrecognized commands and returns authentication failures', async () => {
    expect((await POST(request({ action: 'raw_sql', payload: {} }))).status).toBe(400);
    mocks.command.mockRejectedValueOnce(new Error('Authentication required'));
    expect((await POST(request({ action: 'workspace', payload: {} }))).status).toBe(401);
  });
  it('returns a no-store receipt and exposes version conflicts for review', async () => {
    mocks.command.mockResolvedValueOnce({ revision_id: 'r' });
    const saved = await POST(request({ action: 'save', payload: { expected_version: 1 } }));
    expect(await saved.json()).toEqual({ revision_id: 'r' });
    expect(saved.headers.get('cache-control')).toContain('no-store');
    mocks.command.mockRejectedValueOnce(new Error('Report version changed'));
    expect((await POST(request({ action: 'save', payload: {} }))).status).toBe(409);
  });
});
