import { beforeEach, describe, it, expect, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  require: vi.fn(), clientRpc: vi.fn(), adminRpc: vi.fn()
}));
vi.mock('@/lib/auth/current-api-actor', () => ({ requireCurrentApiActor: mock.require, revalidateCurrentApiActor: vi.fn() }));
import { GET, POST } from './route';
beforeEach(() => {
  vi.clearAllMocks();
  mock.require.mockResolvedValue({
    actor: {
      id: 'actor', organizationId: 'org', client: { rpc: mock.clientRpc }, admin: { rpc: mock.adminRpc }
    }
  });
  mock.clientRpc.mockResolvedValue({ data: { can_manage: true }, error: null });
});
describe('insurance workspace API', () => {
  it('invokes browser commands with current session client only', async () => {
    const response = await GET(new Request('https://haven.test/api/insurance/workspace'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(mock.clientRpc).toHaveBeenCalledWith('insurance_workspace', { p_action: 'overview', p_payload: {} });
    expect(mock.adminRpc).not.toHaveBeenCalled();
  });
  it('does not expose processing commands or arbitrary actor/org fields', async () => {
    for (const body of [{ action: 'finish_extraction', payload: { status: 'review_required' } }, { action: 'overview', payload: { organization_id: 'foreign' } }]) {
      const response = await POST(new Request('https://haven.test/api/insurance/workspace', { method: 'POST', body: JSON.stringify(body) }));
      expect(response.status).toBe(400);
    }
    expect(mock.clientRpc).not.toHaveBeenCalled();
    expect(mock.adminRpc).not.toHaveBeenCalled();
  });
  it('preserves database stale revision conflicts', async () => {
    mock.clientRpc.mockResolvedValue({ data: null, error: { code: '40001', message: 'Stale draft revision' } });
    const response = await POST(new Request('https://haven.test/api/insurance/workspace', {
      method: 'POST', body: JSON.stringify({
        action: 'approve_draft', payload: {
          id: '11111111-1111-4111-8111-111111111111', revision: 1, confirm_evidence: true
        }
      })
    }));
    expect(response.status).toBe(409);
  });
});
