export async function standUpRequest<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch('/api/stand-up', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, payload }), signal: controller.signal });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not complete this operation.');
    return result as T;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('The request timed out. Your entries remain here. Retry the same operation to retrieve its receipt; do not assume it failed.');
    throw error;
  } finally { clearTimeout(timer); }
}

export type FallbackFile = { baseline_id: string; facility_id: string; week_start: string; version: number; values: Record<string, number | null> };
export function fallbackCsv(file: FallbackFile): string {
  return ['baseline_id,facility_id,week_start,version,metric,value', ...Object.entries(file.values).map(([key, value]) => [file.baseline_id, file.facility_id, file.week_start, file.version, key, value ?? ''].join(','))].join('\r\n');
}
export function parseFallback(text: string): FallbackFile {
  if (text.trim().startsWith('{')) return JSON.parse(text) as FallbackFile;
  const lines = text.trim().split(/\r?\n/).map(line => line.split(','));
  if (lines.shift()?.join(',') !== 'baseline_id,facility_id,week_start,version,metric,value') throw new Error('Use the canonical Haven fallback CSV or JSON.');
  const first = lines[0];
  if (!first || first.length !== 6) throw new Error('The fallback file has no metric rows.');
  const values: Record<string, number | null> = {};
  for (const row of lines) {
    if (row.length !== 6 || row.slice(0, 4).join(',') !== first.slice(0, 4).join(',')) throw new Error('Fallback rows must have one consistent baseline, facility and week.');
    if (Object.hasOwn(values, row[4])) throw new Error(`Duplicate metric: ${row[4]}`);
    const value = row[5] === '' ? null : Number(row[5]);
    if (value !== null && (!row[5].trim() || !Number.isFinite(value))) throw new Error(`Invalid number: ${row[4]}`);
    values[row[4]] = value;
  }
  return { baseline_id: first[0], facility_id: first[1], week_start: first[2], version: Number(first[3]), values };
}
export function downloadText(name: string, value: string, type: string) {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url);
}
