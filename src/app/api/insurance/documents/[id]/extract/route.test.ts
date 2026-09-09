import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
const mock = vi.hoisted(() => ({
  require: vi.fn(), revalidate: vi.fn(), sessionRpc: vi.fn(), adminRpc: vi.fn(), download: vi.fn(), extract: vi.fn()
}));
vi.mock('@/lib/auth/current-api-actor', () => ({ requireCurrentApiActor: mock.require, revalidateCurrentApiActor: mock.revalidate }));
vi.mock('@/lib/insurance/extraction', async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/insurance/extraction')>(), extractDocument: mock.extract }));
import { POST } from './route';
const id = '11111111-1111-4111-8111-111111111111';
const org = '22222222-2222-4222-8222-222222222222';
const content = 'Policy fixture';
const document = {
  id, family: 'policy', organization_id: org, storage_path: `${org}/${id}`, status: 'ready', scan_status: 'not_configured', mime_type: 'text/plain', filename: 'policy.txt', sha256: createHash('sha256').update(content).digest('hex')
};
const actor = {
  id: '33333333-3333-4333-8333-333333333333', organizationId: org, client: { rpc: mock.sessionRpc }, admin: { rpc: mock.adminRpc, storage: { from: () => ({ download: mock.download }) } }
};
const request = () => new Request(`https://haven.test/api/insurance/documents/${id}/extract`, {
  method: 'POST', body: JSON.stringify({
    actor_id: 'forged', organization_id: 'forged', run_id: 'forged', extraction_metadata: { provider: 'forged', configured_model: 'forged' }
  })
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('INSURANCE_EXTRACTOR_URL', '');
  vi.stubEnv('INSURANCE_OPENAI_ENABLED', 'false');
  vi.stubEnv('INSURANCE_OPENAI_MODEL', '');
  mock.require.mockResolvedValue({ actor });
  mock.revalidate.mockResolvedValue({ actor });
  mock.sessionRpc.mockResolvedValue({ data: document, error: null });
  mock.adminRpc.mockResolvedValue({ data: document, error: null });
  mock.download.mockResolvedValue({ data: new Blob([content]), error: null });
  mock.extract.mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());
describe('extraction processing boundary', () => {
  it('creates a server lease and finishes manual fallback without saving or approving a policy', async () => {
    expect((await POST(request(), { params: Promise.resolve({ id }) })).status).toBe(200);
    expect(mock.sessionRpc).toHaveBeenCalledTimes(1);
    const calls = mock.adminRpc.mock.calls;
    expect(calls.map(c => c[1].p_action)).toEqual(['start_extraction', 'finish_extraction']);
    expect(calls[0][1].p_payload).toMatchObject({ actor_id: actor.id, organization_id: org });
    expect(calls[0][1].p_payload.run_id).not.toBe('forged');
    expect(calls[1][1].p_payload).toMatchObject({ status: 'manual_review', run_id: calls[0][1].p_payload.run_id, extraction_metadata: { schema_version: 1, extractor_version: 'haven-insurance-v1', provider: 'manual', configured_model: null } });
  });
  it('does not download or process cross-org originals', async () => {
    mock.sessionRpc.mockResolvedValue({ data: { ...document, organization_id: 'other' }, error: null });
    expect((await POST(request(), { params: Promise.resolve({ id }) })).status).toBe(404);
    expect(mock.adminRpc).not.toHaveBeenCalled();
    expect(mock.download).not.toHaveBeenCalled();
  });
  it('records recoverable failure on the same run and does not publish provider facts', async () => {
    mock.extract.mockRejectedValue(new Error('provider failed'));
    expect((await POST(request(), { params: Promise.resolve({ id }) })).status).toBe(500);
    expect(mock.adminRpc.mock.calls[1][1].p_payload).toMatchObject({ status: 'failed', run_id: mock.adminRpc.mock.calls[0][1].p_payload.run_id });
  });
  it('does not finalize a run when acquiring the lease failed', async () => {
    mock.adminRpc.mockResolvedValue({ data: null, error: { code: '40001', message: 'Already processing' } });
    expect((await POST(request(), { params: Promise.resolve({ id }) })).status).toBe(409);
    expect(mock.adminRpc).toHaveBeenCalledTimes(1);
    expect(mock.extract).not.toHaveBeenCalled();
  });
  it('uses the original run token for stale completion and preserves database conflict', async () => {
    mock.adminRpc.mockResolvedValueOnce({ data: document, error: null }).mockResolvedValue({ data: null, error: { code: '40001', message: 'Stale extraction run' } });
    expect((await POST(request(), { params: Promise.resolve({ id }) })).status).toBe(409);
    const calls = mock.adminRpc.mock.calls;
    expect(calls[1][1].p_payload.run_id).toBe(calls[0][1].p_payload.run_id);
    expect(calls[2][1].p_payload.run_id).toBe(calls[0][1].p_payload.run_id);
  });
});


describe('server-derived extraction provenance', () => {
  it('records the configured OpenAI model and ignores request or provider metadata', async () => {
    vi.stubEnv('INSURANCE_OPENAI_ENABLED', 'true');
    vi.stubEnv('INSURANCE_OPENAI_MODEL', ' configured-fixture-model ');
    mock.extract.mockResolvedValue({ payload: {}, evidence: {}, extraction_metadata: { provider: 'forged' } });
    expect((await POST(request(), { params: Promise.resolve({ id }) })).status).toBe(200);
    expect(mock.adminRpc.mock.calls[1][1].p_payload.extraction_metadata).toEqual({
      schema_version: 1, extractor_version: 'haven-insurance-v1', provider: 'openai', configured_model: 'configured-fixture-model',
    });
  });
  it('records adapter precedence on failed extraction without claiming its underlying model', async () => {
    vi.stubEnv('INSURANCE_EXTRACTOR_URL', 'https://extractor.example/insurance');
    vi.stubEnv('INSURANCE_OPENAI_ENABLED', 'true');
    vi.stubEnv('INSURANCE_OPENAI_MODEL', 'unused-model');
    mock.extract.mockRejectedValue(new Error('Provider failed'));
    expect((await POST(request(), { params: Promise.resolve({ id }) })).status).toBe(500);
    expect(mock.adminRpc.mock.calls[1][1].p_payload.extraction_metadata).toEqual({
      schema_version: 1, extractor_version: 'haven-insurance-v1', provider: 'restricted_adapter', configured_model: null,
    });
  });
  it('identifies unsupported document families as manual even with an adapter configured', async () => {
    vi.stubEnv('INSURANCE_EXTRACTOR_URL', 'https://extractor.example/insurance');
    mock.sessionRpc.mockResolvedValue({ data: { ...document, family: 'certificate' }, error: null });
    expect((await POST(request(), { params: Promise.resolve({ id }) })).status).toBe(200);
    expect(mock.adminRpc.mock.calls[1][1].p_payload.extraction_metadata.provider).toBe('manual');
  });
});
