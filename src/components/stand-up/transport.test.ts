import { describe, expect, it, vi, afterEach } from 'vitest';
import { fallbackCsv, parseFallback, standUpRequest } from './transport';
import { resolveUiV2AdminRewritePath } from '@/lib/flags';
afterEach(() => vi.unstubAllGlobals());
describe('Stand Up fallback transport', () => {
  it('round trips blank and zero distinctly with immutable baseline identity', () => {
    const file = { baseline_id: 'baseline', facility_id: 'facility', week_start: '2026-09-14', version: 3, values: { census: 0, rent: null, overtime: 1.25 } };
    expect(parseFallback(fallbackCsv(file))).toEqual(file);
  });
  it('rejects mixed facility rows and duplicate metric rows', () => {
    const header = 'baseline_id,facility_id,week_start,version,metric,value\n';
    expect(() => parseFallback(header + 'b,f,w,1,census,0\nb,other,w,1,rent,2')).toThrow('consistent');
    expect(() => parseFallback(header + 'b,f,w,1,census,0\nb,f,w,1,census,2')).toThrow('Duplicate');
  });
  it('surfaces denied commands instead of manufacturing save receipts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Version changed; reload before saving' }) }));
    await expect(standUpRequest('save')).rejects.toThrow('Version changed');
  });
  it('is not rewritten to an unimplemented V2 route', () => {
    expect(resolveUiV2AdminRewritePath('/admin/stand-up', { enabled: true })).toBeNull();
  });
});
