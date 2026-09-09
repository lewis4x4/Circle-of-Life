// @vitest-environment node
import { beforeEach, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
const mock = vi.hoisted(() => ({
  require: vi.fn(), revalidate: vi.fn(), rpc: vi.fn(), upload: vi.fn(), download: vi.fn(), scan: vi.fn()
}));
vi.mock('@/lib/auth/current-api-actor', () => ({ requireCurrentApiActor: mock.require, revalidateCurrentApiActor: mock.revalidate }));
vi.mock('@/lib/insurance/extraction', async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/insurance/extraction')>(), scanDocument: mock.scan }));
import { POST } from './route';
const id = '11111111-1111-4111-8111-111111111111';
const org = '22222222-2222-4222-8222-222222222222';
const document = {
  id, organization_id: org, storage_path: `${org}/${id}`, status: 'uploading', scan_status: 'not_configured', filename: 'policy.txt'
};
const actor = {
  id: '33333333-3333-4333-8333-333333333333', organizationId: org, admin: { rpc: mock.rpc, storage: { from: () => ({ upload: mock.upload, download: mock.download }) } }
};
function request(content = 'Policy fixture') {
  const form = new FormData();
  form.append('file', new Blob([content], { type: 'text/plain' }), 'policy.txt');
  form.append('family', 'policy');
  form.append('sha256', 'forged');
  form.append('actor_id', 'forged');
  return new Request('https://haven.test/api/insurance/documents', { method: 'POST', body: form });
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.require.mockResolvedValue({ actor });
  mock.revalidate.mockResolvedValue({ actor });
  mock.rpc.mockResolvedValue({ data: document, error: null });
  mock.upload.mockResolvedValue({ error: null });
  mock.scan.mockResolvedValue('not_configured');
});
it('registers server hash and actor, then stores original before marking ready', async () => {
  const response = await POST(request());
  expect(response.status, await response.clone().text()).toBe(201);
  expect(mock.rpc.mock.calls[0][1]).toMatchObject({
    p_action: 'register_document', p_payload: {
      sha256: createHash('sha256').update('Policy fixture').digest('hex'), actor_id: actor.id, organization_id: org, byte_size: 14
    }
  });
  expect(mock.upload).toHaveBeenCalledWith(`${org}/${id}`, expect.any(Uint8Array), { contentType: 'text/plain', upsert: false });
  expect(mock.rpc.mock.calls[1][1]).toMatchObject({ p_action: 'finish_document', p_payload: { status: 'ready', scan_status: 'not_configured' } });
});
it('retains a quarantined original and returns a recoverable error when scanning fails', async () => {
  mock.scan.mockRejectedValue(new Error('scanner offline'));
  expect((await POST(request())).status).toBe(500);
  expect(mock.rpc.mock.calls[1][1]).toMatchObject({ p_action: 'finish_document', p_payload: { status: 'quarantined', scan_status: 'failed' } });
});
it('reuses an existing ready hash without overwriting storage or rerunning extraction', async () => {
  mock.rpc.mockResolvedValue({ data: { ...document, status: 'ready' }, error: null });
  expect((await POST(request())).status).toBe(200);
  expect(mock.upload).not.toHaveBeenCalled();
  expect(mock.scan).not.toHaveBeenCalled();
  expect(mock.rpc).toHaveBeenCalledTimes(1);
});
it('rejects binary content before creating any document records', async () => {
  expect((await POST(request('bad\u0000binary'))).status).toBe(400);
  expect(mock.rpc).not.toHaveBeenCalled();
});
