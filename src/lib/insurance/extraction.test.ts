import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractDocument, inspectDocument, validateExtractionSuggestion, readBoundedBody } from './extraction';
import { createEmptyPolicyDraft, type InsuranceDocument } from './workspace-types';
const id = '11111111-1111-4111-8111-111111111111';
const document = {
  id, family: 'policy', filename: 'policy.txt', mime_type: 'text/plain'
} as InsuranceDocument;
const bytes = new TextEncoder().encode('Policy number ABC123');
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('untrusted insurance originals and suggestions', () => {
  it('hashes actual bytes and rejects MIME confusion, encrypted and active PDFs', () => {
    expect(inspectDocument(bytes, 'policy.txt', 'text/plain')).toMatchObject({
      mime_type: 'text/plain', byte_size: 20, sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
    expect(() => inspectDocument(bytes, 'policy.pdf', 'application/pdf')).toThrow('Only PDF');
    expect(() => inspectDocument(Buffer.from('%PDF-1.7 /Encrypt 1 %%EOF'), 'x.pdf', 'application/pdf')).toThrow('Encrypted');
    expect(() => inspectDocument(Buffer.from('%PDF-1.7 /J#53 (alert) %%EOF'), 'x.pdf', 'application/pdf')).toThrow('active');
  });
  it('does not convert provider IDs into entity/facility matches or accept invented source IDs', () => {
    const result = validateExtractionSuggestion({
      payload: {
        ...createEmptyPolicyDraft(), entity_id: id, parties: [{ entity_id: id }], facilities: [{ facility_id: id }], policy_number: 'ABC123'
      }, evidence: {
        entity_id: {
          source: 'document', page: 1, excerpt: 'Acme'
        }, policy_number: {
          source: 'document', document_id: '22222222-2222-4222-8222-222222222222', page: 2, excerpt: 'ABC123'
        }
      }
    }, document);
    expect(result.payload.entity_id).toBe('');
    expect(result.payload.parties).toEqual([]);
    expect(result.payload.facilities).toEqual([]);
    expect(result.evidence).toEqual({
      entity_id: {
        source: 'document', document_id: id, page: 1, excerpt: 'Acme'
      }, policy_number: {
        source: 'document', document_id: id, page: 2, excerpt: 'ABC123'
      }
    });
  });
  it('rejects negative amounts, unknown keys and invalid calendar dates', () => {
    for (const payload of [{ ...createEmptyPolicyDraft(), premium_cents: -1 }, { ...createEmptyPolicyDraft(), effective_date: '2026-02-31' }, { ...createEmptyPolicyDraft(), auto_approve: true }])
      expect(() => validateExtractionSuggestion({ payload, evidence: {} }, document)).toThrow();
  });
  it('uses fully manual review when no extraction provider is configured', async () => {
    vi.stubEnv('INSURANCE_EXTRACTOR_URL', '');
    vi.stubEnv('INSURANCE_OPENAI_ENABLED', 'false');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await extractDocument(document, bytes)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('restricts adapter host and rejects provider schema failures', async () => {
    vi.stubEnv('INSURANCE_EXTRACTOR_URL', 'https://extract.example/policy');
    vi.stubEnv('INSURANCE_EXTRACTOR_ALLOWED_HOSTS', 'other.example');
    await expect(extractDocument(document, bytes)).rejects.toThrow('explicitly allowed host');
    vi.stubEnv('INSURANCE_EXTRACTOR_ALLOWED_HOSTS', 'extract.example');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ payload: { premium_cents: 'invented' }, evidence: {} }))));
    await expect(extractDocument(document, bytes)).rejects.toThrow();
  });
  it('times out a hung provider and permits a fresh retry', async () => {
    vi.useFakeTimers();
    vi.stubEnv('INSURANCE_EXTRACTOR_URL', 'https://extract.example/policy');
    vi.stubEnv('INSURANCE_EXTRACTOR_ALLOWED_HOSTS', 'extract.example');
    const fetch = vi.fn().mockImplementationOnce(() => new Promise(() => {
    })).mockResolvedValueOnce(new Response(JSON.stringify({ payload: createEmptyPolicyDraft(), evidence: {} })));
    vi.stubGlobal('fetch', fetch);
    const operation = extractDocument(document, bytes);
    const rejection = expect(operation).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(45001);
    await rejection;
    await expect(extractDocument(document, bytes)).resolves.toMatchObject({ payload: { entity_id: '' } });
  });
  it('bounds streamed input without relying on Content-Length', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(11));
        controller.close();
      }
    });
    await expect(readBoundedBody(stream, 10)).rejects.toThrow('exceeds');
  });
  it('keeps the timeout active while provider response body hangs', async () => {
    vi.useFakeTimers();
    vi.stubEnv('INSURANCE_EXTRACTOR_URL', 'https://extract.example/policy');
    vi.stubEnv('INSURANCE_EXTRACTOR_ALLOWED_HOSTS', 'extract.example');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({
      start() {
      }
    }))));
    const result = expect(extractDocument(document, bytes)).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(45001);
    await result;
  });
  it('verifies text evidence against formfeed-separated source pages', async () => {
    vi.stubEnv('INSURANCE_EXTRACTOR_URL', 'https://extract.example/policy');
    vi.stubEnv('INSURANCE_EXTRACTOR_ALLOWED_HOSTS', 'extract.example');
    const source = new TextEncoder().encode('First page\fABC123');
    expect(() => inspectDocument(source, 'policy.txt', 'text/plain')).not.toThrow();
    const payload = { ...createEmptyPolicyDraft(), policy_number: 'ABC123' };
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
      payload, evidence: {
        policy_number: {
          source: 'document', page: 2, excerpt: 'ABC123'
        }
      }
    })))));
    await expect(extractDocument(document, source)).resolves.toMatchObject({ evidence: { policy_number: { page: 2 } } });
    await expect(extractDocument(document, bytes)).rejects.toThrow('does not match');
  });
  it('sends PDFs through Responses input_file only with explicit opt-in/model and store false', async () => {
    vi.stubEnv('INSURANCE_EXTRACTOR_URL', '');
    vi.stubEnv('INSURANCE_OPENAI_ENABLED', 'true');
    vi.stubEnv('INSURANCE_OPENAI_MODEL', 'configured-model');
    vi.stubEnv('OPENAI_API_KEY', 'fixture-key');
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: JSON.stringify({ payload: createEmptyPolicyDraft(), evidence: {} }) }] }] })));
    vi.stubGlobal('fetch', fetch);
    await extractDocument({
      ...document, mime_type: 'application/pdf', filename: 'policy.pdf'
    }, Buffer.from('%PDF-1.7 %%EOF'));
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.store).toBe(false);
    expect(body.model).toBe('configured-model');
    expect(body.input[0].content[0]).toMatchObject({ type: 'input_file', file_data: expect.stringMatching(/^data:application\/pdf;base64,/) });
  });
});
