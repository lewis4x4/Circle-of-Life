import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyServicingPayload, SERVICING_KINDS } from '@/lib/insurance/servicing-types';
const mock = vi.hoisted(() => ({
  require: vi.fn(),
  rpc: vi.fn(),
  adminRpc: vi.fn()
}));
vi.mock('@/lib/auth/current-api-actor', () => ({
  requireCurrentApiActor: mock.require
}));
import { GET, POST } from './route';
const id = '11111111-1111-4111-8111-111111111111';
const actor = {
  id,
  organizationId: id,
  client: {
    rpc: mock.rpc
  },
  admin: {
    rpc: mock.adminRpc
  }
};
function request(body: unknown) {
  return new Request('https://haven.test/api/insurance/servicing', {
    method: 'POST',
    body: JSON.stringify(body)
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.require.mockResolvedValue({
    actor
  });
  mock.rpc.mockResolvedValue({
    data: {
      record: {
        id,
        version: 1
      }
    },
    error: null
  });
});
describe('servicing API actor and mutation boundary', () => {
  it.each(SERVICING_KINDS)('saves %s through the current session without service-role escalation', async kind => {
    const payload = {
      id,
      kind,
      title: 'Internal review',
      entity_id: id,
      facility_id: null,
      policy_id: null,
      document_id: null,
      owner_id: null,
      due_date: null,
      payload: createEmptyServicingPayload(kind)
    };
    const response = await POST(request({
      action: 'save',
      payload
    }));
    expect(response.status).toBe(200);
    expect(mock.rpc).toHaveBeenCalledWith('insurance_servicing', {
      p_action: 'save',
      p_payload: payload
    });
    expect(mock.adminRpc).not.toHaveBeenCalled();
  });
  it('lists complete database projections using manager authorization and private caching', async () => {
    mock.rpc.mockResolvedValue({
      data: {
        records: [],
        loss_totals: {
          history_complete: false
        }
      },
      error: null
    });
    const response = await GET(new Request('https://haven.test/api/insurance/servicing?kind=loss_report'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(mock.require).toHaveBeenCalledWith({
      allowedRoles: ['owner', 'org_admin'],
      scope: 'insurance.servicing.list'
    });
    expect(mock.rpc).toHaveBeenCalledWith('insurance_servicing', {
      p_action: 'list',
      p_payload: {
        kind: 'loss_report'
      }
    });
  });
  it.each([401, 403])('does not touch records when authorization returns %s', async status => {
    mock.require.mockResolvedValue({
      response: new Response(JSON.stringify({
        error: 'Denied'
      }), {
        status
      })
    });
    const response = await GET(new Request('https://haven.test/api/insurance/servicing'));
    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it('rejects forged scope and missing revision before touching the database', async () => {
    for (const body of [{
      action: 'transition',
      payload: {
        id,
        version: 1,
        status: 'approved',
        organization_id: id
      }
    }, {
      action: 'revise',
      payload: {
        id,
        new_id: id
      }
    }, {
      action: 'export',
      payload: {
        id,
        version: 1
      }
    }]) {
      expect((await POST(request(body))).status).toBe(400);
    }
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it.each([['42501', 403], ['40001', 409], ['P0002', 404], ['28000', 401]] as const)('preserves database scope/version failure %s', async (code, status) => {
    mock.rpc.mockResolvedValue({
      data: null,
      error: {
        code,
        message: code === '42501' ? 'Foreign document access forbidden' : 'Request rejected'
      }
    });
    const response = await POST(request({
      action: 'transition',
      payload: {
        id,
        version: 1,
        status: 'approved'
      }
    }));
    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(mock.adminRpc).not.toHaveBeenCalled();
  });
  it('records acknowledgment as transition metadata instead of replacing approved payload', async () => {
    const payload = {
      id,
      version: 3,
      status: 'acknowledged',
      recipient: 'Broker',
      acknowledgment: 'Confirmed by phone',
      reported_date: '2026-09-01'
    };
    expect((await POST(request({
      action: 'transition',
      payload
    }))).status).toBe(200);
    expect(mock.rpc).toHaveBeenCalledWith('insurance_servicing', {
      p_action: 'transition',
      p_payload: payload
    });
  });
});


it('uses current-session RPC for operational reassignment and does not send approval content', async () => {
  const payload = { id, version: 4, owner_id: id, due_date: '2026-10-01', note: 'New servicing owner' };
  expect((await POST(request({ action: 'reassign', payload }))).status).toBe(200);
  expect(mock.rpc).toHaveBeenCalledWith('insurance_servicing', { p_action: 'reassign', p_payload: payload });
  expect(mock.adminRpc).not.toHaveBeenCalled();
});
