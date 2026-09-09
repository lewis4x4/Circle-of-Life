import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  require: vi.fn(),
  rpc: vi.fn(),
  adminRpc: vi.fn()
}));
vi.mock('@/lib/auth/current-api-actor', () => ({
  requireCurrentApiActor: mock.require
}));
import { GET } from './route';
const id = '11111111-1111-4111-8111-111111111111';
const org = '22222222-2222-4222-8222-222222222222';
const record = {
  id,
  organization_id: org,
  version: 4,
  kind: 'renewal_package',
  status: 'approved',
  display_names: { entity: 'Original insured name', facility: 'Original facility name' },
  payload: {
    policy_snapshot: {
      version: 2,
      premium_cents: null
    },
    recipient: 'Approved recipient'
  }
};
const actor = {
  id,
  organizationId: org,
  client: {
    rpc: mock.rpc
  },
  admin: {
    rpc: mock.adminRpc
  }
};
const request = (query = 'version=4') => new Request(`https://haven.test/api/insurance/servicing/${id}/export?${query}`);
beforeEach(() => {
  vi.clearAllMocks();
  mock.require.mockResolvedValue({
    actor
  });
  mock.rpc.mockResolvedValue({
    data: {
      record,
      version: 4
    },
    error: null
  });
});
describe('immutable renewal export', () => {
  it('downloads exactly the stored approved version through audited export RPC without sharing it', async () => {
    const response = await GET(request(), {
      params: Promise.resolve({
        id
      })
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      record,
      version: 4
    });
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('content-disposition')).toContain(`-v4.json`);
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('insurance_servicing', {
      p_action: 'export',
      p_payload: {
        id,
        version: 4
      }
    });
    expect(mock.adminRpc).not.toHaveBeenCalled();
  });
  it('keeps the approved labels from the exported snapshot after the live directory changes', async () => {
    const response = await GET(request(), { params: Promise.resolve({ id }) });
    const exported = await response.json();
    expect(exported.record.display_names).toEqual({ entity: 'Original insured name', facility: 'Original facility name' });
    // No list/directory lookup may rewrite labels on this historical export.
    expect(mock.rpc).toHaveBeenCalledTimes(1);
    expect(mock.rpc.mock.calls[0][1].p_action).toBe('export');
  });
  it.each([{
    ...record,
    organization_id: 'foreign'
  }, {
    ...record,
    status: 'draft'
  }, {
    ...record,
    version: 5
  }, {
    ...record,
    kind: 'claim_matter'
  }])('fails closed for wrong scope, state, revision or kind', async badRecord => {
    mock.rpc.mockResolvedValue({
      data: {
        record: badRecord,
        version: 4
      },
      error: null
    });
    expect((await GET(request(), {
      params: Promise.resolve({
        id
      })
    })).status).toBe(404);
  });
  it('requires an exact revision and rejects actor metadata in query parameters', async () => {
    for (const query of ['', 'version=0', 'version=4&actor_id=forged']) expect((await GET(request(query), {
      params: Promise.resolve({
        id
      })
    })).status).toBe(400);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it('returns access denial without reading a snapshot', async () => {
    mock.require.mockResolvedValue({
      response: new Response('Denied', {
        status: 403
      })
    });
    expect((await GET(request(), {
      params: Promise.resolve({
        id
      })
    })).status).toBe(403);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
});
