import { beforeEach, it, expect, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  require: vi.fn(), revalidate: vi.fn(), rpc: vi.fn(), download: vi.fn()
}));
vi.mock('@/lib/auth/current-api-actor', () => ({ requireCurrentApiActor: mock.require, revalidateCurrentApiActor: mock.revalidate }));
import { GET } from './route';
const id = '11111111-1111-4111-8111-111111111111';
const org = '22222222-2222-4222-8222-222222222222';
const actor = {
  organizationId: org, client: { rpc: mock.rpc }, admin: { storage: { from: () => ({ download: mock.download }) } }
};
const document = {
  id, organization_id: org, storage_path: `${org}/${id}`, status: 'ready', scan_status: 'not_configured', mime_type: 'text/plain', filename: 'policy.txt'
};
beforeEach(() => {
  vi.clearAllMocks();
  mock.require.mockResolvedValue({ actor });
  mock.revalidate.mockResolvedValue({ actor });
  mock.rpc.mockResolvedValue({ data: document, error: null });
  mock.download.mockResolvedValue({ data: new Blob(['original']), error: null });
});
it('streams only the permitted original privately without signed URL', async () => {
  const response = await GET(new Request('https://haven.test'), { params: Promise.resolve({ id }) });
  expect(response.status).toBe(200);
  expect(await response.text()).toBe('original');
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(mock.download).toHaveBeenCalledWith(`${org}/${id}`);
});
it('does not stream quarantined originals', async () => {
  mock.rpc.mockResolvedValue({ data: { ...document, status: 'quarantined' }, error: null });
  expect((await GET(new Request('https://haven.test'), { params: Promise.resolve({ id }) })).status).toBe(409);
  expect(mock.download).not.toHaveBeenCalled();
});
it('rechecks scope before streaming original bytes', async () => {
  mock.revalidate.mockResolvedValue({ actor: { ...actor, organizationId: 'other' } });
  expect((await GET(new Request('https://haven.test'), { params: Promise.resolve({ id }) })).status).toBe(404);
});
